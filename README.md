# EDGE SPORT / YABILAB Evidence Weekly

EDGE SPORT 是可直接部署到 GitHub Pages 的繁體中文運動醫學與運動科學知識站。它每週追蹤核心期刊與國際學會，把新研究放回 `inClass/` 課程知識和過往週報中比較，公開呈現可回查來源、證據層級、研究方法、關鍵數據、原創整理表與資料圖，以及可執行但保留安全邊界的實務方案。

網站與私有研究資料刻意分開：GitHub Pages 只會收到網站檔案和公開 JSON；合法讀取的 HTML 快照、PDF、全文擷取、審閱紀錄、LLM prompt 與草稿全部留在本機，且已被 `.gitignore` 排除。

## 第一次設定

Windows PowerShell 若限制 `npm.ps1`，請使用 `npm.cmd`：

```powershell
npm.cmd ci
npm.cmd run validate
npm.cmd run serve
```

開啟 `http://localhost:4173` 預覽。不要直接雙擊 `index.html`，因為瀏覽器需要透過 HTTP 載入 `content/*.json`。

每週文章生成預設固定使用已登入的 Codex CLI，不需要把 API 金鑰存進專案：

```powershell
codex login
```

預設是 `--provider codex`；若 Codex CLI 尚未登入或不可用，流程會直接停止，不會默默換成其他模型。只有明確加入 `--provider copilot` 時才改用 Copilot。未指定 `--model` 時沿用 Codex CLI 的預設模型，避免把會過期的模型名稱寫死。

Windows 上不需要另外填入 Codex 路徑。專案會依序檢查 `EDGE_SPORT_CODEX_PATH`、`PATH`、全域 npm 安裝，以及 VS Code、VS Code Insiders、Cursor 的 OpenAI 擴充套件；因此從一般 `cmd.exe` 或 PowerShell 執行也能使用既有的 ChatGPT 登入狀態。

## 每週標準流程

連好學術網路後，每週只需要依序執行這三個無參數指令。週報 ID 由日期自動產生；Podcast 與 YouTube 上傳包會自動接續最新一期 YABILAB 內容：

```powershell
# Step 1：建立網站週報
npm.cmd run weekly:run

# Step 2：建立 Podcast
npm.cmd run podcast:run

# Step 3：建立 YouTube 上傳包
npm.cmd run podcast:youtube
```

### 1. 連上學術網路

先連接學校／機構提供的校園網路或 VPN，然後直接執行下一節的 `weekly:run`。正常情況下不需要先手動下載 PDF。

系統會先嘗試 Europe PMC 與 NCBI PMC Open Access BioC，再透過 PubMed 全文入口、DOI 與出版社網頁讀取 HTML 全文。只有頁面包含足夠的文章長度與完整章節結構（例如方法、結果、討論），才會標記為 `full-text-web`；網頁中的表格列、圖說與主要段落會轉成可供 LLM 閱讀的私人結構化文字。預設不下載 PDF。

原始 HTML 快照、擷取文字與稽核紀錄保存在 `research-library/web-full-text/` 和 `research-library/extracted/`，全部被 Git 排除。流程只使用目前網路環境已合法授權的內容，不會繞過登入、CAPTCHA、DRM 或其他存取控制。

如果你的圖書館使用網址型 proxy，可在執行前設定 resolver；`{url}` 會被替換成編碼後的文章網址：

```powershell
$env:EDGE_SPORT_LIBRARY_RESOLVER = "https://YOUR-LIBRARY-PROXY/login?url={url}"
```

若特定出版社要求瀏覽器 SSO、互動驗證、只在 JavaScript 執行後載入正文，或拒絕程式存取，終端機會列出無法自動讀到完整網頁的 PMID。你可以改選其他能讀取全文的文章；若仍希望納入該篇，才需要在瀏覽器合法下載並放進：

```text
research-library/incoming/
```

