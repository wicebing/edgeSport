const WEEKLY_REPORTS_URL = "content/weekly-reports.json";
const REPORT_LEVEL_LABELS = {
  "full-text-web": "學術網路完整網頁全文",
  "full-text-local": "本機完整本文",
  "full-text-open": "開放取用完整本文",
  "full-text-excerpt": "本文摘錄層級",
  "abstract-only": "摘要層級"
};

const state = {
  reports: [],
  selectedReportId: new URLSearchParams(window.location.search).get("report")
};

const elements = {
  list: document.querySelector("#weekly-report-list"),
  detail: document.querySelector("#weekly-report-detail")
};

initializeWeeklyReports().catch((error) => {
  console.error(error);
  elements.list.innerHTML = `
    <div class="weekly-report-empty">
      <p>整合週報暫時無法載入。</p>
    </div>`;
});

async function initializeWeeklyReports() {
  const response = await fetch(WEEKLY_REPORTS_URL);
  if (!response.ok) {
    throw new Error(`Weekly reports request failed with ${response.status}.`);
  }

  const payload = await response.json();
  state.reports = (payload.reports ?? [])
    .filter((report) => report.status === "published")
    .sort((left, right) => right.publishDate.localeCompare(left.publishDate));
  state.selectedReportId = resolveSelectedReportId();
  bindEvents();
  renderWeeklyReports();
}

function bindEvents() {
  elements.list.addEventListener("click", (event) => {
    const reportLink = event.target.closest("[data-open-report]");
    if (!reportLink) {
      return;
    }

    event.preventDefault();
    selectReport(reportLink.dataset.openReport);
  });

  elements.detail.addEventListener("click", (event) => {
    const shareButton = event.target.closest("[data-share-report]");
    if (shareButton) {
      shareReport(shareButton.dataset.shareReport);
    }
  });
}

function renderWeeklyReports() {
  if (state.reports.length === 0) {
    elements.list.innerHTML = `
      <div class="weekly-report-empty">
        <h3>尚未產生第一期自動週報</h3>
        <p>新題錄已列在下方研究雷達；在學術網路執行 weekly:run 後，Codex 會完成全文閱讀、inClass／舊週報比對並把通過驗證的內容加入這裡。</p>
      </div>`;
    elements.detail.innerHTML = "";
    return;
  }

  const selectedReport = getSelectedReport();
  elements.list.innerHTML = state.reports.map((report) => renderReportCard(report, report.id === selectedReport.id)).join("");
  elements.detail.innerHTML = renderReportDetail(selectedReport);
  refreshIcons();
}

function renderReportCard(report, isSelected) {
  const automationLabel = report.publicationMode === "automated" ? ` / ${providerLabel(report)} 自動整理` : " / 人工審閱";
  return `
    <a class="weekly-report-card ${isSelected ? "is-selected" : ""}" href="?report=${escapeAttribute(report.id)}#weekly-reports" data-open-report="${escapeAttribute(report.id)}" aria-current="${isSelected ? "true" : "false"}">
      <span class="weekly-report-card-date">${escapeHtml(report.weekLabel)} / ${escapeHtml(formatDate(report.publishDate))}</span>
      <strong>${escapeHtml(report.title)}</strong>
      <span>${escapeHtml(report.researchSources.length)} 篇新研究 / ${escapeHtml(String(report.courseSources.length))} 份課程對照${escapeHtml(automationLabel)}</span>
    </a>`;
}

