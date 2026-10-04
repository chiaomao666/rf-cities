# rf-cities

獨立的逆統戰據點戰監測站。

現在採用常駐 Node.js 後端直接連接遊戲授權 WebSocket，網站透過 API 與 SSE
接收戰況，不依賴遊戲模組，也不使用先前的 Supabase 城市上傳資料。

主頁為 `city_query_site.html`，僅顯示交戰城市。

## 本機使用

將 `.env.example` 複製成 `.env`，在自己的電腦填入授權採集帳號的
`RF_USER_ID` 和 `RF_USER_TOKEN`，執行 `npm start`，開啟 http://127.0.0.1:8787 。
不要直接以 file:// 開啟網站；登入憑證不要放入網頁或提交到 GitHub。

完整的連線限制、部署步驟與已驗證範圍見 [BACKEND.md](BACKEND.md)。
GitHub Pages 無法執行常駐後端，需另有 Node.js 主機；尚未部署至遠端主機。

測試：`npm test`。目前使用模擬連線驗證，實際遊戲連線仍需有效採集憑證。