備援檔名請包含 PMID，例如 `pmid-42706652-wbgt-youth-soccer.pdf`。所有 PDF、全文擷取與存取稽核都只留在本機，不會部署到 GitHub Pages。

### 2. 一次完成蒐集、全文閱讀、週報與網站資料更新

```powershell
npm.cmd run weekly:run
```

每個新週次會新增一筆週報並永久保留在累積式知識庫；同一週內重跑只會更新相同 `YYYY-wNN`，不會製造重複週報。週報標題由 Codex 依當週證據產生具體題名，方便之後用關鍵字辨識與回溯。

每個月第一次成功執行 `weekly:run` 時，系統會先檢查該月份是否已有 Knowledge Index 月度深度專題；若沒有，就在週報完成後自動新增一篇。這讓月報維持「每月第一個發布週」的節奏，同時在當月第一週未執行時，能於下一次成功執行自動補上，不會整月漏刊，也不會重複產生。月度專題預設同樣使用已登入的 Codex CLI，會從最近 45 天的期刊與學會訊號、已取得的完整正文、`inClass/` 與既有週報中選出一個新主題。選題至少需要兩篇主題一致的完整研究，並必須說明相較舊內容的新進展。

若要在其他日期單獨重建當月專題，可執行：

```powershell
npm.cmd run monthly:run -- --month 2026-09
```

月度專題會直接更新 `content/issues.json`；同一月份重跑會替換同一篇，不會產生重複內容。若某週只想產生週報，可加上 `--skip-monthly`。月度公開頁包含運動時事脈絡、學習目標、概念與機轉、逐篇研究方法和量化結果、inClass／歷史內容進展比較、評估表、分期方案、負荷進退階、停止／轉介條件及結果追蹤。

這個指令依序會：

1. 重建 `inClass/` 全文索引。
2. 從 PubMed 與已驗證的官方 RSS 更新最近 7 天題錄。
3. 嘗試透過 Europe PMC 與 NCBI PMC Open Access BioC 取得可程式化存取的開放全文；失敗不代表文章無法由學術網路閱讀。
4. 建立本週候選清單，透過目前的校園網路／VPN 讀取 DOI 與出版社 HTML 正文，並驗證文章章節、表格與圖說結構。
5. 若有人工補入的 PDF 才進行 PDF 匯入；預設週流程不下載 PDF。
6. 優先依全文可用性、研究設計與來源多樣性選文，為每篇尋找 inClass 與過往週報對照。
7. 讓已登入的 Codex CLI 完整閱讀正文，逐篇擷取研究設計、族群、介入／暴露、比較條件、結果與追蹤時間，再產生結構化週報。
8. 由 Codex CLI 統整本週研究地圖、知識背景與操作定義，並建立評估組合、分期執行、訓練量進退階、停止／轉介條件、結果追蹤及 Yes/No 決策流程。
9. 通過來源、篇數、內容層級、表格與資料結構驗證後，自動累加到 `content/weekly-reports.json`。
10. 重建 `content/knowledge-index.json`，讓週報、月度議題、歷史議題、Podcast 與所有研究題錄可由同一個關鍵字索引回查。
11. 執行全站內容與累積筆數驗證，並顯示本週 Podcast 的下一個指令。

系統仍會在資料欄位保留產生方式與審閱狀態，供驗證及日後追溯，但自動產生的狀態不顯示在公開網站。日後人工核對並執行 `weekly:release`，同一期會更新為「人工審閱完成」。每週新報告是累加到歷史清單，不會清除以前的內容；同一週重跑則更新同一個週次，不會產生重複項目。

預設是「每篇都要有完整全文」模式。若本週沒有任何完整全文，流程會在產生報告前停止，但已蒐集的雷達仍會保留。只有你明確接受摘要層級整理時，才使用：

```powershell
npm.cmd run weekly:run -- --allow-abstracts --draft-only
```

## 累積式知識庫與改版原則

例行流程採用累積式保存，不設研究題錄總筆數上限，也不會因為只查最近 7 天就刪除更早的資料：

