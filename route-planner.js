(function(root){
"use strict";
const STORAGE_KEY="rf-map-planned-route-v1";
function validPoints(value,width,height){
 if(!Array.isArray(value)||value.length>300)return [];
 return value.filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height)
  .map(p=>({x:p.x,y:p.y,name:typeof p.name==="string"?p.name.slice(0,80):"自訂位置",city_id:Number.isSafeInteger(p.city_id)?p.city_id:null}));
}
class RoutePlanner{
 constructor({width,height,onChange,getCities=()=>[],getRoutes=()=>[],document:doc=root.document,storage}){
  this.width=width;this.height=height;this.onChange=onChange;this.getCities=getCities;this.getRoutes=getRoutes;this.doc=doc;this.storage=storage;this.history=[];this.future=[];this.segments=[];this.active=false;this.storageError=false;
  try{this.storage=storage||root.localStorage;this.points=validPoints(JSON.parse(this.storage.getItem(STORAGE_KEY)||"[]"),width,height);}catch{this.points=[];this.storageError=true;}
  this.el=id=>doc.getElementById(id);
  this.el("planClose").onclick=()=>this.close();
  this.el("planToggle").onclick=()=>{this.active=!this.active;this.render();this.onChange();};
  this.el("planUndo").onclick=()=>this.undo();
  this.el("planClear").onclick=()=>this.clear();
  this.el("planRedo").onclick=()=>this.redo();this.el("planReverse").onclick=()=>this.reverse();
  this.el("planExport").onclick=()=>this.export();this.el("planImport").onchange=e=>void this.import(e.target.files?.[0]);
  this.el("planAuto").onclick=()=>this.auto();
  try{const extra=JSON.parse(this.storage.getItem('rf-map-planned-segments-v1')||'null');if(extra?.kind==='rf-planned-segments'&&JSON.stringify(extra.points)===JSON.stringify(this.points))this.segments=this.validateSegments(extra.segments);}catch{}
  this.render();
 }
 open(){this.el("routePlan").hidden=false;this.active=true;this.populateCities();this.render();this.onChange();}
 close(){this.el("routePlan").hidden=true;this.active=false;this.onChange();}
 addPoint(point){
  if(!this.active||this.points.length>=300)return false;
  const next=validPoints([point],this.width,this.height)[0];if(!next)return false;
  const last=this.points.at(-1);if(last&&Math.hypot(last.x-next.x,last.y-next.y)<1)return false;
  this.remember();this.segments=[];this.points.push(next);this.save();return true;
 }
 snapshot(){return JSON.parse(JSON.stringify({points:this.points,segments:this.segments}));}
 restore(state){this.points=state.points;this.segments=state.segments;}
 remember(){this.history.push(this.snapshot());if(this.history.length>50)this.history.shift();this.future=[];}
 undo(){if(!this.history.length&&!this.points.length)return;this.future.push(this.snapshot());if(this.history.length)this.restore(this.history.pop());else{this.points=this.points.slice(0,-1);this.segments=[];}this.save();}
 redo(){if(!this.future.length)return;this.history.push(this.snapshot());this.restore(this.future.pop());this.save();}
 clear(){if(!this.points.length)return;this.remember();this.points=[];this.segments=[];this.save();}
 reverse(){if(this.points.length<2)return;this.remember();this.points.reverse();this.segments.reverse();this.save();}
 editPoint(index,delta){if(index<0||index>=this.points.length)return;this.remember();this.segments=[];if(delta===null)this.points.splice(index,1);else{const other=index+delta;if(other<0||other>=this.points.length){this.history.pop();return;}[this.points[index],this.points[other]]=[this.points[other],this.points[index]];}this.save();}
 validateSegments(segments){if(!Array.isArray(segments)||segments.length>300)throw Error('路線段數無效');const data={coordinateWidth:this.width,coordinateHeight:this.height,authoritative:false,paths:segments};root.RFValidateRouteGeometry?.(data,this.width,this.height);let count=0;const valid=n=>Number.isFinite(n)&&Math.abs(n)<=Math.max(this.width,this.height)*4;return segments.map(s=>{if(!s||!['railway','dirt','airport'].includes(s.type)||!Array.isArray(s.points)||s.points.length<2||s.points.length>20000||!s.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(valid)))throw Error('路線座標無效');count+=s.points.length;if(count>300000)throw Error('路線節點過多');if(s.curves!==undefined&&(!Array.isArray(s.curves)||s.curves.length>1000||!s.curves.every(c=>Array.isArray(c)&&c.length===6&&c.every(valid))))throw Error('曲線控制點無效');return {type:s.type,points:s.points.map(p=>p.slice()),...(s.curves?{curves:s.curves.map(c=>c.slice())}:{})};});}
 save(){try{this.storage.setItem('rf-map-planned-segments-v1',JSON.stringify({kind:'rf-planned-segments',points:this.points,segments:this.segments}));this.storage.setItem(STORAGE_KEY,JSON.stringify(this.points));this.storageError=false;}catch{this.storageError=true;}this.render();this.onChange();}
 populateCities(){for(const id of ['planFrom','planTo']){const select=this.el(id),value=select.value;select.replaceChildren();for(const city of this.getCities()){const o=this.doc.createElement('option');o.value=String(city.city_id);o.textContent=`${city.name} #${city.city_id}`;select.append(o);}if(value)select.value=value;}}
 auto(){try{const types=[];for(const [id,type]of [['planRail','railway'],['planDirt','dirt'],['planAir','airport']])if(this.el(id).checked)types.push(type);const rows=this.getCities();const result=root.RFMapTools.shortestRoute(this.getRoutes(),rows,this.el('planFrom').value,this.el('planTo').value,types);this.remember();this.segments=this.validateSegments(result.segments);this.points=result.ids.map(id=>{const c=rows.find(c=>Number(c.city_id)===id);return {x:Number(c.x_position),y:Number(c.y_position),city_id:id,name:c.name||String(id)};});this.active=false;this.save();this.el('planInfo').textContent=`找到 ${this.segments.length} 段相連路線；已暫停畫線。線長僅用於比較，不代表移動時間。`;}catch(error){this.el('planInfo').textContent=error.message;}}
 export(){root.RFMapTools?.download(this.doc,{kind:'rf-planned-route',version:1,points:this.points,segments:this.segments},'rf-planned-route.json');}
 async import(file){if(!file)return;try{if(file.size>3000000)throw Error('規劃檔超過 3 MB');const data=JSON.parse(await file.text());if(data?.kind!=='rf-planned-route'||data.version!==1)throw Error('請匯入本站匯出的規劃檔');const points=validPoints(data.points,this.width,this.height);if(!Array.isArray(data.points)||points.length!==data.points.length)throw Error('途經點格式無效');const segments=this.validateSegments(data.segments||[]);this.remember();this.points=points;this.segments=segments;this.active=false;this.save();}catch(error){this.el('planInfo').textContent='匯入失敗：'+error.message;}finally{this.el('planImport').value='';}}
 render(){
  this.el("planToggle").textContent=this.active?"暫停畫線":"繼續畫線";
  this.el("planUndo").disabled=!this.history.length&&!this.points.length;this.el("planClear").disabled=!this.points.length;
  this.el("planRedo").disabled=!this.future.length;this.el("planReverse").disabled=this.points.length<2;this.el("planExport").disabled=!this.points.length;
  const list=this.el("planPoints");list.replaceChildren();
  this.points.forEach((point,index)=>{const item=this.doc.createElement("li");item.textContent=point.name;for(const [text,delta]of [['↑',-1],['↓',1],['✕',null]]){const b=this.doc.createElement('button');b.textContent=text;b.type='button';b.title=delta===null?'移除途經點':delta<0?'往前移':'往後移';b.disabled=delta!==null&&(index+delta<0||index+delta>=this.points.length);b.onclick=()=>this.editPoint(index,delta);item.append?.(b);}list.append(item);});
  this.el("planInfo").textContent=`${this.points.length} 個途經點 · ${this.active?"點城市或空白處新增，拖曳可移動地圖":"畫線已暫停，可正常查看城市"}`;
  this.el("planStorage").textContent=this.storageError?"瀏覽器無法保存；目前路線只保留在本頁。":"自動保存在這個瀏覽器，不會上傳或跨裝置同步。";
 }
 draw(ctx,{scale,offsetX,offsetY}){
  if(!this.points.length)return;
  ctx.save();ctx.beginPath();
  if(this.segments.length){for(const s of this.segments){ctx.moveTo(offsetX+s.points[0][0]*scale,offsetY+s.points[0][1]*scale);if(s.curves?.length){for(const c of s.curves)ctx.bezierCurveTo(offsetX+c[0]*scale,offsetY+c[1]*scale,offsetX+c[2]*scale,offsetY+c[3]*scale,offsetX+c[4]*scale,offsetY+c[5]*scale);}else for(const p of s.points.slice(1))ctx.lineTo(offsetX+p[0]*scale,offsetY+p[1]*scale);}}
  else this.points.forEach((p,i)=>{const x=offsetX+p.x*scale,y=offsetY+p.y*scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
  ctx.strokeStyle="rgba(0,0,0,.85)";ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle="#ffdf6d";ctx.lineWidth=3;ctx.stroke();
  this.points.forEach((p,i)=>{
   const x=offsetX+p.x*scale,y=offsetY+p.y*scale;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle="#ffdf6d";ctx.fill();ctx.strokeStyle="#19231d";ctx.lineWidth=2;ctx.stroke();
   ctx.fillStyle="#101812";ctx.font="bold 11px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(i+1),x,y);
  });ctx.restore();
 }
}
root.RFRoutePlanner=RoutePlanner;root.RFValidateRoutePoints=validPoints;
})(globalThis);
