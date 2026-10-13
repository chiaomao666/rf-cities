import test from 'node:test';
import assert from 'node:assert/strict';
import {CityState} from './model.mjs';
import {Collector} from './collector.mjs';

test('握手失敗後重新登入一次，再以新 token 連線',async()=>{
  let calls=0;
  const c=new Collector({state:new CityState(),token:'old',userId:'42',Socket,
    refreshToken:async()=>{calls++;return 'new-token';}});
  try {
    c.start();const old=Socket.last;old.emit('error');old.emit('error');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,1);assert.notEqual(Socket.last,old);
    assert.equal(new URL(Socket.last.url).searchParams.get('userToken'),'new-token');
    assert(c.status.login.lastSuccess);
  } finally {c.stop();}
});
test('已知網路錯誤不重新登入',()=>{
  let calls=0;
  const c=new Collector({state:new CityState(),token:'old',userId:'42',Socket,refreshToken:async()=>{calls++;return 'new';}});
  try {
    c.start();Socket.last.listeners.error({error:{cause:{code:'ENOTFOUND'}}});
    assert.equal(calls,0);assert.equal(c.status.state,'reconnecting');
  } finally {c.stop();}
});
test('登入尚未完成就停止，不再建立連線',async()=>{
  let resolveLogin;
  const c=new Collector({state:new CityState(),userId:'42',Socket,
    refreshToken:()=>new Promise(resolve=>{resolveLogin=resolve;})});
  c.start();const socket=Socket.last;c.stop();resolveLogin('new-token');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(Socket.last,socket);assert.equal(c.reconnect,undefined);
});

class Socket {
  static last;
  constructor(url) {this.url=url;this.listeners={};this.sent=[];this.readyState=1;Socket.last=this;}
  addEventListener(name,fn) {this.listeners[name]=fn;}
  send(raw) {this.sent.push(JSON.parse(raw));}
  emit(name,data) {this.listeners[name]?.({data});}
  close() {this.readyState=3;this.listeners.close?.({});}
  reply(frame,payload={status:'ok',response:{}}) {this.emit('message',JSON.stringify([frame[0],frame[1],frame[2],'phx_reply',payload]));}
}
test('本人聯盟唯讀查詢雙方戰力／報到人數，拒絕後不再查詢且城市採集保留',()=>{
  const state=new CityState(),c=new Collector({state,token:'test-token',userId:'42',unionId:'7',Socket});
  try {
    c.start();const socket=Socket.last;socket.emit('open');
    const joins=socket.sent.slice();socket.reply(joins[3]);for(const frame of joins.slice(0,3))socket.reply(frame);
    socket.reply(socket.sent.at(-1),{status:'ok',response:{cities:[{id:287,sword:true,nation_battle:{id:90}}]}});
    c.pollBattleDetails();const query=socket.sent.at(-1);
    assert.equal(query[2],'union:7');assert.equal(query[3],'nation_battle');assert.deepEqual(query[4],{city_id:287});
    socket.reply(query,{status:'ok',response:{offender:{flag:'/images/cities/triangle/smallflag07MC.png',power:10253,roll_count:2,private:'secret'},defender:{power:96931,roll_count:25},energy:15,mode:'join'}});
    const details=JSON.parse(state.rows()[0].nation_battle)._rf_monitor.details;
    assert.equal(details.offender.power,10253);assert.equal(details.defender.roll_count,25);assert(!JSON.stringify(details).includes('secret'));
    const count=socket.sent.length;c.pollBattleDetails();assert.equal(socket.sent.length,count);
    c.pollBattleDetails(Date.now()+61000);socket.reply(socket.sent.at(-1),{status:'error',response:{reason:'denied'}});
    assert.equal(c.status.battleDetails.state,'denied');assert.equal(c.status.connected,true);
    c.pollBattleDetails(Date.now()+120000);assert.equal(socket.sent.length,count+1);
    assert(!socket.sent.some(f=>/join_nation_battle|maneuver|spy/.test(f[3])));
  } finally {c.stop();}
});

test('聯盟訂閱拒絕不猜其他聯盟，不影響原有三個頻道',()=>{
  const c=new Collector({state:new CityState(),token:'test-token',userId:'42',unionId:'7',Socket});
  try {c.start();const socket=Socket.last;socket.emit('open');const joins=socket.sent.slice();
    socket.reply(joins[3],{status:'error'});for(const frame of joins.slice(0,3))socket.reply(frame);
    assert.equal(c.status.connected,true);assert.equal(c.status.battleDetails.state,'denied');
  } finally {c.stop();}
});

test('多場戰況公平輪詢；逾時後不接受遲到回覆',()=>{
  const state=new CityState(),c=new Collector({state,token:'test-token',userId:'42',unionId:'7',Socket});
  try {
    c.start();const socket=Socket.last;socket.emit('open');for(const frame of socket.sent.slice())socket.reply(frame);
    socket.reply(socket.sent.at(-1),{status:'ok',response:{cities:Array.from({length:20},(_,i)=>({id:i+1,sword:true,nation_battle:{id:i+100}}))}});
    const start=Date.now(),ids=[];let first;
    for(let i=0;i<20;i++){
      c.pollBattleDetails(start+i*21000);const query=socket.sent.at(-1);ids.push(query[4].city_id);
      if(!first)first=query;
      // 以實際時鐘比照查詢時間，避免模擬回覆前有新排程。
      const request=c.pending.get(query[1]);request.time=start+i*21000;
    }
    assert.equal(new Set(ids).size,20);
    socket.reply(first,{status:'ok',response:{offender:{power:123}}});
    assert.equal(state.cities.get(1).battle_details,null);
  } finally {c.stop();}
});

test('戰力只保留白名單，零值有效，換場／結束後晚到回覆不復活',()=>{
  const state=new CityState();state.ingest([{id:287,sword:true,nation_battle:{id:90}}]);
  const key=state.battleKey(state.cities.get(287));
  assert(state.ingestBattleDetails(287,{offender:{power:0,roll_count:0,flag:'https://secret'},defender:{power:-1,roll_count:1.5}},key));
  assert.deepEqual(state.cities.get(287).battle_details.offender,{power:0,roll_count:0});
  state.ingest([{id:287,sword:true,nation_battle:{id:91}}]);
  assert.equal(state.cities.get(287).battle_details,null);
  assert.equal(state.ingestBattleDetails(287,{offender:{power:99}},key),false);
  state.ingest([{id:287,sword:false}]);assert.equal(state.rows().length,0);
  state.ingest([{id:287,sword:true,nation_battle:{id:90}}]);
  assert.equal(state.ingestBattleDetails(287,{offender:{power:99}},key),false);
});
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
