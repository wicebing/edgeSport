const CONTENT_URL = "content/issues.json";
const SOURCE_REGISTRY_URL = "content/source-registry.json";
const KNOWLEDGE_INDEX_URL = "content/knowledge-index.json";
const SAVED_ISSUES_KEY = "edge-sport-saved-issues";
const CARD_ACCENTS = ["#e96a4a", "#2a8ab0", "#b8d94d", "#14362f"];
const INITIAL_VISIBLE_KNOWLEDGE_RECORDS = 16;

const state = {
  content: null,
  sourceRegistry: null,
  knowledgeIndex: null,
  selectedIssueId: null,
  savedIssueIds: new Set(readSavedIssueIds()),
  savedOnly: false,
  visibleKnowledgeRecords: INITIAL_VISIBLE_KNOWLEDGE_RECORDS,
  filters: {
    query: "",
    type: "all",
    year: "all",
    topic: "all",
    sport: "all"
  }
};

const elements = {
  heroImage: document.querySelector("#hero-image"),
  heroKicker: document.querySelector("#hero-kicker"),
  heroWeek: document.querySelector("#hero-week"),
  heroTitle: document.querySelector("#hero-title"),
  heroSummary: document.querySelector("#hero-summary"),
  heroTags: document.querySelector("#hero-tags"),
  readCurrent: document.querySelector("#read-current"),
  saveCurrent: document.querySelector("#save-current"),
  savedToggle: document.querySelector("#saved-toggle"),
  savedCount: document.querySelector("#saved-count"),
  filterForm: document.querySelector("#filter-form"),
  searchInput: document.querySelector("#search-input"),
  typeFilter: document.querySelector("#type-filter"),
  yearFilter: document.querySelector("#year-filter"),
  topicFilter: document.querySelector("#topic-filter"),
  sportFilter: document.querySelector("#sport-filter"),
  clearFilters: document.querySelector("#clear-filters"),
  activeFilters: document.querySelector("#active-filters"),
  resultCount: document.querySelector("#result-count"),
  issueGrid: document.querySelector("#issue-grid"),
  archiveRetentionNote: document.querySelector("#archive-retention-note"),
  showMoreKnowledge: document.querySelector("#show-more-knowledge"),
  readingWeek: document.querySelector("#reading-week"),
  readingTopicList: document.querySelector("#reading-topic-list"),
  issueDetail: document.querySelector("#issue-detail"),
  saveReading: document.querySelector("#save-reading"),
  journalList: document.querySelector("#journal-list"),
  organizationList: document.querySelector("#organization-list"),
  coverageJournalCount: document.querySelector("#coverage-journal-count"),
  coverageOrganizationCount: document.querySelector("#coverage-organization-count"),
  footerDisclaimer: document.querySelector("#footer-disclaimer")
};

initialize().catch((error) => {
  console.error(error);
  elements.issueGrid.innerHTML = `
    <div class="empty-state">
      <h3>內容暫時無法載入</h3>
      <p>請確認本機伺服器已啟動，並檢查 content/issues.json。</p>
    </div>`;
  elements.issueDetail.innerHTML = `<p class="error-copy">${escapeHtml(error.message)}</p>`;
});

async function initialize() {
  const [contentResponse, sourceRegistryResponse, knowledgeIndexResponse] = await Promise.all([
    fetch(CONTENT_URL),
    fetch(SOURCE_REGISTRY_URL),
    fetch(KNOWLEDGE_INDEX_URL)
  ]);

  if (!contentResponse.ok) {
    throw new Error(`Content request failed with ${contentResponse.status}.`);
  }

  state.content = await contentResponse.json();
  if (!knowledgeIndexResponse.ok) {
    throw new Error(`Knowledge index request failed with ${knowledgeIndexResponse.status}.`);
  }
  state.knowledgeIndex = await knowledgeIndexResponse.json();
  if (sourceRegistryResponse.ok) {
    state.sourceRegistry = await sourceRegistryResponse.json();
  }
  const publishedIssues = getPublishedIssues();
  state.selectedIssueId = resolveInitialIssueId(publishedIssues);

  renderFilterOptions();
  renderJournalWatch();
  renderFooter();
  bindEvents();
  render();
}

