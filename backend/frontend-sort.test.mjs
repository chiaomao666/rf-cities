import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../city_query_site.html',import.meta.url),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
test('選單可開關、返回，設定同步顯示篩選且不停止更新',()=>{
 const elements=new Map();let draws=0;
 const $=id=>{
  if(!elements.has(id))elements.set(id,{hidden:false,checked:false,events:{},attrs:{},
   addEventListener(type,fn){this.events[type]=fn;},setAttribute(key,value){this.attrs[key]=value;},
   focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;this.events.close();}});
  return elements.get(id);
 };
 const code=script.slice(script.indexOf('function setupMenu('),script.indexOf('// 依陣營圖示'));
 const context=vm.createContext({$,requestDraw(){draws++;}});vm.runInContext(code,context);context.setupMenu();
 $('menuToggle').onclick();
 assert.equal($('siteMenu').open,true);assert.equal($('menuToggle').attrs['aria-expanded'],'true');
 assert.equal($('menuSettings').hidden,true);
 $('onlyBattle').checked=true;$('openSettings').onclick();
 assert.equal($('menuSettings').hidden,false);assert.equal($('settingsOnlyBattle').checked,true);
 $('settingsOnlyBattle').checked=false;$('settingsOnlyBattle').onchange();
 assert.equal($('onlyBattle').checked,false);assert.equal(draws,1);
 $('settingsBack').onclick();assert.equal($('menuLinks').hidden,false);
 $('siteMenu').events.click({target:$('openSettings')});assert.equal($('siteMenu').open,true);
 $('siteMenu').events.click({target:$('siteMenu')});assert.equal($('siteMenu').open,false);
 assert.equal($('menuToggle').attrs['aria-expanded'],'false');assert.equal($('menuToggle').focused,true);
 assert.doesNotMatch(code,/stopped\s*=|clearTimeout|socket\.close|fetch\(/);
 assert.match(html,/<dialog id="siteMenu"/);
});
test('城市圓點使用控制陣營，未知陣營為灰色',()=>{
  const code=script.slice(script.indexOf('const NATION_COLORS='),script.indexOf('  function parseBattle('));
  const context=vm.createContext({});vm.runInContext(code,context);
  assert.equal(context.cityColor({control_nation_name:'紅軍',sovereign:'臺灣'}),'#ff3732');
  assert.equal(context.cityColor({control_nation_name:'臺灣'}),'#08a2bc');
  assert.equal(context.cityColor({control_nation_name:'反賊聯盟'}),'#ffffff');
  assert.equal(context.cityColor({control_nation_name:'香港'}),'#bd55f5');
  assert.equal(context.cityColor({control_nation_name:'藏國'}),'#49cf87');
  assert.equal(context.cityColor({control_nation_name:'滿州'}),'#ffc400');
  assert.equal(context.cityColor({control_nation_name:'滿洲'}),'#ffc400');
  assert.equal(context.cityColor({control_nation_name:null}),'#808080');
  context.parseBattle=v=>typeof v==='string'?JSON.parse(v):v;
  assert.equal(context.attackerColor({control_nation_name:'紅軍'}),'#ffffff');
  assert.equal(context.attackerColor({control_nation_name:'紅軍',nation_battle:{_rf_monitor:{attacker_nation_name:'蒙古'}}}),'#008af7');
  for(const [code,name] of Object.entries({CM:'紅軍',HK:'香港',MG:'蒙古',TB:'藏國',KZ:'哈薩克',UG:'維吾爾',MC:'滿洲',TW:'臺灣',RB:'反賊聯盟'})){
    const city={control_nation_name:'蒙古',nation_battle:JSON.stringify({nation_icon:`/images/nation/color_icon/minicoa02${code}.png`})};
    assert.equal(context.attackerNation(city),name);
    assert.equal(context.attackerColor(city),context.cityColor({control_nation_name:name}));
  }
  assert.equal(context.attackerNation({nation_battle:{nation_icon:'/unknown.png'}}),null);
  assert.match(script,/ctx.fillStyle=cityColor\(city\)/);
});
class Element {
  constructor(){this.hidden=true;this.children=[];this.textContent='';this.value='';this.checked=false;this.classList={toggle(){}};this.style={setProperty(key,value){this[key]=value;}};}
  append(...children){this.children.push(...children);}
  replaceChildren(){this.children=[];this.textContent='';}
  addEventListener(){}
  getContext(){return {};}
}
test('較舊戰況不能覆蓋新控制權；較新控制權仍可更新',()=>{
 const code=script.slice(script.indexOf('function mergeCity('),script.indexOf('function rebuildCities('));
 const context=vm.createContext({Date});vm.runInContext(code,context);
 const base={control_nation_name:'香港',control_nation_id:3,control_observed_at:'2026-10-06T20:39:02Z',sovereign:'哈里發聯盟'};
 const old=context.mergeCity(base,{control_nation_name:'紅軍',updated_at:'2026-10-06T20:09:00Z',nation_battle:'active'});
 assert.equal(old.control_nation_name,'香港');assert.equal(old.control_nation_id,3);
 assert.equal(old.nation_battle,'active');assert.equal(old.sovereign,'哈里發聯盟');
 const fresh=context.mergeCity(base,{control_nation_name:'臺灣',updated_at:'2026-10-06T20:45:00Z'});
 assert.equal(fresh.control_nation_name,'臺灣');assert.equal(fresh.control_nation_id,null);
});
test('城市資料保留遊戲擷取的控制權、主權與座標',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../cities-map.json',import.meta.url),'utf8'));
 assert.equal(catalog.length,273);assert.equal(new Set(catalog.map(c=>c.city_id)).size,273);
 const city=catalog.find(c=>c.name==='拉瓦爾品第');
 assert.equal(city.control_nation_name,'香港');assert.equal(city.sovereign,'哈里發聯盟');
 assert.ok(catalog.every(c=>Number.isFinite(c.x_position)&&Number.isFinite(c.y_position)));
});
test('完整地圖沿用即時快照：開始、比分更新、清除戰況與城市搜尋',async()=>{
  let now=Date.parse('2026-10-07T01:00:00Z');
  class ClockDate extends Date {static now(){return now;}}
  let current={cities:[{city_id:3,name:'基隆',nation_battle:JSON.stringify({id:9,close_roll_call_at:'2026-10-07T01:01:05Z',_rf_monitor:{active:true,score:'0:0'}})}],status:{state:'live',connected:true}};
  const elements=new Map(),intervals=[];let eventSource;
  const context={URL,atob,AbortSignal,console,Date:ClockDate,queueMicrotask,innerWidth:1200,innerHeight:800,devicePixelRatio:1,
    location:{hostname:'localhost',protocol:'http:'},window:{RF_MONITOR_CONFIG:{}},
    document:{hidden:false,getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();},addEventListener(){}},
    addEventListener(){},requestAnimationFrame(){return 1;},setInterval(fn){intervals.push(fn);},setTimeout(){return 1;},clearTimeout(){},
    EventSource:class {constructor(){eventSource=this;}addEventListener(type,fn){this[type]=fn;}},
    fetch:async url=>({ok:true,json:async()=>url==='./cities-map.json'?[{city_id:3,name:'基隆',x_position:9263,y_position:5555},{city_id:1,name:'臺北',x_position:9105,y_position:5672}]:current})};
  vm.runInNewContext(script,context);await new Promise(resolve=>setImmediate(resolve));
  assert.match(elements.get('summary').textContent,/2 座城市 · 1 處即時戰況/);
  const originalButton=elements.get('battleList').children[0];
  assert.equal(originalButton.style['--attacker-color'],'#808080');
  assert.match(originalButton.children[0].textContent,/集結中（1分 5秒）/);
  now+=1000;intervals[0]();
  assert.equal(elements.get('battleList').children[0],originalButton);
  assert.match(originalButton.children[0].textContent,/集結中（1分 4秒）/);
  now+=64000;intervals[0]();
  assert.match(elements.get('battleList').children[0].children[0].textContent,/交戰中 · 比分 0:0/);
  elements.get('battleList').children[0].onclick();
  assert.match(elements.get('detail').children[2].textContent,/比分：0:0/);
  current.cities[0].control_nation_name='蒙古';
  current.cities[0].nation_battle=JSON.stringify({id:9,nation_icon:'/images/nation/color_icon/minicoa02HK.png',_rf_monitor:{active:true,score:'2:1'}});
  await eventSource.change();
  assert.equal(elements.get('battleList').children[0].style['--attacker-color'],'#bd55f5');
  assert.equal(elements.get('battleList').children[0].title,'攻擊方：香港');
  current.cities[0].nation_battle=JSON.stringify({id:9,nation_icon:'/images/nation/color_icon/minicoa04TB.png',_rf_monitor:{active:true,score:'2:1'}});
  await eventSource.change();
  assert.equal(elements.get('battleList').children[0].style['--attacker-color'],'#49cf87');
  assert.match(elements.get('detail').children[2].textContent,/比分：2:1/);
  current={cities:[{city_id:3,name:'基隆',control_nation_name:'紅軍',control_union_id:4923,control_union_name:'新聯盟',updated_at:'2026-10-07T01:02:00Z',nation_battle:null}],status:{state:'live',connected:true}};
  await eventSource.change();
  assert.equal(elements.get('battleList').children.length,0);
  assert.match(elements.get('detail').children[2].textContent,/控制陣營：紅軍/);
  assert.match(elements.get('detail').children[2].textContent,/控制聯盟：新聯盟/);
  assert.match(elements.get('detail').children[2].textContent,/聯盟 ID：4923/);
  assert.match(elements.get('detail').children[2].textContent,/目前沒有據點戰標記/);
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