- `content/weekly-reports.json`：永久保存每一期公開週報；同一週重跑只修訂同一 ID。
- `content/issues.json`：永久保存月度深度議題與歷史知識議題；同一月份重跑只修訂同一 ID。
- `content/research-radar.json`：合併新題錄與所有舊題錄，並在 `collectionHistory` 留下每次蒐集範圍、數量和新增 ID。
- `content/podcasts.json` 與 `assets/podcasts/`：累積每集英文逐字稿、章節、引用來源與可公開播放的 MP3；同一週重跑只更新同一集。
- `content/knowledge-index.json`：由上述公開資料重建，包含全文式關鍵字搜尋文字與研究被哪些週報／議題／Podcast 引用的回溯連結。
- `research-library/`：保留合法取得的全文、HTML、擷取文字、稽核、Codex packet 與草稿，供之後重新分析；因版權與隱私不部署到 GitHub Pages。

網站改版時，以上四份 `content/*.json` 是公開知識的穩定資料層，不應用空白模板覆蓋。可隨時執行下列指令重建搜尋索引並檢查有沒有遺漏既有 ID：

```powershell
npm.cmd run knowledge:index
npm.cmd run validate
```

Git 儲存公開整理與研究 metadata；`research-library/` 被 `.gitignore` 排除，因此換電腦、清理硬碟或重裝系統前，必須另行備份整個 `research-library/`。這項分離可讓網站長期累積知識，同時避免把訂閱全文或私人存取資料公開上傳。

常用選項：

```powershell
# 指定主題與篇數
npm.cmd run weekly:run -- --theme "量測與科技" --max-articles 6 --reviewer "Your Name"

# 指定文章
npm.cmd run weekly:run -- --articles "pmid-42716506,pmid-42715393" --reviewer "Your Name"

# 明確使用 Copilot
npm.cmd run weekly:run -- --provider copilot --reviewer "Your Name"

# 只建立研究包，不呼叫 LLM
npm.cmd run weekly:run -- --prepare-only --reviewer "Your Name"

# 產生私人草稿但不加入網站公開 JSON
npm.cmd run weekly:run -- --draft-only

# 完全略過出版社網頁全文讀取（只用既有本機／開放全文）
npm.cmd run weekly:run -- --skip-web-full-text --reviewer "Your Name"

# 明確要求在網頁全文失敗時，再嘗試自動 PDF 備援
npm.cmd run weekly:run -- --pdf-fallback --reviewer "Your Name"
```

### 3. Commit 並更新 GitHub Pages

`weekly:run` 成功後執行：

```powershell
git add .
git commit -m "Add weekly sports science report"
git push
```

GitHub Actions 會驗證並部署新的 `content/weekly-reports.json`。網站會保留歷史週報，並把最新一期排在最前面。

## edgeSport4Podcast

本週網頁完成後直接執行，不必填寫週次；系統會自動選擇最新一份已發布的 YABILAB 週報：

```powershell
npm.cmd run podcast:run
```

這個專案專用流程會先把兩段本機音軌建立成私人 XTTS v2 聲音 profile，再建立內容包、讓已登入的 Codex CLI 依本週完整週報撰寫 12–18 分鐘英文雙人對話、合成 MP3、發布逐字稿與章節，最後重建搜尋索引並驗證全站。預設角色為：

- `Ying`（female）：以 `../tts/girl voice.m4a` 建立的女聲 evidence guide。
- `Bing`（male）：以 `../tts/man voice.m4a` 建立的男聲 analytical partner。

這是 zero-shot voice cloning，不會用二十多秒音軌進行容易過擬合的完整模型微調。來源 M4A 會先在本機轉成 mono、24 kHz、音量與頻段標準化的 WAV profile，放在被 Git 排除的 `research-library/podcast-voices/`。可先單獨建立／檢查 profile：

```powershell
npm.cmd run podcast:voices
```

