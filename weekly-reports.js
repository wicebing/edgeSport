const WEEKLY_REPORTS_URL = "content/weekly-reports.json";
const REPORT_LEVEL_LABELS = {
  "full-text-web": "學術網路完整網頁全文",
  "full-text-local": "本機完整本文",
  "full-text-open": "開放取用完整本文",
  "full-text-excerpt": "本文摘錄層級",
  "abstract-only": "摘要層級"
};

const EVIDENCE_STRENGTH_LABELS = {
  high: "高",
  moderate: "中",
  low: "低",
  mixed: "混合",
  uncertain: "不確定"
};

const EVIDENCE_BASIS_LABELS = {
  "source-stated": "研究來源明載",
  "inclass-supported": "inClass 知識支持",
  "cross-source-synthesis": "跨研究整合",
  "edge-sport-proposal": "EDGE SPORT 操作提案",
  mixed: "混合依據"
};

const STOP_RULE_LABELS = {
  modify: "調整負荷",
  stop: "停止訓練",
  "urgent-referral": "立即轉介"
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
  return `
    <a class="weekly-report-card ${isSelected ? "is-selected" : ""}" href="?report=${escapeAttribute(report.id)}#weekly-reports" data-open-report="${escapeAttribute(report.id)}" aria-current="${isSelected ? "true" : "false"}">
      <span class="weekly-report-card-date">${escapeHtml(report.weekLabel)} / ${escapeHtml(formatDate(report.publishDate))}</span>
      <strong>${escapeHtml(report.title)}</strong>
      <span>${escapeHtml(report.researchSources.length)} 篇新研究 / ${escapeHtml(String(report.courseSources.length))} 份課程對照</span>
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
      ${report.publicationMode === "reviewed" ? `<span class="fact is-reviewed">人工審閱完成</span>` : ""}
    </div>

    <section class="weekly-report-section" aria-labelledby="weekly-question-title">
      <h3 id="weekly-question-title">本週問題</h3>
      <p class="weekly-report-question">${escapeHtml(report.question)}</p>
      <p class="weekly-evidence-statement">${escapeHtml(report.evidenceStatement)}</p>
    </section>

    ${renderResearchLandscape(report.researchLandscape)}
    ${renderKnowledgePrimer(report.knowledgePrimer)}

    <section class="weekly-report-section" aria-labelledby="weekly-digest-title">
      <h3 id="weekly-digest-title">新研究逐篇整理</h3>
      <div class="weekly-digest-list">
        ${report.articleDigests.map((digest) => renderArticleDigest(digest, researchSourcesById, courseSourcesById, priorSourcesById)).join("")}
      </div>
    </section>

    ${renderPracticeGuide(report.practiceGuide)}
    ${renderDecisionPathway(report.decisionPathway)}

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
    <article class="weekly-digest" id="digest-${escapeAttribute(digest.recordId)}">
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
      ${renderStudyProfile(digest.studyProfile)}
      ${renderQuantitativeResults(digest.quantitativeResults)}
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

function renderResearchLandscape(landscape) {
  if (!landscape) return "";
  const themes = Array.isArray(landscape.themes) ? landscape.themes : [];
  const keyNumbers = Array.isArray(landscape.keyNumbers) ? landscape.keyNumbers : [];
  return `
    <section class="weekly-report-section weekly-landscape" aria-labelledby="weekly-landscape-title">
      <div class="weekly-section-heading">
        <p class="weekly-section-kicker">WEEKLY RESEARCH MAP</p>
        <h3 id="weekly-landscape-title">${escapeHtml(landscape.title)}</h3>
        <p>${escapeHtml(landscape.overview)}</p>
      </div>
      <div class="weekly-landscape-grid">
        ${themes.map((theme) => `
          <article class="weekly-theme-card">
            <div class="weekly-card-heading">
              <h4>${escapeHtml(theme.name)}</h4>
              <span class="weekly-strength is-${escapeAttribute(theme.evidenceStrength)}">證據強度：${escapeHtml(EVIDENCE_STRENGTH_LABELS[theme.evidenceStrength] ?? theme.evidenceStrength)}</span>
            </div>
            <p>${escapeHtml(theme.signal)}</p>
            <div class="weekly-record-links">${(theme.articleIds ?? []).map((recordId) => `<a href="#digest-${escapeAttribute(recordId)}">${escapeHtml(recordId)}</a>`).join("")}</div>
          </article>`).join("")}
      </div>
      <div class="weekly-number-grid">
        ${keyNumbers.map((number) => `
          <a class="weekly-number-card" href="#digest-${escapeAttribute(number.sourceRecordId)}">
            <strong>${escapeHtml(number.value)}</strong>
            <span>${escapeHtml(number.label)}</span>
            <small>${escapeHtml(number.context)}</small>
          </a>`).join("")}
      </div>
    </section>`;
}

function renderKnowledgePrimer(primer) {
  if (!primer) return "";
  const definitions = Array.isArray(primer.definitions) ? primer.definitions : [];
  const mechanisms = Array.isArray(primer.mechanisms) ? primer.mechanisms : [];
  return `
    <section class="weekly-report-section weekly-primer" aria-labelledby="weekly-primer-title">
      <div class="weekly-section-heading">
        <p class="weekly-section-kicker">KNOWLEDGE PRIMER</p>
        <h3 id="weekly-primer-title">${escapeHtml(primer.title)}</h3>
        <p>${escapeHtml(primer.overview)}</p>
      </div>
      <div class="weekly-primer-grid">
        ${definitions.map((definition) => `
          <article class="weekly-definition-card">
            <div class="weekly-card-heading">
              <h4>${escapeHtml(definition.term)}</h4>
              ${renderBasisBadge(definition.basis)}
            </div>
            <p>${escapeHtml(definition.definition)}</p>
            <div class="weekly-operational"><span>如何操作</span><p>${escapeHtml(definition.operationalMeaning)}</p></div>
          </article>`).join("")}
      </div>
      <div class="weekly-mechanism-list">
        ${mechanisms.map((mechanism) => `
          <article class="weekly-mechanism-card">
            <h4>${escapeHtml(mechanism.title)}</h4>
            <p>${escapeHtml(mechanism.explanation)}</p>
            <div class="weekly-operational"><span>實務意義</span><p>${escapeHtml(mechanism.practicalMeaning)}</p></div>
            <div class="weekly-record-links">${(mechanism.sourceRecordIds ?? []).map((recordId) => `<a href="#digest-${escapeAttribute(recordId)}">${escapeHtml(recordId)}</a>`).join("")}</div>
          </article>`).join("")}
      </div>
    </section>`;
}

function renderStudyProfile(profile) {
  if (!profile) return "";
  const fields = [
    ["研究設計", profile.design],
    ["研究族群", profile.population],
    ["介入／暴露", profile.interventionOrExposure],
    ["比較條件", profile.comparator],
    ["主要結果", profile.outcomes],
    ["追蹤時間", profile.followUp]
  ];
  return `
    <div class="weekly-study-profile" aria-label="研究方法速覽">
      ${fields.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join("")}
    </div>`;
}

function renderQuantitativeResults(results) {
  if (!Array.isArray(results) || results.length === 0) return "";
  return `
    <div class="weekly-quant-wrap">
      <table class="weekly-quant-table">
        <caption>可追溯的關鍵數據</caption>
        <thead><tr><th scope="col">指標</th><th scope="col">結果</th><th scope="col">解讀情境</th><th scope="col">原文位置</th></tr></thead>
        <tbody>${results.map((result) => `<tr><td>${escapeHtml(result.measure)}</td><td><strong>${escapeHtml(result.result)}</strong></td><td>${escapeHtml(result.context)}</td><td>${escapeHtml(result.sourceLocation)}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function renderPracticeGuide(guide) {
  if (!guide) return "";
  const phases = Array.isArray(guide.phases) ? guide.phases : [];
  const stopRules = Array.isArray(guide.stopRules) ? guide.stopRules : [];
  const outcomes = Array.isArray(guide.outcomeTracking) ? guide.outcomeTracking : [];
  return `
    <section class="weekly-report-section weekly-practice-guide" aria-labelledby="weekly-practice-title">
      <div class="weekly-section-heading">
        <p class="weekly-section-kicker">FROM EVIDENCE TO ACTION</p>
        <h3 id="weekly-practice-title">${escapeHtml(guide.title)}</h3>
        <p>${escapeHtml(guide.scope)}</p>
      </div>
      <div class="weekly-guide-brief">
        <div><span>適用對象</span><p>${escapeHtml(guide.targetPopulation)}</p></div>
        <div><span>方案目標</span><p>${escapeHtml(guide.goal)}</p></div>
      </div>
      <div class="weekly-guide-block">
        <h4>要量測什麼</h4>
        ${guide.assessmentBattery ? renderEvidenceTable(guide.assessmentBattery) : ""}
      </div>
      <div class="weekly-guide-block">
        <h4>分期執行與進退階</h4>
        <div class="weekly-phase-timeline">
          ${phases.map((phase, index) => renderPracticePhase(phase, index)).join("")}
        </div>
      </div>
      ${renderLoadManagement(guide.loadManagement)}
      <div class="weekly-guide-block">
        <h4>什麼狀況要調整或停止</h4>
        <div class="weekly-stop-grid">
          ${stopRules.map((rule) => `
            <article class="weekly-stop-card is-${escapeAttribute(rule.urgency)}">
              <div class="weekly-card-heading">
                <span class="weekly-stop-label">${escapeHtml(STOP_RULE_LABELS[rule.urgency] ?? rule.urgency)}</span>
                ${renderBasisBadge(rule.evidenceBasis)}
              </div>
              <h5>${escapeHtml(rule.trigger)}</h5>
              <p><strong>當下處置：</strong>${escapeHtml(rule.action)}</p>
              <p><strong>恢復條件：</strong>${escapeHtml(rule.restartCriteria)}</p>
            </article>`).join("")}
        </div>
      </div>
      <div class="weekly-guide-block">
        <h4>持續追蹤的結果</h4>
        <div class="weekly-outcome-wrap">
          <table class="weekly-outcome-table">
            <thead><tr><th scope="col">領域</th><th scope="col">量測</th><th scope="col">頻率</th><th scope="col">目標／解讀</th></tr></thead>
            <tbody>${outcomes.map((outcome) => `<tr><td>${escapeHtml(outcome.domain)}</td><td>${escapeHtml(outcome.measure)}</td><td>${escapeHtml(outcome.frequency)}</td><td>${escapeHtml(outcome.targetOrInterpretation)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="weekly-risk-grid">
        ${renderGuideNotes("風險與安全邊界", guide.riskDiscussion, "shield-alert")}
        ${renderGuideNotes("尚未確定的部分", guide.uncertainties, "circle-help")}
      </div>
    </section>`;
}

function renderPracticePhase(phase, index) {
  return `
    <article class="weekly-phase-card">
      <div class="weekly-phase-index">${index + 1}</div>
      <div class="weekly-phase-heading">
        <div><h5>${escapeHtml(phase.phase)}</h5><p>${escapeHtml(phase.typicalTiming)}</p></div>
        ${renderBasisBadge(phase.evidenceBasis)}
      </div>
      <div class="weekly-phase-goal"><span>本階段目標</span>${renderCompactList(phase.objectives)}</div>
      <div class="weekly-phase-columns">
        <div><span>進入條件</span>${renderCompactList(phase.entryCriteria)}</div>
        <div><span>執行內容</span>${renderCompactList(phase.actions)}<p class="weekly-dose"><strong>劑量：</strong>${escapeHtml(phase.dosage)}</p></div>
        <div><span>監測</span>${renderCompactList(phase.monitoring)}</div>
        <div><span>進階條件</span>${renderCompactList(phase.progressionCriteria)}</div>
        <div><span>退階條件</span>${renderCompactList(phase.regressionCriteria)}</div>
      </div>
    </article>`;
}

function renderLoadManagement(loadManagement) {
  if (!loadManagement) return "";
  const fields = [
    ["建立基線", loadManagement.baseline],
    ["如何增加", loadManagement.progression],
    ["每次監測", loadManagement.monitoring],
    ["每週回顧", loadManagement.weeklyReview]
  ];
  return `
    <div class="weekly-guide-block">
      <h4>訓練量如何規劃</h4>
      <div class="weekly-load-grid">${fields.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join("")}</div>
    </div>`;
}

function renderDecisionPathway(pathway) {
  if (!pathway) return "";
  const steps = Array.isArray(pathway.steps) ? pathway.steps : [];
  return `
    <section class="weekly-report-section weekly-decision-panel" aria-labelledby="weekly-decision-title">
      <div class="weekly-section-heading">
        <p class="weekly-section-kicker">DECISION PATHWAY</p>
        <h3 id="weekly-decision-title">${escapeHtml(pathway.title)}</h3>
      </div>
      <div class="weekly-decision-start">${escapeHtml(pathway.start)}</div>
      <div class="weekly-decision-flow">
        ${steps.map((step, index) => `
          <article class="weekly-decision-step">
            <div class="weekly-decision-question"><span>${index + 1}</span><h4>${escapeHtml(step.question)}</h4></div>
            <div class="weekly-decision-branches">
              <div class="is-yes"><strong>YES</strong><p>${escapeHtml(step.ifYes)}</p></div>
              <div class="is-no"><strong>NO</strong><p>${escapeHtml(step.ifNo)}</p></div>
            </div>
          </article>`).join("")}
      </div>
      <p class="weekly-decision-note">${escapeHtml(pathway.note)}</p>
    </section>`;
}

function renderGuideNotes(title, items, icon) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<article><h4><i data-lucide="${escapeAttribute(icon)}"></i>${escapeHtml(title)}</h4>${renderCompactList(items)}</article>`;
}

function renderCompactList(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderBasisBadge(basis) {
  if (!basis) return "";
  return `<span class="weekly-basis is-${escapeAttribute(basis)}">${escapeHtml(EVIDENCE_BASIS_LABELS[basis] ?? basis)}</span>`;
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