function bindEvents() {
  elements.filterForm.addEventListener("submit", (event) => event.preventDefault());

  elements.searchInput.addEventListener("input", (event) => {
    state.filters.query = event.target.value.trim();
    state.visibleKnowledgeRecords = INITIAL_VISIBLE_KNOWLEDGE_RECORDS;
    renderIssueGrid();
  });

  elements.typeFilter.addEventListener("change", (event) => {
    state.filters.type = event.target.value;
    state.visibleKnowledgeRecords = INITIAL_VISIBLE_KNOWLEDGE_RECORDS;
    renderIssueGrid();
  });

  elements.yearFilter.addEventListener("change", (event) => {
    state.filters.year = event.target.value;
    state.visibleKnowledgeRecords = INITIAL_VISIBLE_KNOWLEDGE_RECORDS;
    renderIssueGrid();
  });

  elements.topicFilter.addEventListener("change", (event) => {
    state.filters.topic = event.target.value;
    state.visibleKnowledgeRecords = INITIAL_VISIBLE_KNOWLEDGE_RECORDS;
    renderIssueGrid();
  });

  elements.sportFilter.addEventListener("change", (event) => {
    state.filters.sport = event.target.value;
    state.visibleKnowledgeRecords = INITIAL_VISIBLE_KNOWLEDGE_RECORDS;
    renderIssueGrid();
  });

  elements.clearFilters.addEventListener("click", () => {
    state.filters = { query: "", type: "all", year: "all", topic: "all", sport: "all" };
    state.savedOnly = false;
    state.visibleKnowledgeRecords = INITIAL_VISIBLE_KNOWLEDGE_RECORDS;
    elements.searchInput.value = "";
    elements.typeFilter.value = "all";
    elements.yearFilter.value = "all";
    elements.topicFilter.value = "all";
    elements.sportFilter.value = "all";
    renderIssueGrid();
  });

  elements.issueGrid.addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-issue]");
    if (saveButton) {
      toggleSavedIssue(saveButton.dataset.saveIssue);
      return;
    }

    const openButton = event.target.closest("[data-open-issue]");
    if (openButton) {
      event.preventDefault();
      selectIssue(openButton.dataset.openIssue, true);
    }
  });

  elements.saveCurrent.addEventListener("click", () => toggleSavedIssue(state.selectedIssueId));
  elements.saveReading.addEventListener("click", () => toggleSavedIssue(state.selectedIssueId));
  elements.savedToggle.addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    state.visibleKnowledgeRecords = INITIAL_VISIBLE_KNOWLEDGE_RECORDS;
    renderIssueGrid();
  });

  elements.showMoreKnowledge.addEventListener("click", () => {
    state.visibleKnowledgeRecords += INITIAL_VISIBLE_KNOWLEDGE_RECORDS;
    renderIssueGrid();
  });

  elements.readCurrent.addEventListener("click", () => {
    document.querySelector("#reading").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function render() {
  renderSelectedIssue();
  renderIssueGrid();
  updateSavedControls();
  refreshIcons();
}

function renderSelectedIssue() {
  const issue = getSelectedIssue();
  if (!issue) {
    return;
  }

  const topics = getTopicLabels(issue.topicIds);
  elements.heroImage.src = issue.coverImage?.src || state.content.site.heroImage.src;
  elements.heroImage.alt = issue.coverImage?.alt || state.content.site.heroImage.alt;
  elements.heroKicker.textContent = issue.evidenceLens;
  elements.heroWeek.textContent = `${issue.monthLabel ?? issue.weekLabel} / ${formatDate(issue.publishDate)}`;
  elements.heroTitle.textContent = issue.title;
  elements.heroSummary.textContent = issue.summary;
  elements.heroTags.innerHTML = renderTags([...topics, ...issue.sportTags]);

  elements.readingWeek.textContent = `${issue.monthLabel ?? issue.weekLabel} / ${issue.readingMinutes} min read`;
  elements.readingTopicList.innerHTML = renderTags(topics);
  elements.issueDetail.innerHTML = renderIssueDetail(issue, topics);
  document.title = `${issue.title} | EDGE SPORT`;
}

function renderIssueGrid() {
  const matchingRecords = getFilteredKnowledgeRecords();
  const filters = getActiveFilterLabels();
  const typeCounts = countKnowledgeTypes(matchingRecords);
  const visibleRecords = matchingRecords.slice(0, state.visibleKnowledgeRecords);
  elements.resultCount.textContent = state.savedOnly
    ? `已收藏 ${matchingRecords.length} 個議題`
    : `找到 ${matchingRecords.length} 筆知識：${typeCounts.editorial} 份週報／議題／Podcast、${typeCounts.research} 筆研究`;
  elements.activeFilters.innerHTML = filters.map((filter) => `<span class="filter-token">${escapeHtml(filter)}</span>`).join("");
  elements.archiveRetentionNote.textContent = `知識庫目前累積 ${state.knowledgeIndex.stats.total} 筆；例行更新只新增或更新同一 ID，不會淘汰舊週報、舊議題、Podcast 或研究題錄。`;
  elements.showMoreKnowledge.hidden = matchingRecords.length <= visibleRecords.length;

  if (matchingRecords.length === 0) {
    elements.issueGrid.innerHTML = `
      <div class="empty-state">
        <h3>沒有符合的知識紀錄</h3>
        <p>調整關鍵詞或清除篩選條件後再試一次。</p>
      </div>`;
    refreshIcons();
    return;
  }

  elements.issueGrid.innerHTML = visibleRecords.map((record, index) => renderKnowledgeCard(record, index)).join("");
  updateSavedControls();
  refreshIcons();
}

function renderKnowledgeCard(record, index) {
  const isIssue = record.type === "monthly-topic" || record.type === "knowledge-topic";
  const isSaved = isIssue && state.savedIssueIds.has(record.sourceId);
  const isSelected = isIssue && record.sourceId === state.selectedIssueId;
  const accent = CARD_ACCENTS[index % CARD_ACCENTS.length];
  const openAttribute = isIssue ? ` data-open-issue="${escapeAttribute(record.sourceId)}"` : "";
  const visibleTags = record.tags.slice(0, 3);

  return `
    <article class="issue-card knowledge-card is-${escapeAttribute(record.type)}" style="--card-accent: ${accent}">
      <div class="issue-card-inner">
        <a class="issue-card-open" href="${escapeAttribute(record.href)}"${openAttribute} aria-current="${isSelected ? "true" : "false"}">
          <span class="card-meta">${escapeHtml(record.year)} / ${escapeHtml(formatDate(record.publishDate))}</span>
          <span class="knowledge-card-badge">${escapeHtml(record.typeLabel)}</span>
          <h3>${escapeHtml(record.title)}</h3>
          <p>${escapeHtml(record.summary)}</p>
          <div class="tag-list">${renderTags(visibleTags)}</div>
        </a>
        <div class="card-footer">
          <span class="card-reading-time">${escapeHtml(record.detail)}</span>
          ${isIssue ? `<button
            class="icon-button save-card"
            type="button"
            data-save-issue="${escapeAttribute(record.sourceId)}"
            title="${isSaved ? "取消收藏" : "收藏議題"}"
            aria-label="${isSaved ? "取消收藏" : `收藏：${escapeAttribute(record.title)}`}"
            aria-pressed="${isSaved}"
          >
            <i data-lucide="bookmark"></i>
          </button>` : `<i class="knowledge-card-arrow" data-lucide="arrow-up-right"></i>`}
        </div>
      </div>
    </article>`;
}

function renderIssueDetail(issue, topics) {
  if (issue.kind === "monthly-deep-dive") {
    return renderMonthlyIssueDetail(issue, topics);
  }
  return `
    <header class="issue-detail-header">
      <p class="eyebrow eyebrow-dark">${escapeHtml(issue.evidenceLens)}</p>
      <h2 id="reading-title">${escapeHtml(issue.title)}</h2>
      <p class="issue-detail-summary">${escapeHtml(issue.summary)}</p>
      <div class="issue-facts">
        <span class="fact">${escapeHtml(issue.weekLabel)}</span>
        <span class="fact">${escapeHtml(String(issue.readingMinutes))} min read</span>
        <span class="fact">${escapeHtml(issue.evidence.length)} evidence sources</span>
      </div>
    </header>

    <section class="issue-section" aria-labelledby="question-title">
      <h3 id="question-title">本期核心問題</h3>
      <p class="issue-question">${escapeHtml(issue.question)}</p>
    </section>

    <section class="issue-section" aria-labelledby="takeaway-title">
      <h3 id="takeaway-title">先帶走的三個重點</h3>
      <div class="takeaway-grid">
        ${issue.takeaways.map((takeaway) => `
          <article class="takeaway">
            <h4>${escapeHtml(takeaway.title)}</h4>
            <p>${escapeHtml(takeaway.body)}</p>
          </article>`).join("")}
      </div>
    </section>

    <section class="issue-section" aria-labelledby="decision-title">
      <h3 id="decision-title">決策路徑</h3>
      <ol class="decision-list">
        ${issue.decisionPath.map((step) => `
          <li>
            <span class="decision-stage">${escapeHtml(step.stage)}</span>
            <div class="decision-body">
              <h4>${escapeHtml(step.question)}</h4>
              <ul class="signal-list">${step.signals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join("")}</ul>
              <p class="action-copy">${escapeHtml(step.action)}</p>
            </div>
          </li>`).join("")}
      </ol>
    </section>

    <section class="issue-section" aria-labelledby="metrics-title">
      <h3 id="metrics-title">該量什麼，怎麼用</h3>
      <div class="metrics-grid">
        ${issue.metrics.map((metric) => `
          <article class="metric">
            <h4>${escapeHtml(metric.name)}</h4>
            <p>${escapeHtml(metric.why)}</p>
            <p class="metric-practice">${escapeHtml(metric.practice)}</p>
          </article>`).join("")}
      </div>
    </section>

    <section class="issue-section practice-evidence-grid" aria-label="實務建議與證據來源">
      <div class="practice-panel">
        <h3>本週場邊清單</h3>
        <ul>${issue.fieldChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div>
        <h3>可回查的證據</h3>
        <ol class="evidence-list">
          ${issue.evidence.map((reference) => `
            <li>
              <span class="evidence-type">${escapeHtml(reference.type)}</span>
              <div>
                <p class="evidence-citation">${escapeHtml(reference.citation)}</p>
                <p class="evidence-source">${escapeHtml(reference.source)}</p>
                <p class="evidence-note">${escapeHtml(reference.note)}</p>
              </div>
              <a class="source-link" href="${safeUrl(reference.url)}" target="_blank" rel="noreferrer" title="開啟來源" aria-label="開啟來源：${escapeAttribute(reference.citation)}">
                <i data-lucide="external-link"></i>
              </a>
            </li>`).join("")}
        </ol>
      </div>
    </section>

    <section class="issue-section" aria-labelledby="trend-title">
      <div class="trend-panel">
        <h3 id="trend-title">${escapeHtml(issue.trend.title)}</h3>
        <p>${escapeHtml(issue.trend.body)}</p>
      </div>
    </section>

    <section class="issue-section" aria-label="編輯脈絡">
      <p class="course-context"><strong>本機課程脈絡：</strong>${escapeHtml(issue.courseConnections.join(" / "))}。公開頁面保留整合結論與可回查學術來源，不散佈課程原始檔或期刊全文。</p>
    </section>`;
}

function renderMonthlyIssueDetail(issue, topics) {
  const evidenceById = new Map((issue.evidence ?? []).map((source) => [source.sourceId, source]));
  return `
    <header class="issue-detail-header monthly-detail-header">
      <p class="eyebrow eyebrow-dark">MONTHLY DEEP DIVE · EVIDENCE SYNTHESIS</p>
      <h2 id="reading-title">${escapeHtml(issue.title)}</h2>
      <p class="issue-detail-summary">${escapeHtml(issue.summary)}</p>
      <div class="issue-facts">
        <span class="fact">${escapeHtml(issue.monthLabel)}</span>
        <span class="fact">${escapeHtml(String(issue.readingMinutes))} min deep read</span>
        <span class="fact">${escapeHtml(String(issue.evidence.length))} 篇完整研究</span>
        <span class="fact is-automated">Codex CLI 自動整理・尚未人工審閱</span>
      </div>
    </header>

    <section class="issue-section" aria-labelledby="monthly-question-title">
      <p class="monthly-section-kicker">THE QUESTION</p>
      <h3 id="monthly-question-title">這個月要回答的問題</h3>
      <p class="issue-question">${escapeHtml(issue.question)}</p>
    </section>

    <section class="issue-section" aria-labelledby="why-now-title">
      <p class="monthly-section-kicker">WHY NOW</p>
      <h3 id="why-now-title">為什麼現在值得深入</h3>
      <div class="monthly-why-grid">
        ${renderWhyNowCard("本月訊號", issue.whyNow.currentSignal, "radio")}
        ${renderWhyNowCard("知識缺口", issue.whyNow.knowledgeGap, "search-check")}
        ${renderWhyNowCard("決策需要", issue.whyNow.decisionNeed, "route")}
      </div>
      <div class="monthly-objectives">
        <h4>讀完後應該能夠</h4>
        <ol>${issue.learningObjectives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>
      </div>
      <aside class="monthly-evidence-lens">
        <strong>本期證據怎麼讀</strong>
        <p>${escapeHtml(issue.evidenceLens)}</p>
      </aside>
    </section>

    ${renderMonthlyPrimer(issue.knowledgePrimer)}
    ${renderMonthlyNumbers(issue.keyNumbers, evidenceById)}
    ${renderMonthlyEvidence(issue.evidenceSynthesis, evidenceById)}
    ${renderMonthlyVisualization(issue.visualization)}

    <section class="issue-section" aria-labelledby="monthly-comparison-title">
      <p class="monthly-section-kicker">SYNTHESIS</p>
      <h3 id="monthly-comparison-title">研究之間怎麼互相補充</h3>
      ${renderMonthlyTable(issue.comparisonTable, "monthly-comparison-table")}
    </section>

    <section class="issue-section" aria-labelledby="monthly-takeaways-title">
      <p class="monthly-section-kicker">WHAT CHANGED</p>
      <h3 id="monthly-takeaways-title">本月最值得帶走的進展</h3>
      <div class="takeaway-grid monthly-takeaway-grid">
        ${issue.takeaways.map((takeaway) => `<article class="takeaway"><h4>${escapeHtml(takeaway.title)}</h4><p>${escapeHtml(takeaway.body)}</p></article>`).join("")}
      </div>
    </section>

    ${renderMonthlyProtocol(issue.actionProtocol)}

    <section class="issue-section" aria-labelledby="monthly-decision-title">
      <p class="monthly-section-kicker">DECISION TOOL</p>
      <h3 id="monthly-decision-title">把證據放進現場決策</h3>
      <ol class="decision-list monthly-decision-list">
        ${issue.decisionPath.map((step) => `
          <li>
            <span class="decision-stage">${escapeHtml(step.stage)}</span>
            <div class="decision-body">
              <h4>${escapeHtml(step.question)}</h4>
              <ul class="signal-list">${step.signals.map((signal) => `<li>${escapeHtml(signal)}</li>`).join("")}</ul>
              <p class="action-copy">${escapeHtml(step.action)}</p>
            </div>
          </li>`).join("")}
      </ol>
    </section>

    <section class="issue-section" aria-labelledby="monthly-monitor-title">
      <p class="monthly-section-kicker">MEASURE & REVIEW</p>
      <h3 id="monthly-monitor-title">要量什麼，如何判讀</h3>
      <div class="metrics-grid">
        ${issue.metrics.map((metric) => `<article class="metric"><h4>${escapeHtml(metric.name)}</h4><p>${escapeHtml(metric.why)}</p><p class="metric-practice">${escapeHtml(metric.practice)}</p></article>`).join("")}
      </div>
    </section>

    <section class="issue-section monthly-context-grid" aria-label="當月脈絡與知識進展">
      ${renderCurrentAffairs(issue.currentAffairs)}
      ${renderCourseProgress(issue.courseConnectionsDetailed)}
      ${renderPriorProgress(issue.priorReportConnections)}
    </section>

    <section class="issue-section practice-evidence-grid" aria-label="現場清單與完整研究來源">
      <div class="practice-panel">
        <h3>現場執行清單</h3>
        <ul>${issue.fieldChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div>
        <h3>完整研究來源</h3>
        <ol class="evidence-list">
          ${issue.evidence.map((reference) => `
            <li>
              <span class="evidence-type">${escapeHtml(reference.type)}</span>
              <div><p class="evidence-citation">${escapeHtml(reference.citation)}</p><p class="evidence-source">${escapeHtml(reference.source)}</p><p class="evidence-note">${escapeHtml(reference.note)}</p></div>
              <a class="source-link" href="${safeUrl(reference.url)}" target="_blank" rel="noreferrer" title="開啟研究來源" aria-label="開啟研究來源：${escapeAttribute(reference.citation)}"><i data-lucide="external-link"></i></a>
            </li>`).join("")}
        </ol>
      </div>
    </section>

    <section class="issue-section monthly-boundary-grid" aria-label="趨勢與不確定性">
      <div class="trend-panel"><h3>${escapeHtml(issue.trend.title)}</h3><p>${escapeHtml(issue.trend.body)}</p></div>
      <div class="monthly-uncertainty"><h3>目前還不能確定</h3><ul>${issue.uncertainties.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    </section>`;
}

function renderWhyNowCard(title, body, icon) {
  return `<article><i data-lucide="${escapeAttribute(icon)}"></i><h4>${escapeHtml(title)}</h4><p>${escapeHtml(body)}</p></article>`;
}

function renderMonthlyPrimer(primer) {
  const basisLabels = monthlyBasisLabels();
  return `
    <section class="issue-section" aria-labelledby="monthly-primer-title">
      <p class="monthly-section-kicker">KNOWLEDGE PRIMER</p>
      <h3 id="monthly-primer-title">先把概念與機轉說清楚</h3>
      <p class="monthly-primer-overview">${escapeHtml(primer.overview)}</p>
      <div class="monthly-definition-grid">
        ${primer.definitions.map((item) => `
          <article>
            <div class="monthly-card-heading"><h4>${escapeHtml(item.term)}</h4><span class="monthly-basis">${escapeHtml(basisLabels[item.basis] ?? item.basis)}</span></div>
            <p>${escapeHtml(item.definition)}</p>
            <div class="monthly-distinction"><strong>不要混淆：</strong>${escapeHtml(item.distinction)}</div>
          </article>`).join("")}
      </div>
      <div class="monthly-mechanism-list">
        ${primer.mechanisms.map((item) => `<article><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.explanation)}</p><p class="monthly-practical-meaning"><strong>實務意義：</strong>${escapeHtml(item.practicalMeaning)}</p><span>${escapeHtml(item.sourceIds.join(" · "))}</span></article>`).join("")}
      </div>
    </section>`;
}

