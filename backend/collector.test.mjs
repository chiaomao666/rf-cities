import test from 'node:test';
import assert from 'node:assert/strict';
import {CityState} from './model.mjs';
import {Collector} from './collector.mjs';

class Socket {
  static last;
  constructor(url) {this.url=url;this.listeners={};this.sent=[];this.readyState=1;Socket.last=this;}
  addEventListener(name,fn) {this.listeners[name]=fn;}
  send(raw) {this.sent.push(JSON.parse(raw));}
  emit(name,data) {this.listeners[name]?.({data});}
  close() {this.readyState=3;this.listeners.close?.({});}
  reply(frame,payload={status:'ok',response:{}}) {this.emit('message',JSON.stringify([frame[0],frame[1],frame[2],'phx_reply',payload]));}
}
test('公開模型：截止仍交戰、明確結束移除、缺欄位不覆寫、完整清單重建',()=>{
  const state=new CityState();
  state.ingest([{id:52,name:'城市',sword:true,nation_battle:{id:9,close_roll_call_at:'2020-01-01',private:'secret'},private:'secret'}]);
  assert.equal(state.rows().length,1);
  assert(!JSON.stringify(state.rows()).includes('secret'));
  state.ingest([{id:52,name:'新名稱'}]);assert.equal(state.rows().length,1);
  state.ingest([{id:52,sword:false,nation_battle:null,nation_battle_score:null}]);assert.equal(state.rows().length,0);
  state.ingest([{id:53,sword:true}],{replace:true});assert.equal(state.cities.has(52),false);
});
test('無憑證不連線',()=>{
  let connected=false;
  class Forbidden {constructor(){connected=true;}}
  const c=new Collector({state:new CityState(),Socket:Forbidden});c.start();
  assert.equal(connected,false);assert.equal(c.status.state,'waiting_credentials');
});
test('自己的頻道、初始快照與增量、快照期間更新不丟失',()=>{
  const state=new CityState(),c=new Collector({state,token:'test-token',userId:'42',Socket});
  try {
    c.start();const socket=Socket.last;socket.emit('open');
    assert.equal(new URL(socket.url).searchParams.get('userToken'),'test-token');
    assert.deepEqual(socket.sent.map(f=>f[2]),['all_players','locale:zh_TW','player:42']);
    for(const frame of socket.sent.slice()) socket.reply(frame);
    const query=socket.sent.at(-1);assert.equal(query[3],'cities');assert.deepEqual(query[4],{body:''});
    socket.emit('message',JSON.stringify([null,null,'all_players','update_data',{cities:[{id:52,sword:false,nation_battle:null}]}]));
    socket.reply(query,{status:'ok',response:{cities:[{id:52,sword:true,nation_battle:{id:900}}]}});
    assert.equal(state.rows().length,0);assert(c.status.lastSnapshot);
    socket.emit('message',JSON.stringify([null,null,'all_players','update_data',{cities:[{id:52,sword:true,nation_battle:{id:901}}]}]));
    assert.equal(state.rows().length,1);
    // 沒加入的頻道不讀取，國家 id 不當成城市。
    socket.emit('message',JSON.stringify([null,null,'player:999','update_data',{cities:[{id:53,sword:true}]}]));
    socket.emit('message',JSON.stringify([null,null,'all_players','update_data',{nations:[{id:3,control_cities:52}]}]));
    assert.equal(state.rows().length,1);
    assert(!socket.sent.some(f=>/join_nation_battle|attack|edit_profile/.test(f[3])));
  } finally {c.stop();}
});
test('訂閱拒絕停止，不嘗試其他身分',()=>{
  const c=new Collector({state:new CityState(),token:'test-token',userId:'42',Socket});
  try {c.start();const socket=Socket.last;socket.emit('open');socket.reply(socket.sent[0],{status:'error',response:{reason:'denied'}});
    assert.equal(c.status.state,'auth_error');assert.equal(c.reconnect,undefined);
  } finally {c.stop();}
});

test('連線 error 先結束再 close，不遞迴且只安排重連一次',()=>{
  class FailedSocket extends Socket {
    constructor(url) {super(url);this.readyState=0;this.closeCalls=0;}
    close() {
      this.closeCalls++;
      // 模擬 Node 原生 WebSocket：關閉未成功的連線會同步觸發 error。
      this.emit('error');
      super.close();
    }
  }
  const c=new Collector({state:new CityState(),token:'test-token',userId:'42',Socket:FailedSocket});
  try {
    c.start();const socket=Socket.last;
    assert.doesNotThrow(()=>socket.emit('error'));
    assert.equal(socket.closeCalls,1);
    assert.equal(c.status.connected,false);
    assert(c.status.error);
    assert.equal(c.status.state,'reconnecting');
    assert.equal(c.status.transportCode,'WEBSOCKET_CONNECTION_FAILED');
    socket.emit('close');
    assert.equal(c.status.state,'reconnecting');
    assert.equal(c.pending.size,0);
    const reconnect=c.reconnect;
    socket.emit('close');
    assert.equal(c.reconnect,reconnect);
    assert.equal(c.retry,1);
  } finally {c.stop();}
});

test('主動關閉觸發同步 error 時也不會遞迴',()=>{
  class ReentrantSocket extends Socket {
    constructor(url) {super(url);this.closeCalls=0;}
    close() {this.closeCalls++;this.emit('error');super.close();}
  }
  const c=new Collector({state:new CityState(),token:'test-token',userId:'42',Socket:ReentrantSocket});
  try {
    c.start();const socket=Socket.last;socket.emit('open');
    assert.doesNotThrow(()=>socket.emit('message',JSON.stringify([null,null,'all_players','phx_error',{}])));
    assert.equal(socket.closeCalls,1);
    assert.equal(c.status.state,'reconnecting');
  } finally {c.stop();}
});
