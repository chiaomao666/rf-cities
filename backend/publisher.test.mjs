import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SupabasePublisher} from './publisher.mjs';
const url='https://example.supabase.co';
const snapshot=()=>({cities:[{city_id:1,name:'測試城',control_union_id:4923,control_union_name:'測試聯盟',nation_battle:'{}',token:'PRIVATE'}],status:{state:'live',connected:true,userToken:'PRIVATE',knownCities:1}});

test('歷史讀取限合法日期與分頁，只回傳公開控制資料、不洩漏後端金鑰',async()=>{
 let request;const p=new SupabasePublisher({url,key:'sb_secret_test',getSnapshot:snapshot,Fetch:async(u,o)=>{request={u,o};return {ok:true,json:async()=>[{captured_at:'2026-10-09T01:00:00Z',token:'PRIVATE',cities:snapshot().cities}]};}});
 try{const rows=await p.readHistory('2026-10-09',500);assert.ok(!JSON.stringify(rows).includes('PRIVATE'));assert.match(String(request.u),/battle_monitor_history/);assert.ok(String(request.u).includes('offset=500'));assert.ok(String(request.u).includes('2026-10-08T16'));await assert.rejects(p.readHistory('bad',0));await assert.rejects(p.readHistory('2026-10-09',999));}finally{p.stop();}
});
test('發布僅包含公開白名單；空清單完整替換',async()=>{
  const calls=[];let current=snapshot();
  const p=new SupabasePublisher({url,key:'sb_secret_test',getSnapshot:()=>current,Fetch:async(u,o)=>{calls.push({u,o});return {ok:true};}});
  try {
    await p.flush();assert.equal(calls[0].o.headers.Authorization,undefined);
    assert.ok(!calls[0].o.body.includes('PRIVATE'));
    assert.equal(JSON.parse(calls[0].o.body).cities[0].control_union_name,'測試聯盟');
    assert.equal(JSON.parse(calls[0].o.body).cities[0].control_union_id,4923);
    current={cities:[],status:{state:'live'}};await p.flush();
    assert.deepEqual(JSON.parse(calls[1].o.body).cities,[]);assert.ok(p.status.lastPublished);
  } finally {p.stop();}
});
test('缺設定不發布；公開金鑰不能作為後端寫入金鑰',()=>{
  for(const key of [undefined,'sb_publishable_test']) {
    const p=new SupabasePublisher({url:key?url:undefined,key,getSnapshot:snapshot});
    assert.equal(p.status.enabled,false);p.stop();
  }
});
test('寫入錯誤不洩漏敏感例外訊息',async()=>{
  const p=new SupabasePublisher({url,key:'sb_secret_test',getSnapshot:snapshot,Fetch:async()=>{throw new Error('SECRET TOKEN');}});
  try {await p.flush();assert.ok(p.status.error);assert.ok(!JSON.stringify(p.status).includes('SECRET'));} finally {p.stop();}
});
test('寫入期間的更新安排後續發布',async()=>{
  let release,calls=0,current=snapshot();
  const p=new SupabasePublisher({url,key:'sb_secret_test',getSnapshot:()=>current,Fetch:async()=>{calls++;if(calls===1)await new Promise(r=>release=r);return {ok:true};}});
  try {const first=p.flush();current={...snapshot(),cities:[]};p.request();release();await first;assert.ok(p.timer);await p.flush();assert.equal(calls,2);} finally {p.stop();}
});

test('未變城市不重送；心跳只 PATCH 狀態，改變城市才更新版本',async()=>{
  let time=1000,current=snapshot();const calls=[];
  const p=new SupabasePublisher({url,key:'sb_secret_test',getSnapshot:()=>current,Now:()=>time,Fetch:async(u,o)=>{calls.push({u,o});return {ok:true};}});
  try {
    await p.flush();const version=JSON.parse(calls[0].o.body).status.citiesVersion;
    time+=30000;current.status.lastMessage='2026-10-14T00:00:00Z';await p.flush();assert.equal(calls.length,1);
    time+=30000;await p.flush();assert.equal(calls.length,2);assert.equal(calls[1].o.method,'PATCH');
    assert.equal(JSON.parse(calls[1].o.body).cities,undefined);assert.equal(JSON.parse(calls[1].o.body).status.citiesVersion,version);
    current.status.connected=false;await p.flush();assert.equal(calls.length,3);
    current.cities=[];await p.flush();assert.equal(calls[3].o.method,'POST');
    assert.notEqual(JSON.parse(calls[3].o.body).status.citiesVersion,version);
  }finally{p.stop();}
});
test('發布失敗不記住未發布版本，下次仍送完整城市',async()=>{
  let ok=false;const calls=[];
  const p=new SupabasePublisher({url,key:'sb_secret_test',getSnapshot:snapshot,Fetch:async(u,o)=>{calls.push(o);return {ok,status:503};}});
  try{await p.flush();ok=true;await p.flush();assert.deepEqual(calls.map(o=>o.method),['POST','POST']);assert.equal(p.status.error,null);}finally{p.stop();}
});
test('前端語法有效；GitHub 模式拒絕私密金鑰',async()=>{
  const html=await readFile(new URL('../city_query_site.html',import.meta.url),'utf8');
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];new vm.Script(script);
  const part=script.slice(script.indexOf('  let API_BASE'),script.indexOf('  let sourceStatus'));
  const check=key=>vm.runInNewContext(part+'\n({configError,useSupabase})',{
    window:{RF_MONITOR_CONFIG:{supabaseUrl:url,publishableKey:key}},location:{hostname:'chiaomao666.github.io',protocol:'https:'},URL,atob});
  assert.ok(check('sb_secret_private').configError);assert.equal(check('sb_publishable_public').configError,'');
});
