import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('活動 ID 可點擊，數字升降冪排序且缺失值固定最後',async()=>{
  const html=await readFile(new URL('../city_query_site.html',import.meta.url),'utf8');
  assert.match(html,/<th class="sortable" data-key="battle_id">活動 ID<span class="sort-arrow">/);
  const parse=html.slice(html.indexOf('  function parseBattle('),html.indexOf('  function activeBattle('));
  const sort=html.slice(html.indexOf('  function sortCities('),html.indexOf('  function updateSortIndicators('));
  const rows=[
    {city_id:1,nation_battle:JSON.stringify({id:'10'})},
    {city_id:2,nation_battle:{id:2}},
    {city_id:3,nation_battle:'{}'},
    {city_id:4,nation_battle:'invalid'},
    {city_id:5,nation_battle:{id:'not-a-number'}},
    {city_id:6,nation_battle:{id:null}}
  ];
  const context=vm.createContext({rows,sortState:{key:'battle_id',dir:'asc'}});
  vm.runInContext(parse+sort,context);
  assert.deepEqual(Array.from(vm.runInContext('sortCities(rows).map(c=>c.city_id)',context)),[2,1,3,4,5,6]);
  context.sortState.dir='desc';
  assert.deepEqual(Array.from(vm.runInContext('sortCities(rows).map(c=>c.city_id)',context)),[1,2,3,4,5,6]);
  assert.deepEqual(rows.map(c=>c.city_id),[1,2,3,4,5,6]);
});
