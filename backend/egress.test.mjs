import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../city_query_site.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const helper=script.slice(script.indexOf('  let citiesVersion=null;'),script.indexOf('function liveStale()'));
function fixture(){
  const calls=[],responses=[];
  const c=vm.createContext({useSupabase:true,publicKey:'sb_publishable_test',supabaseUrl:'https://example.supabase.co',
    sourceStatus:null,cloudUpdatedAt:null,allCities:[],AbortSignal,Date,
    fetch:async u=>{calls.push(u);return {ok:true,json:async()=>[responses.shift()]};}});
  vm.runInContext(helper,c);
  return {c,calls,responses,accept(data){c.allCities=c.applyCloudSnapshot(data);}};
}
const data=(version,time,cities=[])=>({cities,status:{connected:true,citiesVersion:version},updated_at:time});
test('相同版本備援補查只下載狀態，變更版本才抓城市',async()=>{
  const f=fixture();f.accept(data('1','2026-10-14T00:00:00Z',[{city_id:1}]));
  f.responses.push(data('1','2026-10-14T00:01:00Z'));await f.c.fetchCities(true);
  assert.equal(f.calls.length,1);assert.match(f.calls[0],/select=status,updated_at/);assert.equal(f.c.allCities.length,1);
  f.responses.push(data('2','2026-10-14T00:02:00Z'),data('2','2026-10-14T00:02:00Z',[{city_id:2}]));
  const result=await f.c.fetchCities(true);assert.equal(f.calls.length,3);assert.equal(result[0].city_id,2);
});
test('較早 HTTP 回覆不覆蓋即時資料，空城市清單仍可清除戰況',()=>{
  const f=fixture();f.accept(data('2','2026-10-14T00:02:00Z',[{city_id:2}]));
  f.accept(data('1','2026-10-14T00:01:00Z',[{city_id:1}]));assert.equal(f.c.allCities[0].city_id,2);
  f.accept(data('3','2026-10-14T00:03:00Z',[]));assert.equal(f.c.allCities.length,0);
});
