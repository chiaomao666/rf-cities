import test from 'node:test';
import assert from 'node:assert/strict';
import {CityState} from './model.mjs';
const seed=()=>{const s=new CityState();s.ingest([{id:1,name:'城市',sword:true,nation_battle:{id:101,close_roll_call_at:'2026-10-07T01:00:00Z'},nation_battle_score:'1:0'},{id:2,sword:true}]);return s;};
const battle=s=>JSON.parse(s.rows().find(c=>c.city_id===1).nation_battle);
test('完整補查省略活動欄位仍保留持續交戰 ID，缺席城市移除',()=>{
  const s=seed();s.ingest([{id:1,sword:true}],{replace:true});
  assert.equal(battle(s).id,101);assert.equal(s.cities.has(2),false);
  s.ingest([{id:1,sword:true,nation_battle:{close_roll_call_at:'2026-10-07T01:00:00Z'}}],{replace:true});
  assert.equal(battle(s).id,101);
});
test('明確 null、ID null、換 ID 或換報到時間不沿用舊活動',()=>{
  for(const patch of [{nation_battle:null},{nation_battle:{id:null}},{nation_battle:{id:102}},{nation_battle:{close_roll_call_at:'2026-10-07T02:00:00Z'}}]) {
    for(const replace of [false,true]) {
      const s=seed();s.ingest([{id:1,sword:true,...patch}],{replace});
      assert.notEqual(battle(s).id,101);
      assert.equal(battle(s)._rf_monitor.score,null);
    }
  }
});
test('結束省略活動欄位亦清除；再次開戰不帶上一場 ID',()=>{
  const s=seed();s.ingest([{id:1,sword:false}]);s.ingest([{id:1,sword:true}]);
  assert.equal(battle(s).id,undefined);
});
test('明確結束後再次開始不沿用 ID；截止時間過去不等於結束',()=>{
  const s=seed();assert.equal(battle(s).id,101);
  s.ingest([{id:1,nation_battle:{ended:true}}]);assert.equal(s.rows().some(c=>c.city_id===1),false);
  s.ingest([{id:1,sword:true}]);assert.equal(battle(s).id,undefined);
});
