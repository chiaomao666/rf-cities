import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../map-features.js',import.meta.url),'utf8');
function fixture(){
 let now=Date.parse('2026-10-09T00:00:00Z'),changed=0;class Clock extends Date{static now(){return now;}}
 const timers=new Map();let timerId=0;const elements=new Map(),values=new Map();
 const doc={body:{append(){}},getElementById(id){if(!elements.has(id))elements.set(id,{hidden:true,value:'',children:[],style:{setProperty(){}},setAttribute(){},append(...c){this.children.push(...c);},replaceChildren(){this.children=[];},click(){this.onclick?.();},remove(){}});return elements.get(id);},createElement(){return {style:{setProperty(){}},setAttribute(){},children:[],append(...c){this.children.push(...c);},click(){},remove(){}};}};
 const context=vm.createContext({Date:Clock,document:doc,localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},setInterval(fn){timers.set(++timerId,fn);return timerId;},clearInterval(id){timers.delete(id);},setTimeout(){},Blob,URL});vm.runInContext(code,context);
 const cities=[{city_id:1,name:'改名城市',control_nation_name:'紅軍',control_union_id:5,control_union_name:'同名聯盟',x_position:100,y_position:100},{city_id:2,name:'第二城',control_nation_name:'香港',control_union_id:6,control_union_name:'同名聯盟',x_position:500,y_position:100},{city_id:3,name:'第三城',control_nation_name:'反賊聯盟',control_union_id:null,x_position:800,y_position:100}];
 const f=new context.RFMapFeatures({getCities:()=>cities,getLive:()=>cities,onChange(){changed++;},loadCloud:async()=>[],width:1000,height:1000,document:doc});
 doc.getElementById('historySource').value='local';return {f,tools:context.RFMapTools,cities,doc,values,timers,context,advance(ms){now+=ms;},changed:()=>changed};
}
test('排行依控制陣營、聯盟 ID 分组，同名聯盟不合併，反賊不是未知',()=>{
 const {tools,cities,f,doc}=fixture();const ranks=tools.rankings(cities);assert.equal(ranks.unions.length,2);assert.equal(ranks.unknownUnions,1);assert.equal(ranks.nations.find(n=>n.name==='反賊聯盟').color,'#ffffff');
 f.openRankings();doc.getElementById('unionRanks').children[0].onclick();assert.equal(f.filterCities(cities).length,1);doc.getElementById('rankClear').onclick();assert.equal(f.filterCities(cities).length,3);
 const button=doc.getElementById('nationRanks').children[0];f.renderRanks();assert.equal(doc.getElementById('nationRanks').children[0],button);
});
test('戰報嚴格驗證並剔除私密欄位、任意網址，不執行檔案內容',()=>{
 const {tools,cities}=fixture();const report=tools.validateReport({kind:'rf-battle-report',version:1,token:'PRIVATE',frames:[{captured_at:'2026-10-09T01:00:00Z',cities:[{...cities[0],token:'PRIVATE',nation_battle:JSON.stringify({token:'PRIVATE',nation_icon:'https://evil.example',_rf_monitor:{active:true,score:'1:0',token:'PRIVATE'}})}]}]});
 assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(!JSON.stringify(report).includes('evil.example'));assert.match(report.frames[0].cities[0].nation_battle,/1:0/);
 assert.throws(()=>tools.validateReport({kind:'wrong',frames:[]}));assert.throws(()=>tools.validateReport({kind:'rf-battle-report',version:1,frames:[{captured_at:'bad',cities:[]}]}));
 assert.throws(()=>tools.cleanCities([cities[0],cities[0]]));assert.equal(tools.dateKey('2026-10-08T16:01:00Z'),'2026-10-09');
});
test('本機只記錄新鮮快照、至多每分鐘一次，不記錄斷線或每秒重複心跳',()=>{
 const {f,cities,advance,values}=fixture();f.capture(cities,false);assert.equal(f.localFrames.length,0);f.capture(cities,true);f.capture(cities,true);assert.equal(f.localFrames.length,1);
 cities[0].control_nation_name='蒙古';f.capture(cities,true);assert.equal(f.localFrames.length,1);advance(60000);f.capture(cities,true);assert.equal(f.localFrames.length,2);assert.ok(values.has('rf-history-local-v1'));
 for(let i=0;i<70;i++){advance(60000);cities[0].control_union_id=i+100;f.capture(cities,true);}assert.equal(f.localFrames.length,60);
});
test('播放使用真正快照，不改即時清單；返回即時及載入競態不留下歷史模式',async()=>{
 const {f,cities,advance,doc,timers}=fixture();f.capture(cities,true);advance(60000);cities[0].control_nation_name='香港';f.capture(cities,true);
 await f.loadHistory();assert.equal(f.frame.cities[0].control_nation_name,'紅軍');assert.equal(cities[0].control_nation_name,'香港');assert.equal(f.frameCities(cities)[0].x_position,100);
 doc.getElementById('historySpeed').value='2';f.togglePlayback();[...timers.values()][0]();assert.equal(f.frame.cities[0].control_nation_name,'香港');[...timers.values()][0]();assert.equal(f.playing,false);f.live();assert.equal(f.frame,null);assert.equal(f.now(),Date.parse('2026-10-09T00:01:00Z'));
 let resolve;f.loadCloud=()=>new Promise(r=>resolve=r);doc.getElementById('historySource').value='cloud';const pending=f.loadHistory();f.live();resolve(f.localFrames);await pending;assert.equal(f.frame,null);
});
test('匯入失敗不覆寫戰報，匯入成功可播放；控制變化不推定逐場勝負',async()=>{
 const {f,cities,tools}=fixture();await f.importReport({size:5,text:async()=>'{bad'});assert.equal(f.imported.length,0);
 const frames=[{captured_at:'2026-10-09T01:00:00Z',cities:[cities[0]]},{captured_at:'2026-10-09T01:05:00Z',cities:[{...cities[0],control_nation_name:'香港'}]}];
 await f.importReport({size:100,text:async()=>JSON.stringify({kind:'rf-battle-report',version:1,frames})});assert.equal(f.frames.length,2);assert.equal(tools.reportChanges(f.frames).length,1);assert.equal(tools.reportChanges([frames[0]]).length,0);
});
test('色塊為有限範圍 Voronoi 估算，不外插整張海洋、座標不變',()=>{
 const {tools,cities}=fixture(),before=JSON.stringify(cities);const cells=tools.territories(cities,1000,1000);assert.equal(cells.length,3);for(const cell of cells)for(const p of cell.polygon)assert.ok(p.every(n=>Number.isFinite(n)&&n>=0&&n<=1000));assert.equal(JSON.stringify(cities),before);
});
test('自動規劃沿已存在的路線；未接合、交叉不補線，機場須明確啟用',()=>{
 const {tools}=fixture();const cities=[{city_id:1,x_position:0,y_position:0},{city_id:2,x_position:100,y_position:0},{city_id:3,x_position:200,y_position:0},{city_id:4,x_position:300,y_position:100}];
 const routes=[{type:'railway',points:[[0,0],[50,50],[100,0]]},{type:'dirt',points:[[100,0],[200,0]]},{type:'airport',points:[[200,0],[300,100]]}];
 const plan=tools.shortestRoute(routes,cities,1,3,['railway','dirt']);assert.equal(plan.segments.length,2);assert.deepEqual(Array.from(plan.ids),[1,2,3]);assert.throws(()=>tools.shortestRoute(routes,cities,1,4,['railway','dirt']));assert.equal(tools.shortestRoute(routes,cities,1,4,['railway','dirt','airport']).segments.length,3);
 assert.throws(()=>tools.shortestRoute([{type:'railway',points:[[-100,0],[100,0],[400,0]]}],cities,1,2,['railway']));assert.throws(()=>tools.shortestRoute(routes,cities,1,1,['railway']));
});
