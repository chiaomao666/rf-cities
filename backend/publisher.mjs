// 只發布公開戰況快照；登入權杖、原始封包、私密金鑰不進資料庫。
export class SupabasePublisher {
  constructor({url, key, getSnapshot, Fetch=globalThis.fetch}) {
    Object.assign(this,{url,key,getSnapshot,Fetch});
    this.status={enabled:false,lastPublished:null,error:null};
    this.stopped=false;this.busy=false;this.dirty=false;this.failures=0;
    if (!url && !key) return;
    try {
      const endpoint=new URL(url);
      if (endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=='/') throw new Error();
      let serviceRole=false;
      if (key && !key.startsWith('sb_secret_')) {
        try {serviceRole=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role==='service_role';} catch {}
      }
      if (!key || !(key.startsWith('sb_secret_') || serviceRole)) throw new Error();
      this.endpoint=endpoint.origin+'/rest/v1/battle_monitor_state?on_conflict=id';
      this.status.enabled=true;
    } catch {this.status.error='Supabase 設定無效；後端需要 HTTPS 專案網址與 secret／service_role 寫入金鑰';}
  }
  start() {
    if (!this.status.enabled) return;
    this.request();this.heartbeat=setInterval(()=>this.request(),30000);
  }
  request(delay=250) {
    if (!this.status.enabled || this.stopped) return;
    this.dirty=true;
    if (this.busy || this.timer) return;
    this.timer=setTimeout(()=>{this.timer=null;void this.flush();},delay);
  }
  async flush() {
    if (this.stopped || !this.status.enabled) return;
    if (this.busy) {this.dirty=true;return;}
    clearTimeout(this.timer);this.timer=null;this.busy=true;this.dirty=false;
    let failed=false;
    try {
      const current=this.getSnapshot();
      const cities=current.cities.map(c=>({city_id:c.city_id,name:c.name,
        control_nation_name:c.control_nation_name,control_union_id:c.control_union_id,
        control_union_name:c.control_union_name,updated_at:c.updated_at,nation_battle:c.nation_battle}));
      const status={};
      for (const field of ['state','connected','lastMessage','lastSnapshot','error','transportCode','knownCities']) status[field]=current.status[field] ?? null;
      const headers={'Content-Type':'application/json',apikey:this.key,Prefer:'resolution=merge-duplicates,return=minimal'};
      if (!this.key.startsWith('sb_secret_')) headers.Authorization='Bearer '+this.key;
      this.abort=new AbortController();
      const timeout=setTimeout(()=>this.abort.abort(),10000);
      try {
        const response=await this.Fetch(this.endpoint,{method:'POST',headers,
          body:JSON.stringify({id:1,cities,status}),signal:this.abort.signal});
        // 不輸出回覆本文或例外訊息，避免敏感設定出現在狀態 API。
        if (!response.ok) {this.status.error='Supabase 寫入失敗：HTTP '+response.status;failed=true;}
        else {this.status.lastPublished=new Date().toISOString();this.status.error=null;this.failures=0;}
        await response.body?.cancel();
      } finally {clearTimeout(timeout);this.abort=null;}
    } catch {failed=true;this.status.error='Supabase 寫入連線失敗或逾時';}
    finally {
      this.busy=false;
      if (failed) this.request(Math.min(60000,1000*2**Math.min(this.failures++,6)));
      else if (this.dirty) this.request();
    }
  }
  stop() {this.stopped=true;clearTimeout(this.timer);clearInterval(this.heartbeat);this.abort?.abort();}
  async readHistory(date,offset=0){
    if(!this.status.enabled||!/^\d{4}-\d{2}-\d{2}$/.test(date)||![0,500,1000].includes(offset))throw Error('歷史查詢無效');
    const start=new Date(date+'T00:00:00+08:00'),end=new Date(start.getTime()+86400000);
    if(!Number.isFinite(start.getTime()))throw Error('日期無效');
    const params=new URLSearchParams({select:'captured_at,cities',order:'captured_at.asc',limit:'500',offset:String(offset)});
    params.append('captured_at','gte.'+start.toISOString());params.append('captured_at','lt.'+end.toISOString());
    const headers={apikey:this.key};if(!this.key.startsWith('sb_secret_'))headers.Authorization='Bearer '+this.key;
    try{const response=await this.Fetch(new URL('/rest/v1/battle_monitor_history?'+params,this.endpoint),{headers,signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error();const rows=await response.json();if(!Array.isArray(rows)||rows.length>500)throw Error();
      return rows.map(row=>({captured_at:row.captured_at,cities:(Array.isArray(row.cities)?row.cities:[]).slice(0,700).map(c=>({city_id:c.city_id,name:c.name,control_nation_name:c.control_nation_name,control_union_id:c.control_union_id,control_union_name:c.control_union_name}))}));
    }catch{throw Error('歷史讀取失敗');}
  }
}
