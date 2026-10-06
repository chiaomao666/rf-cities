import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../city_query_site.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
class Element {
  constructor(){this.hidden=true;this.children=[];this.textContent='';this.value='';this.checked=false;this.classList={toggle(){}};}
  append(...children){this.children.push(...children);}
  replaceChildren(){this.children=[];this.textContent='';}
  addEventListener(){}
  getContext(){return {};}
}
test('完整地圖沿用即時快照：開始、比分更新、清除戰況與城市搜尋',async()=>{
  let current={cities:[{city_id:3,name:'基隆',nation_battle:JSON.stringify({id:9,_rf_monitor:{active:true,score:'0:0'}})}],status:{state:'live',connected:true}};
  const elements=new Map(),intervals=[];let eventSource;
  const context={URL,atob,AbortSignal,console,Date,queueMicrotask,innerWidth:1200,innerHeight:800,devicePixelRatio:1,
    location:{hostname:'localhost',protocol:'http:'},window:{RF_MONITOR_CONFIG:{}},
    document:{hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();},addEventListener(){}},
    addEventListener(){},requestAnimationFrame(){return 1;},setInterval(fn){intervals.push(fn);},setTimeout(){return 1;},clearTimeout(){},
    EventSource:class {constructor(){eventSource=this;}addEventListener(type,fn){this[type]=fn;}},
    fetch:async url=>({ok:true,json:async()=>url==='./cities-map.json'?[{city_id:3,name:'基隆',x_position:9263,y_position:5555},{city_id:1,name:'臺北',x_position:9105,y_position:5672}]:current})};
  vm.runInNewContext(script,context);await new Promise(resolve=>setImmediate(resolve));
  assert.match(elements.get('summary').textContent,/2 座城市 · 1 處即時戰況/);
  elements.get('battleList').children[0].onclick();
  assert.match(elements.get('detail').children[2].textContent,/比分：0:0/);
  current.cities[0].nation_battle=JSON.stringify({id:9,_rf_monitor:{active:true,score:'2:1'}});
  await eventSource.change();
  assert.match(elements.get('detail').children[2].textContent,/比分：2:1/);
  current={cities:[],status:{state:'live',connected:true}};await eventSource.change();
  assert.equal(elements.get('battleList').children.length,0);
  assert.match(elements.get('summary').textContent,/2 座城市 · 0 處/);
  assert.match(elements.get('detail').children[2].textContent,/目前沒有據點戰標記/);
  context.document.getElementById('query').value='臺北';elements.get('search').onsubmit({preventDefault(){}});
  assert.equal(elements.get('detail').children[1].textContent,'臺北');
  current={cities:[{city_id:999,name:'沒有座標',nation_battle:JSON.stringify({_rf_monitor:{active:true}})}],status:{state:'reconnecting',connected:false}};
  await eventSource.change();
  assert.match(elements.get('summary').textContent,/1 處上次戰況/);
  elements.get('battleList').children[0].onclick();
  assert.match(elements.get('detail').children[2].textContent,/尚未取得城市座標/);
});
test('戰況標记和结束信号与既有站點相同，過期報到時間不等於結束',()=>{
  const helpers=script.slice(script.indexOf('  function parseBattle('),script.indexOf('  async function fetchCities('));
  const context=vm.createContext({Date});vm.runInContext(helpers,context);
  assert.equal(context.activeBattle({sword:false,nation_battle:{id:1}}),false);
  assert.equal(context.activeBattle({nation_battle:{_rf_monitor:{active:false},id:1}}),false);
  assert.equal(context.activeBattle({nation_battle:{id:1,close_roll_call_at:'2020-01-01'}}),true);
  assert.equal(context.activeBattle({nation_battle_score:'0:0'}),true);
  assert.equal(context.activeBattle({nation_battle:{ended:true}}),false);
});
