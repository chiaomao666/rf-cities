# 獨立據點戰監測部署

Oracle 採集主機連接授權遊戲 WebSocket，發布公開交戰清單至 Supabase。
GitHub Pages 從 Supabase 讀取，收到即時通知就更新。
Oracle 8787 只監聽本機，不需要公開後端網址或額外開啟連接埠。

## 1. 建立資料表

在 Supabase 專案 bfecoizruicaaqxhmyqn 的 SQL Editor 執行 `supabase/setup.sql` 全部內容。
它新增 `battle_monitor_state`，不修改舊 cities 表。訪客只有讀取權限。
完整交戰清單原子替換，結束的城市不會殘留；SQL 同時啟用 Realtime。

## 2. 設定金鑰

### 啟用雲端控制權歷史（新增）

在同一專案 SQL Editor 執行 [supabase/history.sql](supabase/history.sql) 全部內容。
它新增 `battle_monitor_history` 與捕捉 trigger，保留现有 `battle_monitor_state` 內容與 Realtime；不需更新權杖、不需重啟 Oracle。
訪客只有 SELECT 權限，不能写入歷史。只存已公開的城市名稱、陣營及聯盟，不存私密封包、權杖或歷史比分。
每分鐘至多一個快照，同分鐘保留最後控制權，沒有中間資料就不插值。下一次控制權更新時清理超過 7 天或 2000 個的紀錄；免费額度仍需監看。
執行前的資料無法追回。執行後到網站「歷史縮時與戰報 → 紀錄來源：雲端歷史」確認是否有今日快照。
如果目前採集已斷線，安裝當下不把過期快照當成新資料；等待主機恢復並發布。

本機／Oracle 同站 `/api/history` 需要部署新版 `backend`；GitHub Pages 直接讀雲端表，不需要這一步。

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

### 自動重新登入

在 Oracle `/home/opc/rf-cities/.env` 設定同一採集帳號的 `RF_LOGIN_EMAIL`、`RF_LOGIN_PASSWORD`，並保留正確的 `RF_USER_ID`。可選 `RF_APP_VERSION=2.28`。帳密不可貼進聊天、放到前端、提交 Git 或寫進日誌。確保 `.env` 權限為 600，更新後重啟 `rf-cities`。

未設定帳密時沿用手動 token 模式。設定完成後，缺少 token、WebSocket 握手失敗或本人玩家頻道訂閱拒絕時會重新登入，僅接受回傳玩家 ID 與 RF_USER_ID 相同的 token。新 token 僅留在程序記憶體，不覆寫 .env；程序重啟後若舊 token 失效會再次登入。公開 `/api/status` 的 `login.enabled` 顯示是否啟用，`login.lastSuccess` 顯示最近一次自動登入成功時間，不含帳密或 token。

登入成功及失敗均至少冷卻十五分鐘，429 尊重更長的 Retry-After；DNS、TLS 等明確網路錯誤只重連，不登入。登入 HTTP 請求十二秒逾時。未成功時每分鐘檢查重試機會，但冷卻期間不發送登入請求。此功能不能繞過官方封鎖、驗證挑戰或帳號權限限制。

## 4. GitHub Pages

將程式、HTML 與公開 monitor-config.js 提交推送至 rf-cities 倉庫。
先检查待提交檔案，不可包含 `.env` 或 SSH 私鑰。
待 Pages 部署後開啟 https://chiaomao666.github.io/rf-cities/city_query_site.html 。

## 更新與限制

### 聯盟授權的雙方戰力與報到人數

在採集主機設定 `RF_UNION_ID=採集帳號實際加入的聯盟ID` 後重啟服務。留空維持原本的城市採集；不要使用截圖中其他帳號的聯盟 ID。
只訂閱這個明確設定的聯盟頻道，查詢 `nation_battle` 的 `{city_id}`，不送出 `join_nation_battle`、派遣、進場或其他修改遊戲的指令。
每五秒至多查詢一個有據點戰標記的城市，每座城市至少間隔六十秒；場次很多時輪詢時間會更長。只公開 `offender/defender` 的戰力、報到人數、陣營旗幟與查詢時間，不公開完整回覆或帳號資料。
`roll_count` 顯示為「報到人數」，不能當成房間內人數。查詢時間與城市快照時間分開顯示；換場／明確結束時清除數值，不沿用上一場戰況。
若伺服器拒絕聯盟訂閱或戰況查詢，本次程序停止這項採集，不嘗試其他聯盟或繞過權限；原有城市採集繼續。`/api/status` 的 `battleDetails.state` 可查看 disabled、ready、live、denied、timeout 或 unavailable。
此功能的本機測試不代表所有城市皆可線上查詢；實際可見範圍由遊戲伺服器決定。聯盟變更後應更新主機設定並重啟。雲端控制權歷史仍不儲存戰力／報到人數。

遊戲增量立即合併，發布合併等待兩秒。
每分鐘完整清單補查，增量不等待補查。
超過 90 秒未回報，網站標記過期；即時通知失效時自動補查與退避。

### 減少 Supabase 流量

發布合併改為兩秒，正常發布間隔至少兩秒；城市清單沒變且連線狀態沒變時不重複發布，最多每分鐘 PATCH 一次狀態心跳，不重送城市 JSON。城市真正更新時發布完整清單，並在 status.citiesVersion 附上版本。資料庫結構不變，無需 SQL migration。Supabase Realtime 仍可能附完整資料列，網站直接使用該資料，不再另外下載；HTTP 回覆若比即時事件舊，不覆蓋新資料。

備援查詢先只讀取 status、updated_at；版本相同時不下載城市，版本不同才下載完整清單。正常即時通知下每六十秒補查，通知失效改為每三十秒，失敗退避最多一百二十秒；背景分頁停止補查及即時訂閱，回到前景時重連並補查。舊後端沒有城市版本時仍可使用完整查詢，建議網站及 Oracle 一起更新。既有九十秒過期檢查保留。已累積的 Egress 不會下降，這些調整只減少後續流量。
報到截止不是戰鬥結束。缺少比分、戰力不偽造為 0。

免費配額不是無限制服務。頻繁更新、大量訪客會消耗 Supabase 配額。
專案暫停、Oracle 資源回收、登入失效會中斷監測；不自動升級付費。
模擬測試不等於線上驗證，部署後需確認實際清單、即時更新與用量。

官方說明：
https://supabase.com/docs/guides/getting-started/api-keys
https://supabase.com/docs/guides/realtime/postgres-changes
