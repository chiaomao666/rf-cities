const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

let source = fs.readFileSync(path.join(__dirname, '../assets/mods/city_battle_uploader.js'), 'utf8');
new Function(source);
source = source.replace("  console.log('[據點戰上傳]", "  window.testAPI = {receive, ingest, flush, battleRow, pending};\n  console.log('[據點戰上傳]");
const requests = [];
let fail = false, hold = null;
class Socket {
  constructor() { this.listeners = {}; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
}
const context = {
  window: {WebSocket:Socket, addEventListener() {}},
  console: {log() {}, warn() {}},
  setInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, AbortSignal,
  fetch: async (url, options) => {
    requests.push({url, rows:JSON.parse(options.body)});
    if (hold) await hold;
    return {ok:!fail, status:fail ? 403 : 201, json:async () => ({message:'test rejected'})};
  }
};
vm.createContext(context);
vm.runInContext(source, context);
const api = context.window.testAPI;
const frame = cities => JSON.stringify([null,null,'all_players','update_data',{cities}]);

(async () => {
  // 真正的接收監聽，不以 debug log 的 chapter 欄位為必要條件。
  const socket = new context.window.WebSocket('wss://example.invalid');
  socket.listeners.message({data:frame([{id:52,sword:true,nation_battle:{id:900,close_roll_call_at:'2020-01-01',secret:'must not upload'},private:'must not upload'}])});
  await api.flush();
  assert.equal(requests.length, 1);
  const row = requests[0].rows[0], battle = JSON.parse(row.nation_battle);
  assert.deepEqual(Object.keys(row).sort(), ['city_id','nation_battle','updated_at']);
  assert.equal(battle._rf_monitor.active, true);
  assert.equal(battle.id, 900);
  assert.equal(battle.secret, undefined);
  assert.equal(row.private, undefined);
  assert.equal(context.window.RFCityBattleUploader.getStatus().pending, 0);

  // 未變化不重送；報到已截止不等於結束。
  api.receive(frame([{id:52,sword:true,nation_battle:{id:900,close_roll_call_at:'2020-01-01',secret:'must not upload'}}]));
  await api.flush();
  assert.equal(requests.length, 1);
  api.receive(frame([{id:52,nation_battle_score:'0:0'}]));
  await api.flush();
  assert.equal(JSON.parse(requests.at(-1).rows[0].nation_battle)._rf_monitor.score, '0:0');

  // 明確結束訊號清空舊活動；null 不能被 merge 成之前的活動。
  api.receive(frame([{id:52,sword:false,nation_battle:null,nation_battle_score:null}]));
  await api.flush();
  assert.equal(JSON.parse(requests.at(-1).rows[0].nation_battle)._rf_monitor.active, false);
  assert.equal(JSON.parse(requests.at(-1).rows[0].nation_battle).id, undefined);

  // 國家資料不能以相同 id 被當成城市；缺欄位也不是結束。
  const count = requests.length;
  api.receive(JSON.stringify([null,null,'locale:zh_TW','update_data',{nations:[{id:3,control_cities:52}]}]));
  api.receive(frame([{id:53,knife:true}]));
  await api.flush();
  assert.equal(requests.length, count);

  // HTTP 失敗保留佇列；成功後才刪除。
  fail = true;
  api.receive(frame([{id:54,sword:true,nation_battle:{id:901}}]));
  await api.flush();
  assert.equal(api.pending.size, 1);
  assert.match(context.window.RFCityBattleUploader.getStatus().error, /403/);
  fail = false;
  await api.flush();
  assert.equal(api.pending.size, 0);

  // 舊上傳還沒完成時，收到結束訊號不可丟失。
  api.receive(frame([{id:54,sword:true,nation_battle:{id:902}}]));
  let release;
  hold = new Promise(resolve => { release = resolve; });
  const flight = api.flush();
  api.receive(frame([{id:54,sword:false,nation_battle:null}]));
  release(); await flight; hold = null;
  assert.equal(api.pending.size, 1);
  await api.flush();
  assert.equal(JSON.parse(requests.at(-1).rows[0].nation_battle)._rf_monitor.active, false);
  console.log('PASS: socket capture, minimal fields, start/end, score, deduplication, retry, in-flight updates');
})().catch(error => { console.error(error); process.exitCode = 1; });