function renderMonthlyNumbers(numbers, evidenceById) {
  return `
    <section class="issue-section" aria-labelledby="monthly-number-title">
      <p class="monthly-section-kicker">NUMBERS WITH CONTEXT</p>
      <h3 id="monthly-number-title">本月必須記住的數字</h3>
      <div class="monthly-number-grid">
        ${numbers.map((item) => {
          const names = item.sourceIds.map((id) => evidenceById.get(id)?.source ?? id).join(" · ");
          return `<article><strong>${escapeHtml(item.value)}</strong><h4>${escapeHtml(item.label)}</h4><p>${escapeHtml(item.context)}</p><span>${escapeHtml(names)}</span></article>`;
        }).join("")}
      </div>
    </section>`;
}

function renderMonthlyEvidence(items, evidenceById) {
  const levelLabels = { high: "高", moderate: "中", low: "低", "very-low": "極低", "not-graded": "未分級" };
  return `
    <section class="issue-section" aria-labelledby="monthly-evidence-title">
      <p class="monthly-section-kicker">READ THE STUDIES</p>
      <h3 id="monthly-evidence-title">研究完整讀過後，真正告訴我們什麼</h3>
      <div class="monthly-study-list">
        ${items.map((item, index) => {
          const source = evidenceById.get(item.sourceId);
          return `
            <article class="monthly-study-card">
              <header>
                <div><span>STUDY ${index + 1} · 證據層級 ${escapeHtml(levelLabels[item.evidenceLevel] ?? item.evidenceLevel)}</span><h4>${escapeHtml(source?.citation ?? item.sourceId)}</h4><p>${escapeHtml(source?.source ?? item.sourceId)}</p></div>
                ${source ? `<a class="source-link" href="${safeUrl(source.url)}" target="_blank" rel="noreferrer" aria-label="開啟研究來源"><i data-lucide="external-link"></i></a>` : ""}
              </header>
              <div class="monthly-study-methods">
                <div><span>研究設計</span><p>${escapeHtml(item.studyDesign)}</p></div>
                <div><span>研究族群</span><p>${escapeHtml(item.population)}</p></div>
                <div><span>方法與比較</span><p>${escapeHtml(item.methods)}</p></div>
              </div>
              <div class="monthly-table-wrap"><table class="monthly-data-table"><caption>關鍵量化結果</caption><thead><tr><th>指標</th><th>結果</th><th>情境</th><th>原文位置</th></tr></thead><tbody>${item.quantitativeResults.map((result) => `<tr><td>${escapeHtml(result.measure)}</td><td><strong>${escapeHtml(result.result)}</strong></td><td>${escapeHtml(result.context)}</td><td>${escapeHtml(result.sourceLocation)}</td></tr>`).join("")}</tbody></table></div>
              <div class="monthly-study-conclusion"><div><span>如何解讀</span><p>${escapeHtml(item.interpretation)}</p></div><div><span>限制</span><ul>${item.limitations.map((limit) => `<li>${escapeHtml(limit)}</li>`).join("")}</ul></div></div>
            </article>`;
        }).join("")}
      </div>
    </section>`;
}

