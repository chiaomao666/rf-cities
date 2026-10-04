# 獨立據點戰監測

網站 → 自己的 Node.js 後端 → 遊戲授權 WebSocket。
不需要遊戲頁面開啟，不需要遊戲模組，不使用 Supabase 舊城市資料。
後端只讀取公開城市資料，以及採集帳號有權讀取的 cities 清單；不發送參戰指令。

## 啟動

1. 安裝 Node.js 22 以上（本機已驗證 Node.js 24）。不需安裝第三方套件。
2. 在專案根目錄將 `.env.example` 複製為 `.env`。
3. 使用你授權的採集帳號，填 `RF_USER_ID` 與 `RF_USER_TOKEN`。
   現有遊戲主程式的 sessionStorage 名稱分別是 `userId`、`userToken`。
   請僅在自己的電腦上填入，不要貼在聊天室，不要提交到 GitHub。
4. 在此目錄執行 `npm start`。
5. 開啟 http://127.0.0.1:8787 ，不要直接用 file:// 開啟 HTML。

缺少憑證時仍可預覽網站，會明確顯示「後端尚未設定採集帳號」，不會連遊戲。
登入失效／訂閱遭拒會停止嘗試並顯示錯誤；更新合法憑證後重啟服務。
採集帳號 userId 必須是該 token 本人的 ID。不要猜測其他人的頻道。

## 常駐部署

GitHub Pages 只能放前端，不能執行這個常駐服務。
後端需部署至允許長時間運行 Node.js 與向外連線 WebSocket 的主機。
以主機的秘密設定保存權杖，使用程序管理／容器重啟政策保持服務運行。
部署時將 HOST 設為 0.0.0.0，並以 HTTPS 反向代理提供網站。

最簡單是同一後端同時提供網站，不必設定額外 API 網址。
若前端放在 https://chiaomao666.github.io/rf-cities/city_query_site.html ：

1. 將後端部署至可常駐運行的主機，取得公開的 HTTPS 網址。
2. 在主機秘密設定填 RF_USER_ID、RF_USER_TOKEN、HOST=0.0.0.0，
   並將 PUBLIC_ORIGIN 設為 https://chiaomao666.github.io （不含 /rf-cities）。
3. 在 monitor-config.js 的 apiBase 填入後端 HTTPS 網址。
4. 將 city_query_site.html 與 monitor-config.js 一起發布到 GitHub Pages。
5. 開啟網站，確認顯示「後端已連上遊戲」。

後端網址不是遊戲 WebSocket 網址，也不能填 127.0.0.1 本機網址。
monitor-config.js 不得包含遊戲權杖；憑證僅放在後端主機秘密設定。
不要在 HTTPS 前端呼叫 HTTP 後端。代理需允許 /api/events 的 SSE 長連線。

## 已實作／待驗證

- Phoenix v2 連線：使用主程式中的正式 socket 網址、userToken、locale。
- 訂閱 all_players、locale:zh_TW、採集帳號本人的 player 頻道。
- 初次取得完整 cities，之後即時合併 update_data；每分鐘完整補查一次。
- 更新不等待補查；報到截止不當成戰鬥結束；明確結束移除。
- 心跳、斷線退避重連、初始訂閱逾時、權限拒絕停止。
- 網站與後端透過 SSE 更新；後端狀態會顯示在網站。
- API 只回傳白名單公開欄位；不提供憑證、帳號資料、原始封包或任意靜態檔。
- 狀態保留於記憶體；服務重啟後重新取得清單，不以舊快取冒充即時戰況。

尚未使用真實帳號連到遊戲驗證：沒有提供採集憑證，也尚未指定後端部署主機。
主程式能證明協議與讀取流程，但不能保證伺服器允許第三方常駐連線、
同帳號多處登入，或保證公開頻道包含每個城市的攻守戰力。
目前只監測交戰城市、活動 ID、報到時間與伺服器提供的比分；
未收到的攻守戰力、人數不會造假成 0，也不繞過參戰資格。

測試：`npm test`。測試使用模擬連線，不登入遊戲、不送假戰況到線上資料庫。
