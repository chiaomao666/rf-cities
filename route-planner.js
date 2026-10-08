(function(root){
"use strict";
const STORAGE_KEY="rf-map-planned-route-v1";
function validPoints(value,width,height){
 if(!Array.isArray(value)||value.length>300)return [];
 return value.filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=width&&p.y>=0&&p.y<=height)
  .map(p=>({x:p.x,y:p.y,name:typeof p.name==="string"?p.name.slice(0,80):"自訂位置",city_id:Number.isSafeInteger(p.city_id)?p.city_id:null}));
}
class RoutePlanner{
 constructor({width,height,onChange,document:doc=root.document,storage}){
  this.width=width;this.height=height;this.onChange=onChange;this.doc=doc;this.storage=storage;this.history=[];this.active=false;this.storageError=false;
  try{this.storage=storage||root.localStorage;this.points=validPoints(JSON.parse(this.storage.getItem(STORAGE_KEY)||"[]"),width,height);}catch{this.points=[];this.storageError=true;}
  this.el=id=>doc.getElementById(id);
  this.el("planClose").onclick=()=>this.close();
  this.el("planToggle").onclick=()=>{this.active=!this.active;this.render();this.onChange();};
  this.el("planUndo").onclick=()=>this.undo();
  this.el("planClear").onclick=()=>this.clear();
  this.render();
 }
 open(){this.el("routePlan").hidden=false;this.active=true;this.render();this.onChange();}
 close(){this.el("routePlan").hidden=true;this.active=false;this.onChange();}
 addPoint(point){
  if(!this.active||this.points.length>=300)return false;
  const next=validPoints([point],this.width,this.height)[0];if(!next)return false;
  const last=this.points.at(-1);if(last&&Math.hypot(last.x-next.x,last.y-next.y)<1)return false;
  this.remember();this.points.push(next);this.save();return true;
 }
 remember(){this.history.push(this.points.map(p=>({...p})));if(this.history.length>50)this.history.shift();}
 undo(){if(!this.history.length&&!this.points.length)return;this.points=this.history.length?this.history.pop():this.points.slice(0,-1);this.save();}
 clear(){if(!this.points.length)return;this.remember();this.points=[];this.save();}
 save(){try{this.storage.setItem(STORAGE_KEY,JSON.stringify(this.points));this.storageError=false;}catch{this.storageError=true;}this.render();this.onChange();}
 render(){
  this.el("planToggle").textContent=this.active?"暫停畫線":"繼續畫線";
  this.el("planUndo").disabled=!this.history.length&&!this.points.length;this.el("planClear").disabled=!this.points.length;
  const list=this.el("planPoints");list.replaceChildren();
  for(const point of this.points){const item=this.doc.createElement("li");item.textContent=point.name;list.append(item);}
  this.el("planInfo").textContent=`${this.points.length} 個途經點 · ${this.active?"點城市或空白處新增，拖曳可移動地圖":"畫線已暫停，可正常查看城市"}`;
  this.el("planStorage").textContent=this.storageError?"瀏覽器無法保存；目前路線只保留在本頁。":"自動保存在這個瀏覽器，不會上傳或跨裝置同步。";
 }
 draw(ctx,{scale,offsetX,offsetY}){
  if(!this.points.length)return;
  ctx.save();ctx.beginPath();
  this.points.forEach((p,i)=>{const x=offsetX+p.x*scale,y=offsetY+p.y*scale;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
  ctx.strokeStyle="rgba(0,0,0,.85)";ctx.lineWidth=6;ctx.stroke();ctx.strokeStyle="#ffdf6d";ctx.lineWidth=3;ctx.stroke();
  this.points.forEach((p,i)=>{
   const x=offsetX+p.x*scale,y=offsetY+p.y*scale;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle="#ffdf6d";ctx.fill();ctx.strokeStyle="#19231d";ctx.lineWidth=2;ctx.stroke();
   ctx.fillStyle="#101812";ctx.font="bold 11px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(String(i+1),x,y);
  });ctx.restore();
 }
}
root.RFRoutePlanner=RoutePlanner;root.RFValidateRoutePoints=validPoints;
})(globalThis);