function renderMonthlyVisualization(visualization) {
  if (!visualization) return "";
  const maximum = Math.max(...visualization.data.map((item) => item.value), 1);
  return `
    <section class="issue-section" aria-labelledby="monthly-chart-title">
      <p class="monthly-section-kicker">ORIGINAL REDRAW</p>
      <figure class="monthly-chart">
        <h3 id="monthly-chart-title">${escapeHtml(visualization.title)}</h3>
        <figcaption>${escapeHtml(visualization.caption)}</figcaption>
        ${visualization.data.map((item) => `<div class="monthly-chart-row"><span>${escapeHtml(item.label)}</span><div aria-hidden="true"><i style="--monthly-bar:${Math.max(3, item.value / maximum * 100)}%"></i></div><strong>${escapeHtml(String(item.value))} ${escapeHtml(visualization.unit)}</strong><p>${escapeHtml(item.detail)}</p></div>`).join("")}
        <small>${escapeHtml(visualization.sourceNote)}</small>
      </figure>
    </section>`;
}

function renderMonthlyProtocol(protocol) {
  const basisLabels = monthlyBasisLabels();
  const stopLabels = { modify: "調整", stop: "停止", "urgent-referral": "立即轉介" };
  return `
    <section class="issue-section monthly-protocol" aria-labelledby="monthly-protocol-title">
      <p class="monthly-section-kicker">EVIDENCE TO ACTION</p>
      <h3 id="monthly-protocol-title">${escapeHtml(protocol.title)}</h3>
      <p class="monthly-protocol-scope">${escapeHtml(protocol.scope)}</p>
      <div class="monthly-protocol-brief"><div><span>適用對象</span><p>${escapeHtml(protocol.targetPopulation)}</p></div><div><span>目標</span><p>${escapeHtml(protocol.goal)}</p></div></div>
      <h4>評估組合</h4>
      ${renderMonthlyTable(protocol.assessmentTable, "monthly-assessment-table")}
      <h4>分期做法與進退階</h4>
      <div class="monthly-phase-list">
        ${protocol.phases.map((phase, index) => `
          <article>
            <span class="monthly-phase-index">${index + 1}</span>
            <div class="monthly-phase-head"><div><h5>${escapeHtml(phase.phase)}</h5><p>${escapeHtml(phase.timing)}</p></div><span class="monthly-basis">${escapeHtml(basisLabels[phase.evidenceBasis] ?? phase.evidenceBasis)}</span></div>
            <div class="monthly-phase-grid">
              ${renderMonthlyListCell("進入條件", phase.entryCriteria)}
              ${renderMonthlyListCell("執行內容", phase.actions)}
              <div><span>劑量／安排</span><p>${escapeHtml(phase.dosage)}</p></div>
              ${renderMonthlyListCell("監測", phase.monitoring)}
              ${renderMonthlyListCell("進階條件", phase.progressionCriteria)}
              ${renderMonthlyListCell("退階條件", phase.regressionCriteria)}
            </div>
          </article>`).join("")}
      </div>
      <h4>訓練量規劃</h4>
      <div class="monthly-load-grid">
        <div><span>基線</span><p>${escapeHtml(protocol.loadManagement.baseline)}</p></div>
        <div><span>進展</span><p>${escapeHtml(protocol.loadManagement.progression)}</p></div>
        <div><span>監測</span><p>${escapeHtml(protocol.loadManagement.monitoring)}</p></div>
        <div><span>回顧節奏</span><p>${escapeHtml(protocol.loadManagement.reviewCadence)}</p></div>
      </div>
      <h4>暫停、停止與轉介條件</h4>
      <div class="monthly-stop-grid">${protocol.stopRules.map((rule) => `<article class="is-${escapeAttribute(rule.urgency)}"><div><strong>${escapeHtml(stopLabels[rule.urgency] ?? rule.urgency)}</strong><span class="monthly-basis">${escapeHtml(basisLabels[rule.evidenceBasis] ?? rule.evidenceBasis)}</span></div><h5>${escapeHtml(rule.trigger)}</h5><p><b>處置：</b>${escapeHtml(rule.action)}</p><p><b>恢復條件：</b>${escapeHtml(rule.restartCriteria)}</p></article>`).join("")}</div>
      <h4>結果追蹤</h4>
      <div class="monthly-table-wrap"><table class="monthly-data-table"><thead><tr><th>領域</th><th>量測</th><th>頻率</th><th>解讀</th></tr></thead><tbody>${protocol.outcomeTracking.map((item) => `<tr><td>${escapeHtml(item.domain)}</td><td>${escapeHtml(item.measure)}</td><td>${escapeHtml(item.frequency)}</td><td>${escapeHtml(item.interpretation)}</td></tr>`).join("")}</tbody></table></div>
    </section>`;
}

