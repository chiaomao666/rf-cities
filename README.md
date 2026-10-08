# rf-cities

獨立的逆統戰據點戰地圖，顯示城市控制權、聯盟與即時戰況。

Oracle 常駐採集 → Supabase 公開快照與即時通知 → GitHub Pages。
不需要遊戲模組，也不需要自己的電腦或遊戲画面保持開啟。
遊戲權杖、Supabase 寫入金鑰只保存在採集主機，不可提交到 GitHub。

部署見 [BACKEND.md](BACKEND.md)，SQL 見 [supabase/setup.sql](supabase/setup.sql)。
本機：設定 `.env` 後 `npm start`，開啟 http://127.0.0.1:8787 。
測試：`npm test`，不登入遊戲、不向線上資料庫發送測試戰況。

## 地圖與路線規劃

- 背景使用遊戲提供的 `portal-map.png`，依原本 11036 × 7505 的城市座標比例對齊。
- 已撤換直線連城市與任意彎曲的呈現方式。`reference-route-geometry.json` 保存使用者 `2025-1011.png` 的白色鐵路、橘色土路線條幾何；右下角聯盟遷移／機場以原圖紅、黃、青、紫色曲線獨立呈現，預設關閉。可於「選單 → 設定」分別開關。
- `reviewed-routes-source.json` 保留原圖名稱與人工記錄，`reference-city-ids.json` 固定名稱對應的城市 ID。長沙 #286（野百合教會）、廈門 #277（海砂開採大平臺）、東京 #64（AE-maid Café）等改名不會斷開路線；畫線與即時城市名稱分離。不改寫遊戲的城市名稱。
- 以 `reference-route-anchors.json` 中 269 個城市 ID／原圖位置對照點，分區變形對齊目前黑白底圖。不是把整張示意圖直接縮放，也不再由端點拉直線。沿原始筆畫取多頂點路徑，排除低亮度灰色邊界、圖例、城市圓圈和大部分文字。短線遭圖示遮住、文字殘影、密集香港區及機場交叉仍需人工逐區補查，故 `complete:false`，不宣稱所有線段零漏線／零誤差。城市移動座標時須重新編譯；改名不影響對照 ID。
- `python extract-reference-geometry.py <2025-1011.png 的路徑>` 只在開發時執行，需 Pillow、NumPy、SciPy；原圖只讀，輸出向量資料。`route-geometry-inspection.json` 是核對用，不需發布。網站及 Oracle 不執行圖片描取，沒有增加採集記憶體負擔。原始 PNG 不隨網站發布。
- 「選單 → 路線規劃」依序點城市或空白地圖新增途經點；黃色線直接連接規劃點，不會自動尋找最短路徑或驗證遊戲可達性。
- 規劃時仍可拖曳、縮放；暫停畫線後可查看城市。支援復原、清除，清除也能復原。
- 路線只保存到目前瀏覽器的 localStorage，不上傳、不跨裝置同步，也不影響採集更新。清除瀏覽器網站資料會移除保存路線。
- `python build-reviewed-routes.py` 依固定 ID 編譯人工記錄，不使用像素門檻、距離或最近城市補線；尚未對應的端點列入 unresolved，不強行對應。只在開發時執行，網站及 Oracle 不執行此工具。
- 舊 `infer-map-routes.py`、`trace-reference-routes.py` 是已棄用的推估方法，不應再用來覆寫目前的人工記錄。參考截圖不隨網站發布。

免費方案有配額與平台限制，不保證不限量或永不中斷；請勿升級付費帳戶。
