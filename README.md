# rf-cities

獨立的逆統戰據點戰監測站，只顯示正在交戰的城市。

Oracle 常駐採集 → Supabase 公開快照與即時通知 → GitHub Pages。
不需要遊戲模組，也不需要自己的電腦或遊戲画面保持開啟。
遊戲權杖、Supabase 寫入金鑰只保存在採集主機，不可提交到 GitHub。

部署見 [BACKEND.md](BACKEND.md)，SQL 見 [supabase/setup.sql](supabase/setup.sql)。
本機：設定 `.env` 後 `npm start`，開啟 http://127.0.0.1:8787 。
測試：`npm test`，不登入遊戲、不向線上資料庫發送測試戰況。

免費方案有配額與平台限制，不保證不限量或永不中斷；請勿升級付費帳戶。