function renderMonthlyTable(table, extraClass) {
  return `<div class="monthly-table-wrap"><table class="monthly-data-table ${escapeAttribute(extraClass)}"><caption>${escapeHtml(table.title)}</caption><thead><tr>${table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table><p class="monthly-table-source">${escapeHtml(table.sourceNote)}</p></div>`;
}

function renderMonthlyListCell(label, items) {
  return `<div><span>${escapeHtml(label)}</span><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
}

function renderCurrentAffairs(items) {
  return `<article class="monthly-context-panel"><p class="monthly-section-kicker">CURRENT SIGNALS</p><h3>運動時事與本月訊號</h3>${items.map((item) => `<div class="monthly-context-item"><span>${escapeHtml(item.publicationDate)} · ${escapeHtml(item.source)}</span><a href="${safeUrl(item.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a><p>${escapeHtml(item.relevance)}</p><small>${escapeHtml(item.evidenceBoundary)}</small></div>`).join("")}</article>`;
}

function renderCourseProgress(items) {
  return `<article class="monthly-context-panel"><p class="monthly-section-kicker">INCLASS</p><h3>課程基礎與新進展</h3>${items.map((item) => `<div class="monthly-context-item"><span>${escapeHtml(item.concepts.join(" · "))}</span><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.knowledge)}</p><small>${escapeHtml(item.progression)}</small></div>`).join("")}</article>`;
}

function renderPriorProgress(items) {
  return `<article class="monthly-context-panel"><p class="monthly-section-kicker">KNOWLEDGE HISTORY</p><h3>和曾經寫過的內容相比</h3>${items.map((item) => `<div class="monthly-context-item"><span>${escapeHtml(formatDate(item.publishDate))}</span><a href="${escapeAttribute(monthlyPriorHref(item))}">${escapeHtml(item.title)}</a><p>${escapeHtml(item.knowledge)}</p><small>${escapeHtml(item.progression)}</small></div>`).join("")}</article>`;
}

function monthlyPriorHref(item) {
  return item.kind === "integrated-weekly-report" ? `?report=${encodeURIComponent(item.reportId)}#weekly-reports` : `?issue=${encodeURIComponent(item.reportId)}#reading`;
}

