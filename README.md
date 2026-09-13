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

## 每週標準流程

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

每月第一個發布週（發布日期落在每月 1–7 日）時，`weekly:run` 會在週報完成後自動再產生一篇 Knowledge Index 月度深度專題。月度專題預設同樣使用已登入的 Codex CLI，會從最近 45 天的期刊與學會訊號、已取得的完整正文、`inClass/` 與既有週報中選出一個新主題。選題至少需要兩篇主題一致的完整研究，並必須說明相較舊內容的新進展。

若要在其他日期單獨重建當月專題，可執行：

```powershell
npm.cmd run monthly:run -- --month 2026-09
```

月度專題會直接更新 `content/issues.json`；同一月份重跑會替換同一篇，不會產生重複內容。若某週只想產生週報，可加上 `--skip-monthly`。月度公開頁會標示「Codex CLI 自動整理・尚未人工審閱」，並包含運動時事脈絡、學習目標、概念與機轉、逐篇研究方法和量化結果、inClass／歷史內容進展比較、評估表、分期方案、負荷進退階、停止／轉介條件及結果追蹤。

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
10. 執行全站內容驗證；接著即可 commit 與 push。

自動加入網站的報告會顯示「Codex CLI 自動整理・尚未人工審閱」。它不會冒充人工核准；日後人工核對並執行 `weekly:release`，同一期會更新為「人工審閱完成」。每週新報告是累加到歷史清單，不會清除以前的內容；同一週重跑則更新同一個週次，不會產生重複項目。

預設是「每篇都要有完整全文」模式。若本週沒有任何完整全文，流程會在產生報告前停止，但已蒐集的雷達仍會保留。只有你明確接受摘要層級整理時，才使用：

```powershell
npm.cmd run weekly:run -- --allow-abstracts --draft-only
```

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

- `index.html`, `styles.css`, `app.js`, `radar.js`, `weekly-reports.js`
- `assets/yabilab-logo.png`
- `content/issues.json`
- `content/research-radar.json`
- `content/source-registry.json`
- `content/weekly-reports.json`

`inClass/`、`research-library/`、`content/inbox/` 與任何 PDF 不會進入 GitHub Pages artifact。