兩條聲線會依序載入，降低 8 GB 顯示記憶體同時佔用。第一次執行或重新撰寫整集時可能需要一段時間；快取鍵同時包含講稿與聲音 profile，因此更換來源音軌後一定會重新錄製，不會誤用舊聲線。預設使用可用的 NVIDIA CUDA，必要時可改用 CPU：

```powershell
npm.cmd run podcast:run -- --device cpu
```

若只想先檢查 Codex 講稿，不合成聲音：

```powershell
npm.cmd run podcast:run -- --script-only
```

私人檔案（聲音 profile、Codex packet、講稿草稿、分段 WAV、時間軸及母帶）保存在 `research-library/podcast-*`；兩個原始 M4A 也只從 `../tts/` 本機讀取，全部不會部署。公開檔案包含 `assets/podcasts/YYYY-wNN-<content-hash>.mp3`、整理後的英文逐字稿、章節、show notes 與來源連結；合成語音來源仍保留在結構化資料中供追溯，但網站不另外顯示 disclosure 區塊。內容雜湊檔名可避免重建時被正在播放的舊 MP3 鎖住，也可避免瀏覽器繼續播放快取舊版。因 MP3 會在 GitHub Pages 公開，commit 前請先試聽並確認你有權使用兩段來源聲音且願意發布合成內容。

若本機 Python 不在預設的 `C:\Users\<你>\anaconda3\python.exe`，可指定含有 `../tts/vendor_coqui311` 相容套件的 Python 3.11：

```powershell
$env:EDGE_SPORT_PODCAST_PYTHON = "C:\Path\To\python.exe"
```

### Step 3：建立 YouTube Podcast 上傳影片

`podcast:run` 完成後直接執行；系統會自動選擇最新一集，不必填寫週次：

```powershell
npm.cmd run podcast:youtube
```

這個步驟會讓已登入的 Codex CLI 根據已發布 Podcast 規劃 YouTube 標題、說明欄、章節視覺、縮圖文字、標籤及置頂留言，再建立以聲音為主的 1280×720 低畫面更新率影片。影片逐輪顯示 Ying／Bing、章節與完整英文逐字稿，並同時內嵌英文字幕軌及輸出可另外上傳的 `.srt`。

所有成品都放在被 Git 排除的 `youtube-output/`：

- `edgeSport4Podcast-YYYY-wNN.mp4`：可直接上傳 YouTube 的 H.264／AAC 影片。
- `edgeSport4Podcast-YYYY-wNN.srt`：英文字幕檔。
- `edgeSport4Podcast-YYYY-wNN-thumbnail.png`：以 YABILAB logo 製作的縮圖。
- `edgeSport4Podcast-YYYY-wNN-title.txt`：可直接貼到 YouTube 的影片標題。
- `edgeSport4Podcast-YYYY-wNN-description.txt`：可直接貼到 YouTube 的完整影片說明。
- `edgeSport4Podcast-YYYY-wNN-upload.txt`：Codex 擬定的標題、說明、標籤及置頂留言。

影片採靜態章節卡與 5 fps 編碼，重點保留在聲音與字幕，避免沒有意義的高畫面資料量。每次執行 `podcast:youtube` 會先清空舊的 `youtube-output/`，只保留本次上傳包；上傳 YouTube 後可直接刪除整個資料夾，不影響網站、Podcast MP3、逐字稿或歷史知識庫。

若只想先檢查 Codex 影片規劃：

```powershell
npm.cmd run podcast:youtube -- --plan-only
```

### 4. 選用：人工編輯核對

草稿位於：

```text
research-library/weekly-drafts/YYYY-wNN.json
```

若希望把自動標籤升級成「人工審閱完成」，可逐篇核對：

- 研究設計、族群、介入／暴露、比較組、主要結果與限制。
- 所有數字、單位、分母、時間點與統計方向。
- `contentLevel` 是否正確；摘要層級不得寫成全文結論。
- inClass 與既有週報的比較是否真的相關，沒有直接相符就保留 `no-direct-match`。
- `evidenceTable` 是自己的整理，不是原表逐格翻譯。
- `visualization` 只使用來源中可直接核對的數值；沒有適合數據時必須是 `null`。