function monthlyBasisLabels() {
  return {
    "source-stated": "研究來源明載",
    "inclass-supported": "inClass 支持",
    "prior-report-supported": "既有報告支持",
    "cross-source-synthesis": "跨研究整合",
    "edge-sport-proposal": "EDGE SPORT 操作提案",
    mixed: "混合依據"
  };
}

function renderFilterOptions() {
  const topicOptions = state.content.topics
    .map((topic) => `<option value="${escapeAttribute(topic.id)}">${escapeHtml(topic.label)}</option>`)
    .join("");
  elements.topicFilter.insertAdjacentHTML("beforeend", topicOptions);

  const typeOptions = [
    ["monthly-topic", "月度深度議題"],
    ["podcast-episode", "English Podcast"],
    ["weekly-report", "每週整合週報"],
    ["knowledge-topic", "歷史知識議題"],
    ["research-article", "研究文章與題錄"]
  ].map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  elements.typeFilter.insertAdjacentHTML("beforeend", typeOptions);

  const yearOptions = (state.knowledgeIndex.stats.years ?? [])
    .map((year) => `<option value="${escapeAttribute(year)}">${escapeHtml(year)} 年</option>`)
    .join("");
  elements.yearFilter.insertAdjacentHTML("beforeend", yearOptions);

  const sports = [...new Set(getKnowledgeRecords().flatMap((record) => record.sportTags))].sort((left, right) => left.localeCompare(right, "zh-Hant"));
  const sportOptions = sports.map((sport) => `<option value="${escapeAttribute(sport)}">${escapeHtml(sport)}</option>`).join("");
  elements.sportFilter.insertAdjacentHTML("beforeend", sportOptions);
}

