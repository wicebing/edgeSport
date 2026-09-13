const CONTENT_URL = "content/issues.json";
const SOURCE_REGISTRY_URL = "content/source-registry.json";
const SAVED_ISSUES_KEY = "edge-sport-saved-issues";
const CARD_ACCENTS = ["#e96a4a", "#2a8ab0", "#b8d94d", "#14362f"];

const state = {
  content: null,
  sourceRegistry: null,
  selectedIssueId: null,
  savedIssueIds: new Set(readSavedIssueIds()),
  savedOnly: false,
  filters: {
    query: "",
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
  topicFilter: document.querySelector("#topic-filter"),
  sportFilter: document.querySelector("#sport-filter"),
  clearFilters: document.querySelector("#clear-filters"),
  activeFilters: document.querySelector("#active-filters"),
  resultCount: document.querySelector("#result-count"),
  issueGrid: document.querySelector("#issue-grid"),
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
  const [contentResponse, sourceRegistryResponse] = await Promise.all([
    fetch(CONTENT_URL),
    fetch(SOURCE_REGISTRY_URL)
  ]);

  if (!contentResponse.ok) {
    throw new Error(`Content request failed with ${contentResponse.status}.`);
  }

  state.content = await contentResponse.json();
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
    renderIssueGrid();
  });

  elements.topicFilter.addEventListener("change", (event) => {
    state.filters.topic = event.target.value;
    renderIssueGrid();
  });

  elements.sportFilter.addEventListener("change", (event) => {
    state.filters.sport = event.target.value;
    renderIssueGrid();
  });

  elements.clearFilters.addEventListener("click", () => {
    state.filters = { query: "", topic: "all", sport: "all" };
    state.savedOnly = false;
    elements.searchInput.value = "";
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
  elements.heroWeek.textContent = `${issue.weekLabel} / ${formatDate(issue.publishDate)}`;
  elements.heroTitle.textContent = issue.title;
  elements.heroSummary.textContent = issue.summary;
  elements.heroTags.innerHTML = renderTags([...topics, ...issue.sportTags]);

  elements.readingWeek.textContent = `${issue.weekLabel} / ${issue.readingMinutes} min read`;
  elements.readingTopicList.innerHTML = renderTags(topics);
  elements.issueDetail.innerHTML = renderIssueDetail(issue, topics);
  document.title = `${issue.title} | EDGE SPORT`;
}

function renderIssueGrid() {
  const matchingIssues = getFilteredIssues();
  const filters = getActiveFilterLabels();
  elements.resultCount.textContent = state.savedOnly
    ? `已收藏 ${matchingIssues.length} 份週刊`
    : `找到 ${matchingIssues.length} 份週刊`;
  elements.activeFilters.innerHTML = filters.map((filter) => `<span class="filter-token">${escapeHtml(filter)}</span>`).join("");

  if (matchingIssues.length === 0) {
    elements.issueGrid.innerHTML = `
      <div class="empty-state">
        <h3>沒有符合的週刊</h3>
        <p>調整關鍵詞或清除篩選條件後再試一次。</p>
      </div>`;
    refreshIcons();
    return;
  }

  elements.issueGrid.innerHTML = matchingIssues.map((issue, index) => renderIssueCard(issue, index)).join("");
  updateSavedControls();
  refreshIcons();
}

function renderIssueCard(issue, index) {
  const isSaved = state.savedIssueIds.has(issue.id);
  const topics = getTopicLabels(issue.topicIds).slice(0, 2);
  const isSelected = issue.id === state.selectedIssueId;
  const accent = CARD_ACCENTS[index % CARD_ACCENTS.length];

  return `
    <article class="issue-card" style="--card-accent: ${accent}">
      <div class="issue-card-inner">
        <a class="issue-card-open" href="?issue=${escapeAttribute(issue.id)}#reading" data-open-issue="${escapeAttribute(issue.id)}" aria-current="${isSelected ? "true" : "false"}">
          <span class="card-meta">${escapeHtml(issue.weekLabel)} / ${escapeHtml(formatDate(issue.publishDate))}</span>
          <h3>${escapeHtml(issue.title)}</h3>
          <p>${escapeHtml(issue.summary)}</p>
          <div class="tag-list">${renderTags(topics)}</div>
        </a>
        <div class="card-footer">
          <span class="card-reading-time">${escapeHtml(String(issue.readingMinutes))} min read</span>
          <button
            class="icon-button save-card"
            type="button"
            data-save-issue="${escapeAttribute(issue.id)}"
            title="${isSaved ? "取消收藏" : "收藏週刊"}"
            aria-label="${isSaved ? "取消收藏" : `收藏：${escapeAttribute(issue.title)}`}"
            aria-pressed="${isSaved}"
          >
            <i data-lucide="bookmark"></i>
          </button>
        </div>
      </div>
    </article>`;
}

function renderIssueDetail(issue, topics) {
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

function renderFilterOptions() {
  const topicOptions = state.content.topics
    .map((topic) => `<option value="${escapeAttribute(topic.id)}">${escapeHtml(topic.label)}</option>`)
    .join("");
  elements.topicFilter.insertAdjacentHTML("beforeend", topicOptions);

  const sports = [...new Set(getPublishedIssues().flatMap((issue) => issue.sportTags))].sort((left, right) => left.localeCompare(right, "zh-Hant"));
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

function getFilteredIssues() {
  const normalizedQuery = state.filters.query.toLocaleLowerCase("zh-Hant");
  return getPublishedIssues().filter((issue) => {
    const isTopicMatch = state.filters.topic === "all" || issue.topicIds.includes(state.filters.topic);
    const isSportMatch = state.filters.sport === "all" || issue.sportTags.includes(state.filters.sport);
    const searchableText = [
      issue.title,
      issue.summary,
      issue.question,
      issue.evidenceLens,
      ...issue.sportTags,
      ...getTopicLabels(issue.topicIds),
      ...issue.takeaways.flatMap((takeaway) => [takeaway.title, takeaway.body]),
      ...issue.metrics.flatMap((metric) => [metric.name, metric.why, metric.practice])
    ].join(" ").toLocaleLowerCase("zh-Hant");
    const isSearchMatch = !normalizedQuery || searchableText.includes(normalizedQuery);
    const isSavedMatch = !state.savedOnly || state.savedIssueIds.has(issue.id);
    return isTopicMatch && isSportMatch && isSearchMatch && isSavedMatch;
  });
}

function getActiveFilterLabels() {
  const labels = [];
  if (state.filters.query) {
    labels.push(`搜尋：${state.filters.query}`);
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