function renderReportDetail(report) {
  const researchSourcesById = new Map(report.researchSources.map((source) => [source.recordId, source]));
  const courseSourcesById = new Map(report.courseSources.map((source) => [source.id, source]));
  const priorSourcesById = new Map(report.priorWeeklySources.map((source) => [source.id, source]));

  return `
    <header class="weekly-report-header">
      <div>
        <p class="eyebrow eyebrow-dark">${escapeHtml(report.weekLabel)} / ${escapeHtml(formatDate(report.publishDate))}</p>
        <h2>${escapeHtml(report.title)}</h2>
        <p class="weekly-report-summary">${escapeHtml(report.summary)}</p>
      </div>
      <button class="icon-button icon-button-outline weekly-report-share" type="button" data-share-report="${escapeAttribute(report.id)}" title="分享本週整合報告" aria-label="分享本週整合報告">
        <i data-lucide="share-2"></i>
      </button>
    </header>

    <div class="weekly-report-facts">
      <span class="fact">${escapeHtml(String(report.researchSources.length))} 篇新研究</span>
      <span class="fact">${escapeHtml(String(report.courseSources.length))} 份 inClass 對照</span>
      <span class="fact">${escapeHtml(String(report.priorWeeklySources.length))} 份既有週報</span>
      ${report.publicationMode === "automated"
        ? `<span class="fact is-automated">${escapeHtml(providerLabel(report))} 自動整理・尚未人工審閱</span>`
        : `<span class="fact is-reviewed">人工審閱完成</span>`}
    </div>

    <section class="weekly-report-section" aria-labelledby="weekly-question-title">
      <h3 id="weekly-question-title">本週問題</h3>
      <p class="weekly-report-question">${escapeHtml(report.question)}</p>
      <p class="weekly-evidence-statement">${escapeHtml(report.evidenceStatement)}</p>
    </section>

    <section class="weekly-report-section" aria-labelledby="weekly-digest-title">
      <h3 id="weekly-digest-title">新研究逐篇整理</h3>
      <div class="weekly-digest-list">
        ${report.articleDigests.map((digest) => renderArticleDigest(digest, researchSourcesById, courseSourcesById, priorSourcesById)).join("")}
      </div>
    </section>

    <section class="weekly-report-section" aria-labelledby="weekly-comparison-title">
      <h3 id="weekly-comparison-title">知識比較與進展</h3>
      ${renderComparisonTable(report.comparisonTable)}
    </section>

    <section class="weekly-report-section" aria-labelledby="weekly-trend-title">
      <div class="weekly-trend-panel">
        <h3 id="weekly-trend-title">${escapeHtml(report.trend.title)}</h3>
        <p>${escapeHtml(report.trend.body)}</p>
      </div>
    </section>

    <section class="weekly-report-section weekly-report-sources" aria-labelledby="weekly-source-title">
      <h3 id="weekly-source-title">原始研究與知識脈絡</h3>
      <div class="weekly-source-columns">
        <div>
          <p class="source-column-label">NEW RESEARCH</p>
          <ul class="weekly-source-list">
            ${report.researchSources.map((source) => renderResearchSource(source)).join("")}
          </ul>
        </div>
        <div>
          <p class="source-column-label">INCLASS / EARLIER WEEKLY</p>
          <ul class="weekly-source-list">
            ${report.courseSources.map((source) => `<li><strong>inClass</strong><span>${escapeHtml(source.title)}</span></li>`).join("")}
            ${report.priorWeeklySources.map((source) => `<li><strong>週報</strong><a href="${escapeAttribute(priorWeeklyHref(source))}">${escapeHtml(source.title)}</a></li>`).join("")}
          </ul>
        </div>
      </div>
    </section>`;
}

function renderArticleDigest(digest, researchSourcesById, courseSourcesById, priorSourcesById) {
  const source = researchSourcesById.get(digest.recordId);
  const level = REPORT_LEVEL_LABELS[digest.contentLevel] ?? digest.contentLevel;
  return `
    <article class="weekly-digest">
      <header class="weekly-digest-header">
        <div>
          <p class="weekly-digest-meta">${escapeHtml(source?.journal ?? "Research source")} / ${escapeHtml(level)}</p>
          <h4>${escapeHtml(source?.title ?? digest.recordId)}</h4>
        </div>
        <a class="source-link" href="${safeUrl(source?.sourceUrl)}" target="_blank" rel="noreferrer" title="開啟原始研究" aria-label="開啟原始研究：${escapeAttribute(source?.title ?? digest.recordId)}">
          <i data-lucide="external-link"></i>
        </a>
      </header>
      <p class="weekly-digest-headline">${escapeHtml(digest.headline)}</p>
      <p class="weekly-digest-summary">${escapeHtml(digest.summary)}</p>
      <ul class="weekly-key-findings">${digest.keyFindings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul>
      ${renderEvidenceVisuals(digest)}
      <div class="weekly-progress">
        <span>本週進展</span>
        <p>${escapeHtml(digest.whatIsNew)}</p>
      </div>
      <div class="knowledge-comparisons">
        ${renderKnowledgeComparison("inClass 對照", digest.inClassComparison, courseSourcesById, false)}
        ${renderKnowledgeComparison("既有週報對照", digest.priorWeeklyComparison, priorSourcesById, true)}
      </div>
      <div class="weekly-digest-bottom">
        <div>
          <span class="weekly-mini-label">場域意涵</span>
          <ul>${digest.practicalImplications.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        <div>
          <span class="weekly-mini-label">解讀限制</span>
          <ul>${digest.cautions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
      </div>
    </article>`;
}

function providerLabel(report) {
  if (report.automationProvider === "codex") return "Codex CLI";
  if (report.automationProvider === "copilot") return "Copilot CLI";
  return "LLM";
}