function renderJournalWatch() {
  const journals = state.sourceRegistry?.pubmed?.journals ?? state.content.journals;
  elements.journalList.innerHTML = journals.map((journal) => `
    <article class="journal-item">
      <div>
        <p class="journal-abbr">${escapeHtml(journal.abbreviation)}</p>
        <p class="journal-name">${escapeHtml(journal.name)}</p>
        <p class="journal-scope">${escapeHtml(journal.focus ?? journal.scope)}</p>
      </div>
      <a class="journal-link" href="${safeUrl(journal.officialUrl ?? journal.url)}" target="_blank" rel="noreferrer">
        官方頁面
        <i data-lucide="arrow-up-right"></i>
      </a>
    </article>`).join("");

  const organizations = state.sourceRegistry?.officialOrganizations ?? [];
  if (elements.organizationList) {
    elements.organizationList.innerHTML = organizations.map((organization) => `
      <article class="organization-item">
        <div>
          <p class="organization-abbr">${escapeHtml(organization.abbreviation)}</p>
          <p class="organization-name">${escapeHtml(organization.name)}</p>
          <p class="organization-focus">${escapeHtml(organization.focus)}</p>
        </div>
        <a class="organization-link" href="${safeUrl(organization.officialUrl)}" target="_blank" rel="noreferrer">
          官方網站
          <i data-lucide="arrow-up-right"></i>
        </a>
      </article>`).join("");
  }

  refreshIcons();
}

function renderFooter() {
  elements.footerDisclaimer.textContent = state.content.site.disclaimer;
  const journals = state.sourceRegistry?.pubmed?.journals ?? state.content.journals ?? [];
  const organizations = state.sourceRegistry?.officialOrganizations ?? [];
  if (elements.coverageJournalCount) {
    elements.coverageJournalCount.textContent = String(journals.length);
  }
  if (elements.coverageOrganizationCount) {
    elements.coverageOrganizationCount.textContent = String(organizations.length);
  }
}

