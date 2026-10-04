# 獨立據點戰監測部署

Oracle 採集主機連接授權遊戲 WebSocket，發布公開交戰清單至 Supabase。
GitHub Pages 從 Supabase 讀取，收到即時通知就更新。
Oracle 8787 只監聽本機，不需要公開後端網址或額外開啟連接埠。

## 1. 建立資料表

在 Supabase 專案 bfecoizruicaaqxhmyqn 的 SQL Editor 執行 `supabase/setup.sql` 全部內容。
它新增 `battle_monitor_state`，不修改舊 cities 表。訪客只有讀取權限。
完整交戰清單原子替換，結束的城市不會殘留；SQL 同時啟用 Realtime。

## 2. 設定金鑰

Supabase Settings → API Keys：

- Publishable（或舊 anon）公開金鑰：填本機 `monitor-config.js` 的 `publishableKey`，隨前端發布。
- Secret（或舊 service_role）私密金鑰：只填 Oracle `/home/opc/rf-cities/.env` 的 `SUPABASE_WRITE_KEY`。

主機 `.env` 保留既有 RF_USER_ID、RF_USER_TOKEN，另外加入：

```dotenv
SUPABASE_URL=https://bfecoizruicaaqxhmyqn.supabase.co
SUPABASE_WRITE_KEY=在主機自行填入私密金鑰
```

私密金鑰、遊戲權杖不要貼到聊天、網頁或 GitHub。
`apiBase` 留空，GitHub Pages 自動使用 Supabase。本機仍用同站 API。
`forceSupabase: true` 可供本機測試雲端讀取。

## 3. 更新 Oracle 程式

Windows PowerShell：

```powershell
cd C:\Users\wuser\Desktop\rf-cities-main
scp -i "C:\Users\wuser\Downloads\ssh-key-2026-10-04.key" -r backend package.json city_query_site.html monitor-config.js .env.example opc@161.118.249.117:/home/opc/rf-cities/
ssh -i "C:\Users\wuser\Downloads\ssh-key-2026-10-04.key" opc@161.118.249.117
```

Oracle SSH 終端：

```sh
cd /home/opc/rf-cities
nano .env
chmod 600 .env
npm test
sudo systemctl restart rf-cities
systemctl is-active rf-cities
curl -s http://127.0.0.1:8787/api/status
```

確認 `state: live`、`connected: true`；`publication.enabled: true`、
`publication.lastPublished` 有時間、`publication.error: null`。
`active` 只代表程序在跑，不能代替遊戲連線與資料發布檢查。
發布 401/403 檢查私密金鑰；404 檢查同一專案 SQL 是否已執行。
遊戲登入失效時更新本人有效 RF_USER_ID／RF_USER_TOKEN 再重啟。

## 4. GitHub Pages

將程式、HTML 與公開 monitor-config.js 提交推送至 rf-cities 倉庫。
先检查待提交檔案，不可包含 `.env` 或 SSH 私鑰。
待 Pages 部署後開啟 https://chiaomao666.github.io/rf-cities/city_query_site.html 。

## 更新與限制

遊戲增量立即合併；發布合併等待 250 毫秒，不是 5 秒。
每分鐘完整清單補查，增量不等待補查。每 30 秒發布採集心跳。
超過 90 秒未回報，網站標記過期；即時通知失效時自動補查與退避。
報到截止不是戰鬥結束。缺少比分、戰力不偽造為 0。

免費配額不是無限制服務。頻繁更新、大量訪客會消耗 Supabase 配額。
專案暫停、Oracle 資源回收、登入失效會中斷監測；不自動升級付費。
模擬測試不等於線上驗證，部署後需確認實際清單、即時更新與用量。

官方說明：
https://supabase.com/docs/guides/getting-started/api-keys
https://supabase.com/docs/guides/realtime/postgres-changes
