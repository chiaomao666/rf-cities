(function(root){
"use strict";
const KEY="rf-map-route-editor-v1", TYPES=["railway","dirt","airport"];
const clone=value=>JSON.parse(JSON.stringify(value));
function validate(data,width,height){
 if(!data||data.coordinateWidth!==width||data.coordinateHeight!==height||data.authoritative!==false||!Array.isArray(data.paths)||data.paths.length>5000)throw Error("不是這張地圖的路線檔案");
 let count=0;
 for(const r of data.paths){
  if(!TYPES.includes(r.type)||!Array.isArray(r.points)||r.points.length<2||r.points.length>20000)throw Error("路線格式錯誤");
  count+=r.points.length;
  if(count>300000||!r.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=Math.max(width,height)*4)))throw Error("路線座標無效或過多");
  if(r.curves!==undefined&&(!Array.isArray(r.curves)||r.curves.length>1000||!r.curves.every(c=>Array.isArray(c)&&c.length===6&&c.every(n=>Number.isFinite(n)&&Math.abs(n)<=Math.max(width,height)*4))))throw Error("曲線控制點無效");
 }
 return clone(data);
}
function sample(route){
 if(!route.curves?.length)return route.points;
 const result=[route.points[0].slice()];let start=result[0];
 for(const c of route.curves){for(let i=1;i<=64;i++){const t=i/64,u=1-t;result.push([u*u*u*start[0]+3*u*u*t*c[0]+3*u*t*t*c[2]+t*t*t*c[4],u*u*u*start[1]+3*u*u*t*c[1]+3*u*t*t*c[3]+t*t*t*c[5]]);}start=[c[4],c[5]];}
 return result;
}
function distance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);}
class RouteEditor{
 constructor({width,height,onChange,getCities,isVisible,document:doc=root.document,storage}){
  Object.assign(this,{width,height,onChange,getCities,isVisible,doc});this.active=false;this.selected=-1;this.mode="select";this.history=[];this.future=[];this.pending=[];this.drag=null;this.consumed=new Set();this.message="";
  try{this.storage=storage||root.localStorage;}catch{}
  this.el=id=>doc.getElementById(id);
  this.el("editorClose").onclick=()=>this.close();
  for(const mode of ["select","add","pan"])this.el("editor"+mode).onclick=()=>{if(this.pending.length)this.remember();this.mode=mode;this.pending=[];this.render();this.onChange();};
  this.el("editorUndo").onclick=()=>this.undo();
  this.el("editorRedo").onclick=()=>this.redo();
  this.el("editorDelete").onclick=()=>{if(this.selected<0)return;this.remember();this.data.paths.splice(this.selected,1);this.selected=-1;this.save();};
  this.el("editorType").onchange=()=>{if(this.selected<0||this.mode==="add")return;this.remember();this.data.paths[this.selected].type=this.el("editorType").value;this.save();};
  this.el("editorSmooth").onclick=()=>this.smooth();
  this.el("editorFinish").onclick=()=>this.finish();
  this.el("editorExport").onclick=()=>this.export();
  this.el("editorImport").onchange=event=>this.import(event.target.files?.[0]);
  this.el("editorReset").onclick=()=>{if(!this.base||!root.confirm("還原網站原始路線？目前草稿會被取代，可按復原救回。"))return;this.remember();this.data=clone(this.base);this.selected=-1;this.pending=[];this.save();};
  this.render();
 }
 load(data){
  this.base=validate(data,this.width,this.height);this.data=clone(this.base);
  try{const draft=JSON.parse(this.storage?.getItem(KEY)||"null");if(draft){if(draft.base===JSON.stringify(this.base))this.data=validate(draft.data,this.width,this.height);else this.message="網站底圖路線已更新，舊草稿未自動套用。可匯出舊草稿備份，再自行匯入。";this.oldDraft=draft;}}catch{this.message="草稿讀取失敗，目前顯示網站路線。";}
  this.render();this.onChange();
 }
 get paths(){return this.data?.paths||[];}
 open(){this.active=true;this.el("routeEditor").hidden=false;this.render();this.onChange();}
 close(){this.active=false;this.drag=null;this.consumed.clear();this.pending=[];this.el("routeEditor").hidden=true;this.onChange();}
 snapshot(){return clone({data:this.data,pending:this.pending,mode:this.mode,selected:this.selected,type:this.el("editorType").value});}
 restore(state){this.data=state.data;this.pending=state.pending;this.mode=state.mode;this.selected=state.selected;this.el("editorType").value=state.type;}
 remember(){this.history.push(this.snapshot());if(this.history.length>12)this.history.shift();this.future=[];}
 undo(){if(!this.history.length||this.drag)return;this.future.push(this.snapshot());this.restore(this.history.pop());this.save();}
 redo(){if(!this.future.length||this.drag)return;this.history.push(this.snapshot());if(this.history.length>12)this.history.shift();this.restore(this.future.pop());this.save();}
 save(){this.message="";try{if(!this.storage)throw Error();this.storage.setItem(KEY,JSON.stringify({base:JSON.stringify(this.base),data:this.data}));this.oldDraft=null;this.message="草稿已保存在這個瀏覽器，尚未發布。";}catch{this.message="瀏覽器無法保存（可能容量不足）。請立即匯出備份，關閉頁面會遺失修改。";}this.render();this.onChange();}
 point(event,view){return [(event.clientX-view.offsetX)/view.scale,(event.clientY-view.offsetY)/view.scale];}
 snap(p,view){let best=null,limit=14/view.scale;for(const city of this.getCities()){const x=Number(city.x_position),y=Number(city.y_position);if(!Number.isFinite(x)||!Number.isFinite(y))continue;const d=Math.hypot(p[0]-x,p[1]-y);if(d<limit){limit=d;best=city;}}return best?{p:[Number(best.x_position),Number(best.y_position)],id:best.city_id}:{p,id:null};}
 handles(route){if(route.curves?.length){const handles=[{p:route.points[0],start:true}];route.curves.forEach((c,i)=>{for(const j of [0,2,4])handles.push({p:c.slice(j,j+2),curve:i,j});});return handles;}return route.points.map((p,i)=>({p,index:i}));}
 down(event,view){
  if(!this.active||!this.data||this.mode==="pan")return false;
  if(this.consumed.size){this.message="編輯時請使用單指；切換「移動地圖」可雙指縮放。";this.render();this.consumed.add(event.pointerId);return true;}
  this.consumed.add(event.pointerId);const p=this.point(event,view),route=this.paths[this.selected];
  if(this.mode==="add"){const hit=this.snap(p,view);this.remember();this.pending.push(hit);this.render();this.onChange();return true;}
  if(route){let best=null,limit=10/view.scale;for(const h of this.handles(route)){const d=Math.hypot(p[0]-h.p[0],p[1]-h.p[1]);if(d<limit){limit=d;best=h;}}if(best){this.drag={id:event.pointerId,h:best,moved:false,future:this.future};return true;}}
  let best=-1,limit=9/view.scale;this.paths.forEach((r,index)=>{if(!this.isVisible(r.type))return;const pts=r.points;for(let i=1;i<pts.length;i++){const d=distance(p,pts[i-1],pts[i]);if(d<limit){limit=d;best=index;}}});this.selected=best;this.render();this.onChange();return true;
 }
 move(event,view){
  if(!this.consumed.has(event.pointerId))return false;
  if(!this.drag||this.drag.id!==event.pointerId)return true;
  if(!this.drag.moved)this.remember();
  const r=this.paths[this.selected],h=this.drag.h;let p=this.point(event,view);
  p=[Math.max(0,Math.min(this.width,p[0])),Math.max(0,Math.min(this.height,p[1]))];
  const end=h.start||h.index===0||h.index===r.points.length-1||h.j===4&&h.curve===r.curves.length-1;
  const hit=end?this.snap(p,view):{p,id:null};p=hit.p;
  if(h.start)r.points[0]=p;else if(h.curve!==undefined)r.curves[h.curve].splice(h.j,2,...p);else r.points[h.index]=p;
  if(end){if(h.start||h.index===0)r.from=hit.id;else r.to=hit.id;}
  if(r.curves?.length)r.points=sample(r);
  r.review="manual-editor-v1";delete r.referenceBounds;delete r.referenceRegions;this.drag.moved=true;this.onChange();return true;
 }
 up(event,cancel=false){if(!this.consumed.delete(event.pointerId))return false;if(this.drag?.id===event.pointerId){if(cancel&&this.drag.moved){this.restore(this.history.pop());this.future=this.drag.future;this.render();this.onChange();}else if(this.drag.moved)this.save();this.drag=null;}return true;}
 finish(){if(this.pending.length<2)return;this.remember();const first=this.pending[0],last=this.pending.at(-1);this.paths.push({type:this.el("editorType").value,from:first.id,to:last.id,review:"manual-editor-v1",points:this.pending.map(h=>h.p)});this.selected=this.paths.length-1;this.pending=[];this.mode="select";this.save();}
 smooth(){const r=this.paths[this.selected];if(!r||r.curves?.length||!root.confirm("將所選折線改成一段曲線？原本中間的線形會被取代，可按復原。"))return;this.remember();const a=r.points[0],b=r.points.at(-1);r.curves=[[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3,a[0]+(b[0]-a[0])*2/3,a[1]+(b[1]-a[1])*2/3,...b]];r.points=sample(r);r.review="manual-editor-v1";this.save();}
 export(){const data=this.oldDraft?.data||this.data;if(!data){this.message="路線尚未載入，無法匯出。";this.render();return;}const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/json"})),a=this.doc.createElement("a");a.href=url;a.download="reference-route-geometry-edited.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);this.message=this.oldDraft?"已匯出未套用的舊草稿。":"已匯出完整路線。這不會發布；可把檔案交給我更新網站。";this.render();}
 async import(file){if(!file)return;try{if(!this.base)throw Error("請等網站路線載入後再匯入");if(file.size>15000000)throw Error("檔案超過 15 MB");const data=validate(JSON.parse(await file.text()),this.width,this.height);if(!root.confirm("匯入會取代目前草稿，可按復原。確定匯入？"))return;this.remember();this.data=data;this.selected=-1;this.pending=[];this.save();}catch(error){this.message="匯入失敗："+error.message;this.render();}finally{this.el("editorImport").value="";}}
 render(){
  const route=this.paths[this.selected];for(const mode of ["select","add","pan"])this.el("editor"+mode).setAttribute("aria-pressed",String(mode===this.mode));
  this.el("editorDelete").disabled=!route;this.el("editorSmooth").disabled=!route||!!route.curves?.length;this.el("editorFinish").disabled=this.pending.length<2;this.el("editorUndo").disabled=!this.history.length;this.el("editorRedo").disabled=!this.future.length;
  this.el("editorReset").disabled=!this.base;this.el("editorExport").disabled=!this.data;
  if(route&&this.mode!=="add")this.el("editorType").value=route.type;
  this.el("editorInfo").textContent=!this.data?"路線尚未載入。":this.mode==="add"?`已放 ${this.pending.length} 個點；點城市可吸附，完成後按「完成新增」。`:this.mode==="pan"?"拖曳地圖、雙指縮放；調整完切回「選線／調整」。":route?`已選路線 #${this.selected+1}（${route.curves?.length?"曲線":"折線"}）。拖曳圓點調整；端點靠近城市會吸附。`:"點白色實線鐵路／白色虛線土路／已開啟的機場線來選取。";
  this.el("editorStatus").textContent=this.message||"修改只影響本機草稿，不上傳、不停止即時更新。";
 }
 draw(ctx,view){if(!this.active)return;const screen=p=>[view.offsetX+p[0]*view.scale,view.offsetY+p[1]*view.scale];ctx.save();const r=this.paths[this.selected];
  if(r){ctx.beginPath();r.points.forEach((p,i)=>{const q=screen(p);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.strokeStyle="#58ffca";ctx.lineWidth=4;ctx.stroke();
   if(r.curves?.length){let start=r.points[0];ctx.strokeStyle="#58ffca";ctx.lineWidth=1;ctx.setLineDash([4,4]);for(const c of r.curves){ctx.beginPath();ctx.moveTo(...screen(start));ctx.lineTo(...screen(c.slice(0,2)));ctx.moveTo(...screen(c.slice(4)));ctx.lineTo(...screen(c.slice(2,4)));ctx.stroke();start=c.slice(4);}ctx.setLineDash([]);}
   for(const h of this.handles(r)){ctx.beginPath();ctx.arc(...screen(h.p),h.j===0||h.j===2?5:6,0,Math.PI*2);ctx.fillStyle=h.j===0||h.j===2?"#ffdf6d":"#58ffca";ctx.fill();ctx.strokeStyle="#071416";ctx.lineWidth=2;ctx.stroke();}
  }
  if(this.pending.length){ctx.beginPath();this.pending.forEach((h,i)=>i?ctx.lineTo(...screen(h.p)):ctx.moveTo(...screen(h.p)));ctx.strokeStyle="#58ffca";ctx.lineWidth=3;ctx.stroke();for(const h of this.pending){ctx.beginPath();ctx.arc(...screen(h.p),6,0,Math.PI*2);ctx.fillStyle="#58ffca";ctx.fill();}}
  ctx.restore();
 }
}
root.RFRouteEditor=RouteEditor;root.RFValidateRouteGeometry=validate;root.RFSampleRouteCurve=sample;
})(globalThis);
