// 據點戰上傳：只觀察遊戲既有 WebSocket 收到的城市資料，不送遊戲指令。
// 必須在遊戲主程式前載入；nation_battle 沿用資料庫既有 text 欄位。
(function () {
  'use strict';
  if (window.RFCityBattleUploader) return;
  const URL = 'https://bfecoizruicaaqxhmyqn.supabase.co';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmZWNvaXpydWljYWFxeGhteXFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3MjU1MzEsImV4cCI6MjEwNDMwMTUzMX0.k42rUGqjZSW77Nw4Ua9c2pBBjpZ-kGrttqvuiKX-I0c';
  const cities = new Map(), pending = new Map(), sent = new Map(), receivedAt = new Map();
  const stats = { sockets: 0, frames: 0, uploads: 0, pending: 0, lastSuccess: null, error: null };
  let timer = null, busy = false, failures = 0, stopped = false;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function object(value) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return null; } }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }
  function battleRow(city) {
    const battle = object(city.nation_battle);
    const score = city.nation_battle_score;
    let active;
    if (city.sword === false) active = false;
    else if (battle?.ended_at || battle?.finished_at || battle?.ended === true || battle?.finished === true) active = false;
    else if (city.sword === true) active = true;
    else if (score != null && score !== false && String(score).trim() !== '') active = true;
    else if (battle && (battle.id != null || battle.close_roll_call_at)) active = true;
    else if (own(city, 'nation_battle') && city.nation_battle === null &&
             (!own(city, 'nation_battle_score') || score === null)) active = false;
    else return null; // 不把缺少欄位的增量封包解讀為戰鬥結束。
    // 僅儲存本站需要的公開戰況欄位，不外傳遊戲帳號、完整封包或完整城市資料。
    const snapshot = {};
    if (active && battle?.id != null) snapshot.id = battle.id;
    if (active && typeof battle?.close_roll_call_at === 'string') snapshot.close_roll_call_at = battle.close_roll_call_at;
    snapshot._rf_monitor = {
      version: 1, active, score: active && ['string', 'number'].includes(typeof score) ? score : null,
      observed_at: new Date(receivedAt.get(String(city.id)) || Date.now()).toISOString(),
      source: 'game_received_city_data'
    };
    const row = { city_id: city.id, nation_battle: JSON.stringify(snapshot), updated_at: new Date().toISOString() };
    return row;
  }
  function signature(row) {
    const data = JSON.parse(row.nation_battle);
    delete data._rf_monitor.observed_at;
    return JSON.stringify(data);
  }
  function enqueue(city, force = false) {
    const row = battleRow(city);
    if (!row) return;
    const id = String(city.id), sig = signature(row);
    if (!force && sent.get(id)?.signature === sig && !pending.has(id)) return;
    pending.set(id, { row, signature: sig });
    stats.pending = pending.size;
    schedule(200);
  }
  function ingest(patches, fromSocket = true) {
    if (!Array.isArray(patches)) return;
    for (const patch of patches) {
      if (!patch || typeof patch !== 'object' || !Number.isSafeInteger(Number(patch.id)) || Number(patch.id) <= 0) continue;
      const id = String(patch.id);
      // Store 在 React 下一次 render 前可能仍是舊值，不讓它覆寫剛收到的封包。
      if (!fromSocket && Date.now() - (receivedAt.get(id) || 0) < 2000) continue;
      const previous = cities.get(id) || {};
      const city = { ...previous, ...patch, id: Number(patch.id) };
      if (object(patch.nation_battle) && object(previous.nation_battle) &&
          (patch.nation_battle.id == null || patch.nation_battle.id === previous.nation_battle.id)) {
        city.nation_battle = { ...object(previous.nation_battle), ...object(patch.nation_battle) };
      }
      // 明確清空活動時清掉舊比分，避免先前比分讓已結束活動復活。
      if (own(patch, 'nation_battle') && patch.nation_battle === null && !own(patch, 'nation_battle_score')) city.nation_battle_score = null;
      const changed = JSON.stringify(previous) !== JSON.stringify(city);
      if (fromSocket || changed || !receivedAt.has(id)) receivedAt.set(id, Date.now());
      cities.set(id, city);
      enqueue(city);
    }
  }
  function receive(data) {
    if (typeof data !== 'string') return;
    let frame;
    try { frame = JSON.parse(data); } catch { return; }
    const event = Array.isArray(frame) ? frame[3] : frame.event;
    let payload = Array.isArray(frame) ? frame[4] : frame.payload;
    if (event !== 'update_data' && event !== 'phx_reply') return;
    if (event === 'phx_reply') payload = payload?.response?.payload || payload?.response;
    if (!Array.isArray(payload?.cities)) return;
    stats.frames++;
    ingest(payload.cities);
  }
  function schedule(delay) {
    if (timer || busy || stopped) return;
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }
  async function flush() {
    if (busy || stopped || !pending.size) return;
    busy = true;
    const batch = [...pending.entries()].slice(0, 100);
    try {
      // 同一批使用同樣欄位，避免 PostgREST 的 all object keys must match 錯誤。
      const base = batch.map(([, item]) => ({city_id:item.row.city_id,nation_battle:item.row.nation_battle,updated_at:item.row.updated_at}));
      const response = await fetch(URL + '/rest/v1/cities?on_conflict=city_id', {
        method:'POST', signal:AbortSignal.timeout(15000),
        headers:{apikey:KEY,Authorization:'Bearer ' + KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
        body:JSON.stringify(base)
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error('HTTP ' + response.status + (detail.message ? ': ' + detail.message : ''));
      }
      for (const [id, item] of batch) {
        sent.set(id, { signature:item.signature, time:Date.now() });
        if (pending.get(id) === item) pending.delete(id);
      }
      stats.uploads += batch.length;
      stats.lastSuccess = new Date().toISOString(); stats.error = null; failures = 0;
    } catch (error) {
      failures++;
      stats.error = error.message;
      console.warn('[據點戰上傳]', error.message);
    } finally {
      busy = false; stats.pending = pending.size;
      if (pending.size) schedule(failures ? Math.min(30000, 1000 * 2 ** Math.min(failures, 5)) : 200);
    }
  }

  const Native = window.WebSocket;
  function ObservedSocket(url, protocols) {
    const socket = arguments.length > 1 ? new Native(url, protocols) : new Native(url);
    stats.sockets++;
    socket.addEventListener('message', e => receive(e.data));
    return socket;
  }
  ObservedSocket.prototype = Native.prototype;
  Object.setPrototypeOf(ObservedSocket, Native);
  window.WebSocket = ObservedSocket;
  window.RFCityBattleUploader = { getStatus: () => ({...stats, knownCities:cities.size}) };

  // 補初始清單；不靠 console.log、chapter 欄位或開啟對話框才取得資料。
  let panel = null;
  setInterval(() => {
    if (stopped) return;
    if (!panel && window.UWPanel) panel = window.UWPanel.create({
      id:'rf_city_battle_upload', title:'[據點戰資料上傳]', tabTitle:'戰況上傳', side:'left',
      width:'250px', defaultState:'collapsed'
    });
    if (panel?.body) panel.body.textContent = stats.error
      ? '上傳失敗，將重試：' + stats.error
      : '收到戰況封包 ' + stats.frames + ' 則／已上傳 ' + stats.uploads + ' 筆／待上傳 ' + stats.pending + ' 筆。' +
        (stats.lastSuccess ? '最近成功：' + new Date(stats.lastSuccess).toLocaleTimeString('zh-TW') : '等待遊戲資料…');
    const store = window.RFStore?.get();
    if (store?.cities) ingest(store.cities, false);
    for (const [id, city] of cities) {
      const row = battleRow(city);
      if (row && JSON.parse(row.nation_battle)._rf_monitor.active && Date.now() - (sent.get(id)?.time || 0) > 30000) enqueue(city, true);
    }
  }, 1000);
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); timer = null; });
  window.addEventListener('pageshow', () => { stopped = false; if (pending.size) schedule(200); });
  console.log('[據點戰上傳] 已被動監聽遊戲 WebSocket；等待城市戰況。');
})();