function renderEvidenceVisuals(digest) {
  const table = digest.evidenceTable;
  const visualization = digest.visualization;
  if (!table && !visualization) {
    return "";
  }

  return `
    <div class="weekly-evidence-visuals ${visualization ? "" : "is-table-only"}">
      ${table ? renderEvidenceTable(table) : ""}
      ${visualization ? renderDigestVisualization(visualization) : ""}
    </div>`;
}

function renderEvidenceTable(table) {
  return `
    <div class="weekly-study-table-wrap">
      <div class="weekly-study-table-scroll">
        <table class="weekly-study-table">
          <caption>${escapeHtml(table.title)}</caption>
          <thead><tr>${table.headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
      <p class="weekly-visual-source">原創整理：${escapeHtml(table.sourceNote)}</p>
    </div>`;
}

function renderDigestVisualization(visualization) {
  const maximum = Math.max(...visualization.data.map((datum) => datum.value), 1);
  return `
    <figure class="weekly-study-chart">
      <h5>${escapeHtml(visualization.title)}</h5>
      <figcaption>${escapeHtml(visualization.caption)}</figcaption>
      ${visualization.data.map((datum) => `
        <div class="weekly-chart-row">
          <span class="weekly-chart-label">${escapeHtml(datum.label)}</span>
          <span class="weekly-chart-track" aria-hidden="true"><span class="weekly-chart-fill" style="--bar-width: ${Math.max(4, (datum.value / maximum) * 100)}%"></span></span>
          <strong class="weekly-chart-value">${escapeHtml(String(datum.value))} ${escapeHtml(visualization.unit)}</strong>
          <p class="weekly-chart-detail">${escapeHtml(datum.detail)}</p>
        </div>`).join("")}
      <p class="weekly-visual-source">原創重繪：${escapeHtml(visualization.sourceNote)}</p>
    </figure>`;
}

function renderKnowledgeComparison(label, comparison, sourceMap, hasLinks) {
  const sourceMarkup = comparison.sourceIds.length > 0
    ? comparison.sourceIds.map((sourceId) => {
        const source = sourceMap.get(sourceId);
        if (!source) {
          return "";
        }
        const name = escapeHtml(source.title);
        return hasLinks
          ? `<a class="knowledge-source" href="${escapeAttribute(priorWeeklyHref(source))}">${name}</a>`
          : `<span class="knowledge-source">${name}</span>`;
      }).join("")
    : "<span class=\"knowledge-source is-no-match\">未找到直接相符資料</span>";
  return `
    <div class="knowledge-comparison">
      <span class="knowledge-label">${escapeHtml(label)}</span>
      <div class="knowledge-source-list">${sourceMarkup}</div>
      <p>${escapeHtml(comparison.summary)}</p>
    </div>`;
}

function renderComparisonTable(table) {
  return `
    <div class="weekly-comparison-wrap">
      <table class="weekly-comparison-table">
        <caption>${escapeHtml(table.title)}</caption>
        <thead><tr>${table.headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function renderResearchSource(source) {
  const level = REPORT_LEVEL_LABELS[source.contentLevel] ?? source.contentLevel;
  return `
    <li>
      <span>${escapeHtml(source.journal)} / ${escapeHtml(level)}</span>
      <a href="${safeUrl(source.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>
    </li>`;
}

function selectReport(reportId) {
  if (!state.reports.some((report) => report.id === reportId)) {
    return;
  }

  state.selectedReportId = reportId;
  const url = new URL(window.location.href);
  url.searchParams.set("report", reportId);
  url.hash = "weekly-reports";
  window.history.replaceState({}, "", url);
  renderWeeklyReports();
  document.querySelector("#weekly-reports").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function shareReport(reportId) {
  const report = state.reports.find((candidate) => candidate.id === reportId);
  if (!report) {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("report", reportId);
  url.hash = "weekly-reports";
  const shareData = { title: `${report.title} | EDGE SPORT`, text: report.summary, url: url.href };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard.writeText(url.href);
  } catch (error) {
    console.error("Unable to share weekly report", error);
  }
}

function resolveSelectedReportId() {
  if (state.reports.some((report) => report.id === state.selectedReportId)) {
    return state.selectedReportId;
  }
  return state.reports[0]?.id ?? null;
}

function getSelectedReport() {
  return state.reports.find((report) => report.id === state.selectedReportId) ?? state.reports[0];
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("zh-Hant-TW", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function safeUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "https:" ? parsedUrl.href : "#";
  } catch {
    return "#";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
}

function priorWeeklyHref(source) {
  return source?.kind === "integrated-report"
    ? `?report=${encodeURIComponent(source.id)}#weekly-reports`
    : `?issue=${encodeURIComponent(source.id)}#reading`;
}