### 5. 選用：核准並更新同一期

確認完成後才執行：

```powershell
npm.cmd run weekly:release -- --id 2026-w38 --reviewer "Your Name" --confirm
```

若草稿仍有 `abstract-only` 或 `full-text-excerpt`，發布預設會被阻擋。確定要保留這些證據層級及其限制時，必須再明確加入 `--allow-abstracts`。

發布會更新 `content/weekly-reports.json` 並立即執行完整驗證。網站的「本週整合」會先呈現研究趨勢與可追溯關鍵數字，再顯示每篇研究的方法、量化結果、原創研究速覽表與資料圖，接著提供知識背景、inClass／既有週報進展比較，以及含評估、分期、負荷進退階、停止規則、結果監測與決策流程的實務指南。每個操作建議都標示為「研究來源明載」、「inClass 知識支持」、「跨研究整合」、「EDGE SPORT 操作提案」或「混合依據」，避免把推論偽裝成研究結論。

## 單篇全文審閱與研究雷達

若要把一篇文章做成雷達中的完整研究卡，可單獨執行：

```powershell
npm.cmd run research:prepare-review -- --id pmid-42706652 --pdf "C:\Research\pmid-42706652.pdf" --reviewer "Your Name"
```

系統會把 PDF 複製到本機私有資料夾、擷取文字，並建立 `research-library/reviews/<id>.json`。完整閱讀摘要、前言、方法、結果、討論、限制、表格、圖與補充資料後，填妥審閱 JSON，再發布：

```powershell
npm.cmd run research:publish-review -- --review research-library/reviews/pmid-42706652.json
```

這條流程會強制要求全文確認、研究設計、族群、限制、原創整理表、原創圖表與合法取得方式；不符合就拒絕公開。

## 來源範圍與內容原則

- `content/source-registry.json` 管理 PubMed 期刊、國際學會入口與已驗證 RSS。目前涵蓋 AJSM、BJSM、JOSPT、Sports Medicine、MSSE、IJSPP、JSCR、JISSN、KSSTA、JISAKOS 等臨床、復健、生理、營養、生物力學與科技來源。
- 題錄雷達不等於證據結論。未讀全文的文章只顯示 metadata、主題訊號與原始連結。
- 對付費或機構授權全文，公開頁面只放自己的摘要、比較表與重繪圖，不發布私人 HTML 快照、PDF、原始表格、圖說或圖像。
- 即使文章位於 PMC，也不自動代表所有圖像都可再散布。開放全文只作為本機閱讀輸入；重製原媒體前仍要人工核對文章與個別素材授權。
- 每個實務意涵都要保留研究設計、族群與情境，不把單篇研究改寫成通用醫療建議。

## GitHub Pages

`.github/workflows/deploy-pages.yml` 會在推送到 `main` 時驗證內容，建立只含公開檔案的 Pages artifact，再部署網站。排程也會在每週一更新公開題錄 metadata；排程不會登入你的學術網路、不會執行訂閱 LLM，也不會自動核准文章。

建立 GitHub repository 後：

```powershell
git init
git add .
git commit -m "Create EDGE SPORT evidence weekly"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

接著在 GitHub repository 的 **Settings → Pages → Build and deployment** 將 Source 設為 **GitHub Actions**。之後每次本機完成 `weekly:release`、提交並推送，網站就會自動更新。

## 公開檔案

- `index.html`, `styles.css`, `app.js`, `radar.js`, `weekly-reports.js`, `podcasts.js`
- `assets/yabilab-logo.png`, `assets/podcasts/*.mp3`
- `content/issues.json`
- `content/research-radar.json`
- `content/source-registry.json`
- `content/weekly-reports.json`
- `content/podcasts.json`
- `content/knowledge-index.json`

`inClass/`、`research-library/`、`content/inbox/` 與任何 PDF 不會進入 GitHub Pages artifact。
