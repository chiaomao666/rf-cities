// 公開設定只允許 publishable／anon 金鑰；禁止遊戲權杖或 secret／service_role。
// GitHub Pages 填好 publishableKey 後直接讀取 Supabase，不用公開 Oracle HTTP 埠。
// 本機頁面仍使用同站 API；forceSupabase 可在本機測試雲端資料。
window.RF_MONITOR_CONFIG = {
  apiBase: "",
  supabaseUrl: "https://bfecoizruicaaqxhmyqn.supabase.co",
  publishableKey: "sb_publishable_1rZAuHtmtEORxK73dbg4eQ_WavHHSMf",
  forceSupabase: false
};
