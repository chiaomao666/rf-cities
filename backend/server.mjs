import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {CityState} from './model.mjs';
import {Collector} from './collector.mjs';
import {SupabasePublisher} from './publisher.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const state=new CityState(), clients=new Set();
let collector;
function snapshot() { return {cities:state.rows({includeInactive:true}),status:{...collector.status,knownCities:state.cities.size,publication:{...publisher.status}}}; }
const publisher=new SupabasePublisher({url:process.env.SUPABASE_URL,key:process.env.SUPABASE_WRITE_KEY,getSnapshot:snapshot});
function broadcast() { publisher.request();for (const res of clients) res.write('event: change\ndata: {}\n\n'); }
collector=new Collector({state,token:process.env.RF_USER_TOKEN,userId:process.env.RF_USER_ID,
  locale:process.env.RF_LOCALE || 'zh_TW',url:process.env.RF_SOCKET_URL || 'wss://api.komisureiya.com/socket',onChange:broadcast});
const server=http.createServer(async (req,res)=>{
  const origin=req.headers.origin, allowed=process.env.PUBLIC_ORIGIN;
  if (origin && allowed && origin===allowed) res.setHeader('Access-Control-Allow-Origin',allowed);
  res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method!=='GET') {res.writeHead(405);res.end();return;}
  const pathname=new URL(req.url,'http://localhost').pathname;
  if (pathname==='/api/battles' || pathname==='/api/status') {
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(pathname==='/api/status'?snapshot().status:snapshot()));return;
  }
  if (pathname==='/api/events') {
    if (clients.size>=100) {res.writeHead(503);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});
    res.write('event: change\ndata: {}\n\n');clients.add(res);
    const keepalive=setInterval(()=>res.write(': keepalive\n\n'),15000);
    req.on('close',()=>{clients.delete(res);clearInterval(keepalive);});return;
  }
  // 不公開任意檔案：.env、後端原始碼、憑證一律不會被靜態網站送出。
  if (pathname==='/monitor-config.js') {
    try {
      const config=await readFile(path.join(root,'monitor-config.js'));
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});res.end(config);
    } catch {res.writeHead(404);res.end();}
    return;
  }
  const publicFiles={'/battle-map.css':'text/css; charset=utf-8','/cities-map.json':'application/json; charset=utf-8','/portal-map.png':'image/png','/inferred-routes.json':'application/json; charset=utf-8','/route-planner.js':'text/javascript; charset=utf-8'};
  const tile=/^\/tiles\/[0-6]\/\d{1,2}\/\d{1,2}\.png$/.test(pathname);
  if (publicFiles[pathname] || tile) {
    try {
      const data=await readFile(path.join(root,pathname.slice(1)));
      res.writeHead(200,{'Content-Type':tile?'image/png':publicFiles[pathname],'Cache-Control':tile?'public, max-age=86400':'no-cache'});res.end(data);
    } catch {res.writeHead(404);res.end();}
    return;
  }
  if (!['/','/city_query_site.html'].includes(pathname)) {res.writeHead(404);res.end();return;}
  try {
    const html=await readFile(path.join(root,'city_query_site.html'));
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(html);
  } catch {res.writeHead(500);res.end('Website file unavailable');}
});
server.listen(Number(process.env.PORT || 8787),process.env.HOST || '127.0.0.1',()=>{
  console.log('RF monitor listening on port '+(process.env.PORT || 8787));
  publisher.start();
  collector.start();
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  collector.stop();publisher.stop();for (const res of clients)res.end();server.close(()=>process.exit(0));
});
