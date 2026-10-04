// Phoenix v2 JSON 格式：[join_ref, ref, topic, event, payload]。
// 只使用主程式已確認的頻道及讀取 cities 指令；不參戰、不寫入遊戲。
export class Collector {
  constructor({state, token, userId, locale='zh_TW', url='wss://api.komisureiya.com/socket', onChange=()=>{}, Socket=globalThis.WebSocket}) {
    Object.assign(this,{state,token,userId,locale,url,onChange,Socket});
    this.status = {state:'waiting_credentials',connected:false,lastMessage:null,lastSnapshot:null,error:null};
    this.ref=0; this.pending=new Map(); this.joins=new Map(); this.stopped=false; this.retry=0;
  }
  notify() { this.onChange(); }
  start() {
    if (!this.token || !/^\d+$/.test(String(this.userId || ''))) { this.notify(); return; }
    this.status.state='connecting'; this.status.error=null; this.notify();
    const url = new URL(this.url);
    if (url.protocol !== 'wss:') throw new Error('RF_SOCKET_URL 必須使用 wss://');
    url.pathname=url.pathname.replace(/\/$/,'')+'/websocket';
    url.searchParams.set('vsn','2.0.0'); url.searchParams.set('userToken',this.token); url.searchParams.set('locale',this.locale);
    const socket = this.socket = new this.Socket(url.toString());
    socket.addEventListener('open',()=>{
      this.retry=0; this.status.state='subscribing'; this.notify();
      for (const topic of ['all_players',`locale:${this.locale}`,`player:${this.userId}`]) this.send(topic,'phx_join',{},'join');
      this.heartbeat=setInterval(()=>{
        if (this.heartbeatRef) { socket.close(); return; }
        this.heartbeatRef=this.send('phoenix','heartbeat',{},'heartbeat');
      },25000);
    });
    socket.addEventListener('message',e=>this.receive(e.data));
    socket.addEventListener('error',()=>{ this.status.error='遊戲連線失敗，請檢查網路與登入設定'; this.notify(); socket.close(); });
    socket.addEventListener('close',()=>{
      clearInterval(this.heartbeat); clearInterval(this.snapshotTimer); clearTimeout(this.joinTimer);
      this.pending.clear(); this.joins.clear(); this.heartbeatRef=null;
      this.status.connected=false;
      if (!this.stopped && this.status.state!=='auth_error') {
        this.status.state='reconnecting';
        this.reconnect=setTimeout(()=>this.start(),Math.min(60000,1000*2**Math.min(this.retry++,6)));
      }
      this.notify();
    });
    this.joinTimer=setTimeout(()=>{ if (!this.status.connected) {this.status.error='頻道訂閱逾時';socket.close();} },20000);
  }
  send(topic,event,payload,kind) {
    if (this.socket?.readyState!==1) return null;
    const ref=String(++this.ref), joinRef=event==='phx_join'?ref:this.joins.get(topic)||null;
    this.pending.set(ref,{topic,kind,time:Date.now()});
    this.socket.send(JSON.stringify([joinRef,ref,topic,event,payload]));
    return ref;
  }
  snapshot() {
    if ([...this.pending.values()].some(item=>item.kind==='cities')) return;
    this.buffer=[];
    this.send(`player:${this.userId}`,'cities',{body:''},'cities');
  }
  receive(raw) {
    let frame; try { frame=JSON.parse(raw); } catch { return; }
    if (!Array.isArray(frame) || frame.length!==5) return;
    const [,ref,topic,event,payload]=frame;
    if (event==='phx_reply') {
      const request=this.pending.get(ref); if (!request || request.topic!==topic) return;
      this.pending.delete(ref);
      if (request.kind==='heartbeat') { this.heartbeatRef=null; return; }
      if (payload?.status!=='ok') {
        // 拒絕訂閱就停下，不嘗試猜 token／其他玩家頻道或繞過資格。
        this.status.state='auth_error';this.status.error='遊戲拒絕訂閱或讀取；請確認採集帳號的登入與權限';
        this.socket.close(); this.notify(); return;
      }
      if (request.kind==='join') {
        this.joins.set(topic,ref);
        if (this.joins.size===3) {
          clearTimeout(this.joinTimer);this.status.connected=true;this.status.state='live';this.snapshot();
          this.snapshotTimer=setInterval(()=>{
            if ([...this.pending.values()].some(item=>Date.now()-item.time>20000)) {this.socket.close();return;}
            this.snapshot();
          },60000);
          this.notify();
        }
      } else if (request.kind==='cities' && Array.isArray(payload.response?.cities)) {
        this.state.ingest(payload.response.cities,{replace:true});
        for (const patches of this.buffer || []) this.state.ingest(patches);
        this.buffer=null; this.status.lastSnapshot=new Date().toISOString();this.status.error=null;this.notify();
      } else if (request.kind==='cities') {
        this.buffer=null;this.status.error='遊戲 cities 回覆格式不符，尚未取得完整城市清單';this.notify();
      }
    } else if (event==='update_data' && this.joins.has(topic) && Array.isArray(payload?.cities)) {
      this.status.lastMessage=new Date().toISOString();
      if (this.buffer) this.buffer.push(payload.cities);
      this.state.ingest(payload.cities);this.notify();
    } else if (event==='phx_error' || event==='phx_close') this.socket.close();
  }
  stop() { this.stopped=true;clearTimeout(this.reconnect);this.socket?.close(); }
}
