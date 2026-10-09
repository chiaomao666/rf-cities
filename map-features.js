(function(root){
"use strict";
const NATIONS={紅軍:'#ff3732',香港:'#bd55f5',蒙古:'#008af7',藏國:'#49cf87',哈薩克:'#00e2ca',維吾爾:'#9abaff',滿洲:'#ffc400',滿州:'#ffc400',臺灣:'#08a2bc',台灣:'#08a2bc',反賊聯盟:'#ffffff',無:'#808080'};
const DAY=86400000,MAX_FRAMES=1500,MAX_CITIES=700,MAX_BYTES=60000000;
const dateKey=t=>new Date(new Date(t).getTime()+8*3600000).toISOString().slice(0,10);
const string=v=>typeof v==='string'?v.slice(0,160):null;
function cleanBattle(value){
 try{const b=typeof value==='string'?JSON.parse(value):value;if(!b||typeof b!=='object'||Array.isArray(b))return null;
  const result={};for(const k of ['id','close_roll_call_at','ended_at','finished_at','ended','finished'])if(['string','number','boolean'].includes(typeof b[k])||b[k]===null)result[k]=b[k];
  if(typeof b.nation_icon==='string'&&/^\/images\/nation\/color_icon\/minicoa\d{2}(CM|HK|MG|TB|KZ|UG|MC|TW|RB)\.png$/.test(b.nation_icon))result.nation_icon=b.nation_icon;
  if(b._rf_monitor&&typeof b._rf_monitor==='object'){result._rf_monitor={active:b._rf_monitor.active===true};if(['number','string'].includes(typeof b._rf_monitor.score))result._rf_monitor.score=String(b._rf_monitor.score).slice(0,40);}
  return JSON.stringify(result);
 }catch{return null;}
}
function cleanCities(rows){
 if(!Array.isArray(rows)||rows.length>MAX_CITIES)throw Error('城市清單格式或數量不正確');
 const ids=new Set();return rows.map(c=>{
  if(!c||!Number.isSafeInteger(Number(c.city_id))||Number(c.city_id)<=0||ids.has(Number(c.city_id)))throw Error('城市 ID 無效或重複');
  ids.add(Number(c.city_id));return {city_id:Number(c.city_id),name:string(c.name),control_nation_name:string(c.control_nation_name),control_union_id:Number.isSafeInteger(Number(c.control_union_id))&&Number(c.control_union_id)>0?Number(c.control_union_id):null,control_union_name:string(c.control_union_name),nation_battle:cleanBattle(c.nation_battle)};
 }).sort((a,b)=>a.city_id-b.city_id);
}
function validateReport(data){
 if(data?.kind!=='rf-battle-report'||data.version!==1||!Array.isArray(data.frames)||!data.frames.length||data.frames.length>MAX_FRAMES)throw Error('請匯入本站匯出的戰報 JSON（最多 1500 個快照）');
 const frames=data.frames.map(f=>{const t=Date.parse(f?.captured_at);if(!Number.isFinite(t))throw Error('快照時間無效');return {captured_at:new Date(t).toISOString(),cities:cleanCities(f.cities)};}).sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at));
 if(new Set(frames.map(f=>f.captured_at)).size!==frames.length)throw Error('快照時間重複');
 return {kind:'rf-battle-report',version:1,frames};
}
function rankings(cities){
 const nations=new Map(),unions=new Map();for(const c of cities){
  const n=c.control_nation_name||'未取得';if(!nations.has(n))nations.set(n,{key:n,name:n,color:NATIONS[n]||'#808080',ids:[]});nations.get(n).ids.push(c.city_id);
  const id=c.control_union_id;if(id!=null){const key=String(id);if(!unions.has(key))unions.set(key,{key,name:c.control_union_name||`聯盟 #${id}`,color:NATIONS[n]||'#808080',ids:[]});unions.get(key).ids.push(c.city_id);}
 }
 const sort=map=>[...map.values()].sort((a,b)=>b.ids.length-a.ids.length||a.name.localeCompare(b.name,'zh-TW'));
 return {nations:sort(nations),unions:sort(unions),unknownUnions:cities.filter(c=>c.control_union_id==null).length};
}
function reportChanges(frames){
 const changes=[];for(let i=1;i<frames.length;i++){const before=new Map(frames[i-1].cities.map(c=>[c.city_id,c]));for(const c of frames[i].cities){const old=before.get(c.city_id);if(!old)continue;if(old.control_nation_name!==c.control_nation_name||old.control_union_id!==c.control_union_id)changes.push({at:frames[i].captured_at,city_id:c.city_id,name:c.name||String(c.city_id),from:old.control_nation_name||'未取得',to:c.control_nation_name||'未取得',fromUnion:old.control_union_name||'未取得',toUnion:c.control_union_name||'未取得'});}}
 return changes;
}
function territories(cities,width,height){
 const seeds=cities.filter(c=>Number.isFinite(Number(c.x_position))&&Number.isFinite(Number(c.y_position))&&c.x_position!=null&&c.y_position!=null).map(c=>({id:c.city_id,x:Number(c.x_position),y:Number(c.y_position)}));
 return seeds.map((s,index)=>{
  // Bounded Voronoi cells are an illustration, not official sovereignty borders.
  let polygon=Array.from({length:20},(_,i)=>[Math.max(0,Math.min(width,s.x+500*Math.cos(i*Math.PI/10))),Math.max(0,Math.min(height,s.y+500*Math.sin(i*Math.PI/10)))]);
  for(let j=0;j<seeds.length&&polygon.length;j++){if(j===index)continue;const other=seeds[j],a=other.x-s.x,b=other.y-s.y;if(a===0&&b===0){if(j<index)polygon=[];continue;}const limit=(other.x**2+other.y**2-s.x**2-s.y**2)/2,next=[];
   for(let k=0;k<polygon.length;k++){const p=polygon[k],q=polygon[(k+1)%polygon.length],dp=a*p[0]+b*p[1]-limit,dq=a*q[0]+b*q[1]-limit;if(dp<=.0001)next.push(p);if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);next.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}}
   polygon=next;
  }return {id:s.id,polygon};
 });
}
function shortestRoute(routes,cities,start,end,types){
 const coords=new Map(cities.filter(c=>c.x_position!=null&&c.y_position!=null).map(c=>[Number(c.city_id),[Number(c.x_position),Number(c.y_position)]]));
 const nearest=p=>{let id=null,d=40;for(const [key,q]of coords){const n=Math.hypot(p[0]-q[0],p[1]-q[1]);if(n<d){id=key;d=n;}}return id;};
 const graph=new Map();const add=(a,b,path,length)=>{if(!graph.has(a))graph.set(a,[]);graph.get(a).push({to:b,path,length});};
 for(const r of routes){if(!types.includes(r.type))continue;const points=r.points,last=r.curves?.length?r.curves.at(-1).slice(4):points.at(-1);const a=nearest(points[0]),b=nearest(last);if(a==null||b==null||a===b)continue;
  const length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);add(a,b,r,length);add(b,a,r,length);
 }
 start=Number(start);end=Number(end);if(start===end||!coords.has(start)||!coords.has(end))throw Error('請選兩座不同城市');
 const dist=new Map([[start,0]]),previous=new Map(),visited=new Set();
 while(true){let current=null,best=Infinity;for(const [id,d]of dist)if(!visited.has(id)&&d<best){current=id;best=d;}if(current==null)throw Error('目前路線檔沒有相連的可用路徑；不會以直線補接');if(current===end)break;visited.add(current);
  for(const edge of graph.get(current)||[]){const cost=best+edge.length;if(cost<(dist.get(edge.to)??Infinity)){dist.set(edge.to,cost);previous.set(edge.to,{from:current,...edge});}}
 }
 const segments=[],ids=[end];let current=end;while(current!==start){const step=previous.get(current);segments.unshift(step.path);current=step.from;ids.unshift(current);}return {segments,ids,distance:dist.get(end)};
}
function download(doc,value,name,type='application/json'){
 const blob=new Blob([typeof value==='string'?value:JSON.stringify(value)],{type});const url=URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
class MapFeatures{
 constructor({getCities,getLive,focusCity,onChange,loadCloud,beforePanel,openMenu,width,height,document:doc=root.document,storage}){
  Object.assign(this,{getCities,getLive,focusCity,onChange,loadCloud,beforePanel,openMenu,width,height,doc,storage});this.el=id=>doc.getElementById(id);this.frames=[];this.localFrames=[];this.imported=[];this.frame=null;this.filter=null;this.playing=false;this.loadToken=0;this.geometry=[];
  try{this.storage=storage||root.localStorage;const saved=JSON.parse(this.storage.getItem('rf-history-local-v1')||'null');if(saved)this.localFrames=validateReport(saved).frames.slice(-60);}catch{this.localStorageError=true;}
  this.el('rankClose').onclick=()=>this.closePanels();this.el('historyClose').onclick=()=>this.live();
  this.el('openRankings').onclick=()=>this.openRankings();this.el('openHistory').onclick=()=>this.openHistory();
  this.el('historySource').onchange=()=>this.loadHistory();this.el('historyDate').onchange=()=>this.loadHistory();this.el('historyDate').value=dateKey(Date.now());
  this.el('historySlider').oninput=()=>this.selectFrame(Number(this.el('historySlider').value));
  this.el('historyPlay').onclick=()=>this.togglePlayback();this.el('historySpeed').onchange=()=>{if(this.playing){this.pause();this.togglePlayback();}};
  this.el('historyExport').onclick=()=>this.exportReport();this.el('historyCsv').onclick=()=>this.exportCsv();
  this.el('historyImport').onchange=e=>void this.importReport(e.target.files?.[0]);
  this.el('rankClear').onclick=()=>{this.filter=null;this.renderRanks();onChange();};this.el('rankSearch').oninput=()=>this.renderRanks();
  this.el('navMap').onclick=()=>{this.closePanels();this.filter=null;this.live();};this.el('navRank').onclick=()=>this.openRankings();this.el('navHistory').onclick=()=>this.openHistory();this.el('navMore').onclick=openMenu;
  this.el('showTerritories').onchange=onChange;this.el('territoryMode').onchange=onChange;this.el('territoryOpacity').oninput=onChange;
  this.el('historyStatus').textContent='本機紀錄僅在本頁開啟且收到新資料時保存；不代表全天採集。';
  this.setFrameControls();
 }
 closePanels(){this.el('rankPanel').hidden=true;this.el('historyPanel').hidden=true;}
 openRankings(){this.beforePanel?.();this.pause();this.rankSignature=null;this.el('historyPanel').hidden=true;this.el('rankPanel').hidden=false;this.renderRanks();}
 openHistory(){this.beforePanel?.();this.filter=null;this.el('rankPanel').hidden=true;this.el('historyPanel').hidden=false;void this.loadHistory();}
 live(){++this.loadToken;this.pause();this.frame=null;this.el('historyPanel').hidden=true;this.onChange();}
 now(){return this.frame?Date.parse(this.frame.captured_at):Date.now();}
 frameCities(catalog){if(!this.frame)return null;const base=new Map(catalog.map(c=>[Number(c.city_id),c]));return this.frame.cities.map(c=>({...base.get(c.city_id),...c,control_observed_at:this.frame.captured_at,updated_at:this.frame.captured_at}));}
 filterCities(rows){if(!this.filter)return rows;return rows.filter(c=>this.filter.kind==='nation'?c.control_nation_name===this.filter.key:String(c.control_union_id)===this.filter.key);}
 capture(rows,connected){
  if(!connected||!rows.length)return;const cities=cleanCities(rows),signature=JSON.stringify(cities);if(this.captureSignature===signature)return;
  const now=Date.now();if(this.lastCapture&&now-this.lastCapture<60000){this.pending=true;return;}
  this.captureSignature=signature;this.lastCapture=now;this.pending=false;this.localFrames.push({captured_at:new Date(now).toISOString(),cities});this.localFrames=this.localFrames.slice(-60);
  try{let saved=JSON.stringify({kind:'rf-battle-report',version:1,frames:this.localFrames});while(saved.length>1800000&&this.localFrames.length>1){this.localFrames.shift();saved=JSON.stringify({kind:'rf-battle-report',version:1,frames:this.localFrames});}this.storage.setItem('rf-history-local-v1',saved);this.localStorageError=false;}catch{this.localStorageError=true;}
 }
 renderRanks(){
  if(this.el('rankPanel').hidden)return;const rows=this.getCities(),stats=rankings(rows),search=this.el('rankSearch').value.trim().toLowerCase();const signature=JSON.stringify([stats,search,this.filter,!!this.frame]);if(signature===this.rankSignature)return;this.rankSignature=signature;this.el('rankSummary').textContent=`${this.frame?'歷史':'目前'}快照 · ${rows.length} 座城市 · ${stats.unknownUnions} 座未取得聯盟 ID`;
  for(const [kind,list]of [['nation',stats.nations],['union',stats.unions]]){const target=this.el(kind==='nation'?'nationRanks':'unionRanks');target.replaceChildren();for(const row of list.filter(r=>`${r.name} ${r.key}`.toLowerCase().includes(search))){const b=this.doc.createElement('button');b.className='rank-row';b.style.setProperty('--rank-color',row.color);b.textContent=`${row.name}${kind==='union'?` #${row.key}`:''}　${row.ids.length} 城`;b.setAttribute('aria-pressed',String(this.filter?.kind===kind&&this.filter.key===row.key));b.onclick=()=>{this.filter={kind,key:row.key};this.renderRanks();this.onChange();};target.append(b);}}
  this.el('rankFilter').textContent=this.filter?'地圖已篩選；點「顯示全部」取消。':'點排行榜項目篩選地圖。';
 }
 setFrameControls(){const disabled=!this.frames.length;for(const id of ['historyPlay','historySlider','historyExport','historyCsv'])this.el(id).disabled=disabled;this.el('historySlider').max=Math.max(0,this.frames.length-1);}
 async loadHistory(){
  const token=++this.loadToken;this.pause();this.frame=null;this.frames=[];this.index=0;this.el('historyTime').textContent='';this.el('historyChanges').textContent='';this.setFrameControls();this.onChange();const source=this.el('historySource').value,date=this.el('historyDate').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;this.el('historyStatus').textContent='正在讀取紀錄…';
  try{let rows=source==='cloud'?await this.loadCloud(date):source==='import'?this.imported:this.localFrames;
   if(token!==this.loadToken)return;rows=rows.filter(f=>dateKey(f.captured_at)===date);this.frames=rows.length?validateReport({kind:'rf-battle-report',version:1,frames:rows}).frames:[];this.setFrameControls();
   this.el('historyStatus').textContent=this.frames.length?`${source==='cloud'?'雲端控制權':source==='import'?'匯入':'本機'} · ${this.frames.length} 個真實快照；紀錄間空白不補造。${source==='local'?'只涵蓋此瀏覽器收到資料的時段，最多保留 60 個快照。':''}${source==='cloud'?'雲端僅存陣營與聯盟變化，不含歷史比分／戰鬥詳情；每分鐘保留最後快照。':''}${this.localStorageError?' 本機儲存失敗，請匯出備份。':''}`:'這一天沒有紀錄。未啟用歷史保存或尚未開始採集時，不會有過去資料。';
   if(this.frames.length)this.selectFrame(0);
  }catch{if(token===this.loadToken)this.el('historyStatus').textContent='雲端歷史尚未啟用或連線失敗；請使用本機紀錄／匯入戰報。雲端需先執行 supabase/history.sql。';}
 }
 selectFrame(index){this.pause();this.applyFrame(index);}
 applyFrame(index){if(!this.frames.length)return;this.index=Math.max(0,Math.min(this.frames.length-1,index));this.frame=this.frames[this.index];this.el('historySlider').value=this.index;this.el('historyTime').textContent=new Date(this.frame.captured_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});this.el('historyChanges').textContent=`這一天記錄到 ${reportChanges(this.frames).length} 次控制陣營／聯盟變化（不是逐場勝負戰報）。`;this.onChange();}
 pause(){clearInterval(this.timer);this.playing=false;this.el('historyPlay').textContent='播放';}
 togglePlayback(){if(this.playing){this.pause();return;}if(!this.frames.length)return;if(this.index>=this.frames.length-1)this.applyFrame(0);this.playing=true;this.el('historyPlay').textContent='暫停';const speed=Math.max(1,Number(this.el('historySpeed').value)||1);this.timer=setInterval(()=>{if(this.index>=this.frames.length-1){this.pause();return;}this.applyFrame(this.index+1);},Math.max(40,1000/speed));}
 exportReport(){if(!this.frames.length)return;download(this.doc,{kind:'rf-battle-report',version:1,timeZone:'Asia/Taipei',frames:this.frames},`rf-war-report-${this.el('historyDate').value}.json`);}
 exportCsv(){const escape=v=>'"'+String(v??'').replace(/^[=+\-@]/,'\'$&').replace(/"/g,'""')+'"';const rows=[['時間','城市 ID','城市','原陣營','新陣營','原聯盟','新聯盟'],...reportChanges(this.frames).map(c=>[c.at,c.city_id,c.name,c.from,c.to,c.fromUnion,c.toUnion])];download(this.doc,'\uFEFF'+rows.map(r=>r.map(escape).join(',')).join('\r\n'),`rf-control-changes-${this.el('historyDate').value}.csv`,'text/csv;charset=utf-8');}
 async importReport(file){if(!file)return;try{if(file.size>MAX_BYTES)throw Error('檔案超過 60 MB');const data=validateReport(JSON.parse(await file.text()));this.imported=data.frames;this.el('historySource').value='import';this.el('historyDate').value=dateKey(this.imported[0].captured_at);await this.loadHistory();}catch(error){this.el('historyStatus').textContent='匯入失敗：'+error.message;}finally{this.el('historyImport').value='';}}
 drawTerritories(ctx,view){
  if(!this.el('showTerritories').checked)return;const rows=this.getCities(),signature=JSON.stringify(rows.map(c=>[c.city_id,c.x_position,c.y_position]));if(signature!==this.geometrySignature){this.geometry=territories(rows,this.width,this.height);this.geometrySignature=signature;}
  const byId=new Map(this.filterCities(rows).map(c=>[c.city_id,c])),union=this.el('territoryMode').value==='union';ctx.save();ctx.setLineDash([]);ctx.globalAlpha=Number(this.el('territoryOpacity').value)/100;
  for(const cell of this.geometry){const city=byId.get(cell.id);if(!city||!cell.polygon.length||!city.control_nation_name)continue;let color=NATIONS[city.control_nation_name]||'#808080';if(union&&city.control_union_id!=null)color=`hsl(${(Number(city.control_union_id)*137.508)%360} 65% 55%)`;ctx.beginPath();cell.polygon.forEach(([x,y],i)=>i?ctx.lineTo(view.offsetX+x*view.scale,view.offsetY+y*view.scale):ctx.moveTo(view.offsetX+x*view.scale,view.offsetY+y*view.scale));ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.stroke();}ctx.restore();
 }
}
root.RFMapFeatures=MapFeatures;root.RFMapTools={rankings,validateReport,cleanCities,reportChanges,territories,shortestRoute,dateKey,download};
})(globalThis);