function getPublishedIssues() {
  return state.content.issues
    .filter((issue) => issue.status === "published")
    .sort((left, right) => right.publishDate.localeCompare(left.publishDate));
}

function getKnowledgeRecords() {
  return state.knowledgeIndex?.records ?? [];
}

function getFilteredKnowledgeRecords() {
  const normalizedQuery = state.filters.query.toLocaleLowerCase("zh-Hant");
  return getKnowledgeRecords().filter((record) => {
    const isTopicMatch = state.filters.topic === "all" || record.topicIds.includes(state.filters.topic);
    const isSportMatch = state.filters.sport === "all" || record.sportTags.includes(state.filters.sport);
    const isTypeMatch = state.filters.type === "all" || record.type === state.filters.type;
    const isYearMatch = state.filters.year === "all" || record.year === state.filters.year;
    const isSearchMatch = !normalizedQuery || record.searchText.toLocaleLowerCase("zh-Hant").includes(normalizedQuery);
    const isIssue = record.type === "monthly-topic" || record.type === "knowledge-topic";
    const isSavedMatch = !state.savedOnly || (isIssue && state.savedIssueIds.has(record.sourceId));
    return isTopicMatch && isSportMatch && isTypeMatch && isYearMatch && isSearchMatch && isSavedMatch;
  });
}

function countKnowledgeTypes(records) {
  return records.reduce((counts, record) => {
    if (record.type === "research-article") counts.research += 1;
    else counts.editorial += 1;
    return counts;
  }, { editorial: 0, research: 0 });
}

function getActiveFilterLabels() {
  const labels = [];
  if (state.filters.query) {
    labels.push(`搜尋：${state.filters.query}`);
  }
  if (state.filters.type !== "all") {
    const typeLabels = {
      "monthly-topic": "月度深度議題",
      "podcast-episode": "English Podcast",
      "weekly-report": "每週整合週報",
      "knowledge-topic": "歷史知識議題",
      "research-article": "研究文章與題錄"
    };
    labels.push(typeLabels[state.filters.type] ?? state.filters.type);
  }
  if (state.filters.year !== "all") {
    labels.push(`${state.filters.year} 年`);
  }
  if (state.filters.topic !== "all") {
    const topic = state.content.topics.find((item) => item.id === state.filters.topic);
    labels.push(topic?.label ?? state.filters.topic);
  }
  if (state.filters.sport !== "all") {
    labels.push(state.filters.sport);
  }
  if (state.savedOnly) {
    labels.push("已收藏");
  }
  return labels;
}

function getSelectedIssue() {
  return getPublishedIssues().find((issue) => issue.id === state.selectedIssueId) ?? getPublishedIssues()[0];
}

function getTopicLabels(topicIds) {
  return topicIds
    .map((topicId) => state.content.topics.find((topic) => topic.id === topicId)?.label)
    .filter(Boolean);
}

function selectIssue(issueId, scrollToReading) {
  const issue = getPublishedIssues().find((candidate) => candidate.id === issueId);
  if (!issue) {
    return;
  }

  state.selectedIssueId = issueId;
  const url = new URL(window.location.href);
  url.searchParams.set("issue", issueId);
  window.history.replaceState({}, "", url);
  renderSelectedIssue();
  updateSavedControls();
  refreshIcons();

  if (scrollToReading) {
    document.querySelector("#reading").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function toggleSavedIssue(issueId) {
  if (!issueId) {
    return;
  }

  if (state.savedIssueIds.has(issueId)) {
    state.savedIssueIds.delete(issueId);
  } else {
    state.savedIssueIds.add(issueId);
  }

  saveIssueIds();
  renderIssueGrid();
  updateSavedControls();
  refreshIcons();
}

function updateSavedControls() {
  const selectedIssueIsSaved = state.savedIssueIds.has(state.selectedIssueId);
  const savedCount = state.savedIssueIds.size;
  elements.savedCount.textContent = String(savedCount);
  elements.savedToggle.setAttribute("aria-pressed", String(state.savedOnly));
  elements.savedToggle.title = state.savedOnly ? "顯示所有週刊" : "只顯示已收藏週刊";
  elements.savedToggle.setAttribute("aria-label", elements.savedToggle.title);

  for (const control of [elements.saveCurrent, elements.saveReading]) {
    control.setAttribute("aria-pressed", String(selectedIssueIsSaved));
  }

  elements.saveCurrent.title = selectedIssueIsSaved ? "取消收藏本期週刊" : "收藏本期週刊";
  elements.saveCurrent.setAttribute("aria-label", elements.saveCurrent.title);
  elements.saveReading.querySelector("span").textContent = selectedIssueIsSaved ? "取消收藏" : "收藏本篇";
}

function resolveInitialIssueId(publishedIssues) {
  const requestedIssueId = new URLSearchParams(window.location.search).get("issue");
  if (publishedIssues.some((issue) => issue.id === requestedIssueId)) {
    return requestedIssueId;
  }

  return publishedIssues[0]?.id ?? null;
}

function readSavedIssueIds() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SAVED_ISSUES_KEY) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function saveIssueIds() {
  window.localStorage.setItem(SAVED_ISSUES_KEY, JSON.stringify([...state.savedIssueIds]));
}

function renderTags(labels) {
  return labels.map((label) => `<span class="tag">${escapeHtml(label)}</span>`).join("");
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
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
  return String(value)
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
