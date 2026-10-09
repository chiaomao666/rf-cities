import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../route-planner.js',import.meta.url),'utf8');
function fixture(initial='[]',blocked=false){
 const elements=new Map();let changed=0,saved=initial;
 const doc={getElementById(id){if(!elements.has(id))elements.set(id,{hidden:true,children:[],append(child){this.children.push(child);},replaceChildren(){this.children=[];}});return elements.get(id);},createElement(){return {};}};
 const storage={getItem(){if(blocked)throw Error('blocked');return saved;},setItem(k,v){if(blocked)throw Error('blocked');saved=v;}};
 const context=vm.createContext({document:doc});vm.runInContext(code,context);
 const planner=new context.RFRoutePlanner({width:11036,height:7505,document:doc,storage,onChange(){changed++;}});
 return {planner,context,elements,storage,getSaved:()=>JSON.parse(saved),getChanged:()=>changed};
}
test('路線只在規劃模式新增，座標驗證、防止重複點及本機保存',()=>{
 const f=fixture(),p=f.planner;
 assert.equal(p.addPoint({x:10,y:20}),false);p.open();
 assert.equal(p.addPoint({x:10,y:20,name:'臺北',city_id:1}),true);
 assert.equal(p.addPoint({x:10,y:20}),false);
 assert.equal(p.addPoint({x:11037,y:20}),false);
 assert.equal(p.addPoint({x:100,y:200,name:'自訂位置'}),true);
 assert.equal(f.getSaved().length,2);assert.equal(f.getSaved()[0].city_id,1);
 p.close();assert.equal(p.active,false);assert.equal(p.points.length,2);
 assert.ok(f.getChanged()>0);
});
test('規劃可重做、反轉與移除途經點；新修改清除重做',()=>{
 const {planner:p}=fixture();p.open();p.addPoint({x:10,y:10,name:'A'});p.addPoint({x:20,y:20,name:'B'});
 p.undo();assert.equal(p.points.length,1);p.redo();assert.equal(p.points.length,2);
 p.reverse();assert.equal(p.points[0].name,'B');p.undo();assert.equal(p.points[0].name,'A');
 p.editPoint(0,null);assert.equal(p.points[0].name,'B');assert.equal(p.future.length,0);
 p.undo();assert.equal(p.points.length,2);
});
test('規劃匯入保留曲線並可復原；拒絕壞座標且不覆寫',async()=>{
 const {planner:p,elements}=fixture();p.open();p.addPoint({x:10,y:10,name:'原本'});
 const data={kind:'rf-planned-route',version:1,points:[{x:20,y:20,name:'匯入'}],segments:[{type:'railway',points:[[20,20],[30,30]],curves:[[21,22,23,24,30,30]]}]};
 await p.import({size:100,text:async()=>JSON.stringify(data)});assert.equal(p.segments[0].curves.length,1);assert.equal(p.active,false);
 p.undo();assert.equal(p.points[0].name,'原本');p.redo();assert.equal(p.points[0].name,'匯入');
 data.segments[0].points[0][0]=null;await p.import({size:100,text:async()=>JSON.stringify(data)});
 assert.match(elements.get('planInfo').textContent,/匯入失敗/);assert.equal(p.points[0].name,'匯入');
 assert.throws(()=>p.validateSegments([{type:'railway',points:[[0,0],[1,1]],curves:[[NaN,0,0,0,1,1]]}]));
});
test('採用使用者手動編輯的完整路線，不覆寫成先前的臺灣描圖',async()=>{
 const data=JSON.parse(await readFile(new URL('../reference-route-geometry.json',import.meta.url),'utf8'));
 const {createHash}=await import('node:crypto');
 assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'),'b86aa09420548284d37b96ec74417d93980fb74d8fcb99bf49aa234dee39d0fd');
 assert.equal(data.paths.length,479);
 assert.equal(data.paths.filter(p=>p.type==='railway').length,278);
 assert.equal(data.paths.filter(p=>p.type==='dirt').length,177);
 assert.equal(data.paths.filter(p=>p.type==='airport').length,24);
 assert.ok(data.paths.some(p=>p.review==='manual-editor-v1'));
 for(const p of data.paths)for(const c of p.curves||[]){assert.equal(c.length,6);assert.ok(c.every(Number.isFinite));}
 const html=await readFile(new URL('../city_query_site.html',import.meta.url),'utf8');assert.match(html,/ctx\.bezierCurveTo/);
});
test('清除可復原，重新載入保存路線後也可逐點復原',()=>{
 const f=fixture('[{"x":20,"y":30,"name":"起點"}]'),p=f.planner;
 assert.equal(p.points.length,1);p.undo();assert.equal(p.points.length,0);
 p.open();p.addPoint({x:30,y:40});p.addPoint({x:60,y:80});p.clear();
 assert.equal(p.points.length,0);p.undo();assert.equal(p.points.length,2);
 p.undo();assert.equal(p.points.length,1);
});
test('保存遭封鎖不影響規劃；損壞資料不載入，文字不注入 HTML',()=>{
 const f=fixture('[]',true);f.planner.open();f.planner.addPoint({x:20,y:30,name:'<img onerror=alert(1)>'});
 assert.equal(f.planner.points.length,1);assert.match(f.elements.get('planStorage').textContent,/無法保存/);
 assert.equal(f.elements.get('planPoints').children[0].textContent,'<img onerror=alert(1)>');
 assert.equal(fixture('not json').planner.points.length,0);
 assert.equal(fixture('[{"x":-1,"y":2},{"x":"4","y":2}]').planner.points.length,0);
});
test('路線繪圖沿用地圖座標變換，不被即時快照清除',()=>{
 const {planner:p}=fixture('[{"x":20,"y":30},{"x":40,"y":50}]');const moves=[];
 const ctx=new Proxy({moveTo(x,y){moves.push([x,y]);},lineTo(x,y){moves.push([x,y]);}}, {get(target,key){return key in target?target[key]:()=>{};}});
 p.draw(ctx,{scale:2,offsetX:100,offsetY:200});
 assert.deepEqual(moves,[[140,260],[180,300]]);assert.equal(p.points.length,2);
});
test('路線人工核對鐵路、土路、機場，依固定 ID 且不誇稱完整或即時',async()=>{
 const data=JSON.parse(await readFile(new URL('../inferred-routes.json',import.meta.url),'utf8'));
 const cities=JSON.parse(await readFile(new URL('../cities-map.json',import.meta.url),'utf8'));const ids=new Set(cities.map(c=>c.city_id));
 assert.equal(data.authoritative,false);assert.equal(data.inferred,false);assert.equal(data.complete,false);assert.equal(data.referenceDate,'2025-10-11');assert.ok(data.routes.length>0);
 assert.equal(data.source,'manually-reviewed-2025-1011-reference');
 const keys=new Set();for(const r of data.routes){assert.ok(ids.has(r.from)&&ids.has(r.to));assert.notEqual(r.from,r.to);assert.ok(['railway','dirt','airport'].includes(r.type));assert.equal(r.review,'reference-endpoints');const key=r.type+':'+[r.from,r.to].sort((a,b)=>a-b).join(',');assert.ok(!keys.has(key));keys.add(key);}
 const html=await readFile(new URL('../city_query_site.html',import.meta.url),'utf8');
 assert.match(html,/background:"\.\/portal-map\.png"/);assert.doesNotMatch(html,/tileImage\(/);
 assert.match(html,/reference-route-geometry\.json/);
 assert.doesNotMatch(html,/quadraticCurveTo/);
 assert.match(html,/id="showAirRoutes" type="checkbox">/);
 const referenceIds=JSON.parse(await readFile(new URL('../reference-city-ids.json',import.meta.url),'utf8'));
 assert.equal(referenceIds['長沙'],286);assert.equal(referenceIds['東京'],64);assert.equal(referenceIds['廈門'],277);assert.equal(referenceIds['西貢'],45);
 const has=(a,b,type)=>data.routes.some(r=>r.type===type&&[r.from,r.to].includes(a)&&[r.from,r.to].includes(b));
 assert.equal(has(72,18,'railway'),false);assert.equal(has(72,18,'dirt'),true);
 assert.equal(has(572,566,'railway'),false);assert.equal(has(572,566,'dirt'),true);
 assert.equal(has(18,63,'railway'),true);assert.equal(has(63,64,'railway'),true);
 assert.equal(has(577,578,'dirt'),true);assert.equal(has(578,576,'railway'),true);
 assert.equal(has(110,567,'airport'),true);assert.equal(has(110,567,'railway'),false);
});
test('原圖曲線是多頂點幾何，不回退直線連城市；僅允許鐵路土路與機場',async()=>{
 const data=JSON.parse(await readFile(new URL('../reference-route-geometry.json',import.meta.url),'utf8'));
 assert.equal(data.source,'traced-original-2025-1011-strokes');assert.equal(data.authoritative,false);
 assert.equal(data.coordinateWidth,11036);assert.equal(data.coordinateHeight,7505);
 assert.equal(data.registration,'city-ID-piecewise-affine');
 assert.ok(data.paths.some(p=>p.points.length>10));
 for(const p of data.paths){assert.ok(['railway','dirt','airport'].includes(p.type));assert.ok(p.points.length>=2);for(const [x,y]of p.points){assert.ok(Number.isFinite(x)&&Number.isFinite(y));if(p.type==='airport')assert.ok(x>=-500&&x<=11536&&y>=-500&&y<=8005);else assert.ok(x>=0&&x<=11036&&y>=0&&y<=7505);}}
 const html=await readFile(new URL('../city_query_site.html',import.meta.url),'utf8');
 assert.match(html,/route\.points\.forEach/);assert.doesNotMatch(html,/railPairs|dirtPairs|const bend=/);
 const anchors=JSON.parse(await readFile(new URL('../reference-route-anchors.json',import.meta.url),'utf8'));
 assert.ok(Object.keys(anchors.points).length>=260);assert.ok(anchors.points['286']);assert.ok(anchors.points['64']);
});
