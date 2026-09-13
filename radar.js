const RADAR_URL = "content/research-radar.json";
const INITIAL_VISIBLE_ITEMS = 12;
const STATUS_DETAILS = {
  discovered: { label: "待全文審閱", className: "is-discovered" },
  reviewed: { label: "已全文審閱", className: "is-reviewed" },
  featured: { label: "已整合週刊", className: "is-featured" }
};

const state = {
  radar: null,
  filters: {
    query: "",
    status: "all",
    source: "all"
  },
  visibleItems: INITIAL_VISIBLE_ITEMS,
  sharedItemId: new URLSearchParams(window.location.search).get("radar")
};

const elements = {
  filterForm: document.querySelector("#radar-filter-form"),
  searchInput: document.querySelector("#radar-search-input"),
  statusFilter: document.querySelector("#radar-status-filter"),
  sourceFilter: document.querySelector("#radar-source-filter"),
  clearFilters: document.querySelector("#clear-radar-filters"),
  period: document.querySelector("#radar-period"),
  collectionTime: document.querySelector("#radar-collection-time"),
  sourceStatus: document.querySelector("#radar-source-status"),
  trendList: document.querySelector("#radar-trend-list"),
  resultCount: document.querySelector("#radar-result-count"),
  grid: document.querySelector("#radar-grid"),
  showMore: document.querySelector("#show-more-radar"),
  shareToast: document.querySelector("#share-toast")
};

let toastTimer;

initializeRadar().catch((error) => {
  console.error(error);
  elements.grid.innerHTML = `
    <div class="empty-state">
      <h3>研究雷達暫時無法載入</h3>
      <p>請確認 content/research-radar.json 已由每週蒐集流程產生。</p>
    </div>`;
});

async function initializeRadar() {
  const response = await fetch(RADAR_URL);
  if (!response.ok) {
    throw new Error(`Research radar request failed with ${response.status}.`);
  }

  state.radar = await response.json();
  renderSourceOptions();
  bindEvents();
  renderRadar();
}

function bindEvents() {
  elements.filterForm.addEventListener("submit", (event) => event.preventDefault());

  elements.searchInput.addEventListener("input", (event) => {
    state.filters.query = event.target.value.trim();
    state.visibleItems = INITIAL_VISIBLE_ITEMS;
    renderRadarItems();
  });

  elements.statusFilter.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    state.visibleItems = INITIAL_VISIBLE_ITEMS;
    renderRadarItems();
  });

  elements.sourceFilter.addEventListener("change", (event) => {
    state.filters.source = event.target.value;
    state.visibleItems = INITIAL_VISIBLE_ITEMS;
    renderRadarItems();
  });

  elements.clearFilters.addEventListener("click", () => {
    state.filters = { query: "", status: "all", source: "all" };
    state.visibleItems = INITIAL_VISIBLE_ITEMS;
    elements.searchInput.value = "";
    elements.statusFilter.value = "all";
    elements.sourceFilter.value = "all";
    renderRadarItems();
  });

  elements.grid.addEventListener("click", (event) => {
    const shareButton = event.target.closest("[data-share-radar]");
    if (shareButton) {
      shareRadarItem(shareButton.dataset.shareRadar);
    }
  });

  elements.showMore.addEventListener("click", () => {
    state.visibleItems += INITIAL_VISIBLE_ITEMS;
    renderRadarItems();
  });
}

function renderRadar() {
  renderRadarSummary();
  renderTrendSignals();
  renderRadarItems();
  refreshIcons();
}

function renderRadarSummary() {
  const coverage = state.radar.coverage;
  elements.period.textContent = coverage?.from && coverage?.to
    ? `${formatDate(coverage.from)} - ${formatDate(coverage.to)}`
    : "尚未執行蒐集";
  elements.collectionTime.textContent = state.radar.lastCollectedAt
    ? `最後擷取：${formatDateTime(state.radar.lastCollectedAt)}`
    : "等待第一次蒐集";
  elements.sourceStatus.innerHTML = (state.radar.sourceStatus ?? []).map((source) => `
    <span class="source-status ${source.status === "error" ? "is-error" : ""}" title="${escapeAttribute(source.detail ?? "")}">
      ${escapeHtml(source.label)} ${escapeHtml(String(source.itemCount ?? 0))}
    </span>`).join("");
}

function renderTrendSignals() {
  const signals = state.radar.trendSignals ?? [];
  if (signals.length === 0) {
    elements.trendList.innerHTML = `<p class="radar-status-copy">尚無足夠題錄可產生本週趨勢訊號。</p>`;
    return;
  }

  const maximum = Math.max(...signals.map((signal) => signal.count), 1);
  elements.trendList.innerHTML = signals.map((signal) => `
    <div class="radar-trend-row" title="${escapeAttribute(signal.basis)}">
      <span>${escapeHtml(signal.label)}</span>
      <div class="trend-track" aria-hidden="true"><span class="trend-fill" style="--bar-width: ${Math.max(7, (signal.count / maximum) * 100)}%"></span></div>
      <strong>${escapeHtml(String(signal.count))}</strong>
    </div>`).join("");
}

function renderSourceOptions() {
  const sources = new Map();
  for (const item of state.radar.items ?? []) {
    if (item.sourceId && item.journal) {
      sources.set(item.sourceId, item.journal);
    }
  }

  const options = [...sources.entries()]
    .sort((left, right) => left[1].localeCompare(right[1], "en"))
    .map(([sourceId, label]) => `<option value="${escapeAttribute(sourceId)}">${escapeHtml(label)}</option>`)
    .join("");
  elements.sourceFilter.insertAdjacentHTML("beforeend", options);
}

function renderRadarItems() {
  const filteredItems = getFilteredRadarItems();
  const sharedItemIndex = filteredItems.findIndex((item) => item.id === state.sharedItemId);
  if (sharedItemIndex >= state.visibleItems) {
    state.visibleItems = sharedItemIndex + 1;
  }
  const visibleItems = filteredItems.slice(0, state.visibleItems);
  const reviewedCount = filteredItems.filter(isReviewed).length;
  elements.resultCount.textContent = `顯示 ${visibleItems.length} / ${filteredItems.length} 筆題錄；其中 ${reviewedCount} 筆已完成全文審閱`;
  elements.showMore.hidden = filteredItems.length <= visibleItems.length;

  if (visibleItems.length === 0) {
    elements.grid.innerHTML = `
      <div class="empty-state">
        <h3>沒有符合的文獻</h3>
        <p>調整關鍵詞或篩選條件後再試一次。</p>
      </div>`;
    return;
  }

  elements.grid.innerHTML = visibleItems.map(renderRadarItem).join("");
  refreshIcons();
  focusSharedItem();
}

function renderRadarItem(item) {
  const status = STATUS_DETAILS[item.status] ?? STATUS_DETAILS.discovered;
  const itemClass = item.status === "featured" ? "is-featured" : isReviewed(item) ? "is-reviewed" : "";
  const authorLine = item.authors?.length ? item.authors.join(", ") : "作者資料待確認";
  const identifierLine = item.pmid ? `PMID ${item.pmid}` : item.doi ? `DOI ${item.doi}` : "Official update";
  const labels = [...new Set([...(item.themes ?? []), ...(item.sportTags ?? [])])];
  const themeMarkup = labels.length ? renderTags(labels) : "<span class=\"tag\">尚未分類</span>";

  return `
    <article id="radar-${escapeAttribute(item.id)}" class="radar-item ${itemClass}">
      <div class="radar-item-header">
        <p class="radar-journal">${escapeHtml(item.journal)}</p>
        <span class="review-badge ${status.className}">${escapeHtml(status.label)}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="radar-authors">${escapeHtml(authorLine)}</p>
      <p class="radar-meta">${escapeHtml(formatPublicationDate(item.publicationDate))}${item.contentKind ? ` / ${escapeHtml(item.contentKind)}` : ""} / ${escapeHtml(identifierLine)}</p>
      <div class="tag-list radar-themes">${themeMarkup}</div>
      ${isReviewed(item) ? renderReviewedEvidence(item) : `
        <p class="radar-hold-note">這是新題錄，不以題名或摘要替代全文判讀。完成本機全文審閱前，不會顯示實務結論、表格或圖表。</p>`}
      <div class="radar-actions">
        <a class="button button-secondary" href="${safeUrl(item.sourceUrl)}" target="_blank" rel="noreferrer">
          官方來源
          <i data-lucide="external-link"></i>
        </a>
        ${item.fullTextUrl ? `
          <a class="icon-button radar-share-button" href="${safeUrl(item.fullTextUrl)}" target="_blank" rel="noreferrer" title="開啟 PMC 記錄" aria-label="開啟 PMC 記錄：${escapeAttribute(item.title)}">
            <i data-lucide="book-open"></i>
          </a>` : ""}
        <button class="icon-button radar-share-button" type="button" data-share-radar="${escapeAttribute(item.id)}" title="分享這筆文獻" aria-label="分享：${escapeAttribute(item.title)}">
          <i data-lucide="share-2"></i>
        </button>
      </div>
    </article>`;
}

function renderReviewedEvidence(item) {
  const review = item.review;
  const context = [review.studyDesign, review.population, review.setting].filter(Boolean).join(" / ");

  return `
    <div class="radar-review">
      <div>
        <p class="review-summary">${escapeHtml(review.summary)}</p>
        <p class="review-context"><strong>研究脈絡：</strong>${escapeHtml(context)}</p>
        <ul class="review-findings">${review.keyFindings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul>
        <ul class="review-limitations"><li><strong>限制：</strong>${escapeHtml(review.limitations.join("；"))}</li></ul>
      </div>
      <div class="review-right">
        ${renderSynthesisTable(item.synthesisTable)}
        ${renderVisualization(item.visualization)}
      </div>
    </div>`;
}

function renderSynthesisTable(table) {
  return `
    <div>
      <div class="synthesis-table-wrap">
        <table class="synthesis-table">
          <caption>${escapeHtml(table.title)}</caption>
          <thead><tr>${table.headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
      <p class="synthesis-source-note">原創整理表：${escapeHtml(table.sourceNote)}</p>
    </div>`;
}

function renderVisualization(visualization) {
  const maximum = Math.max(...visualization.data.map((datum) => datum.value), 1);
  return `
    <figure class="evidence-chart">
      <h4>${escapeHtml(visualization.title)}</h4>
      <figcaption>${escapeHtml(visualization.caption)}</figcaption>
      <div class="chart-list">
        ${visualization.data.map((datum) => `
          <div class="chart-row">
            <span class="chart-label">${escapeHtml(datum.label)}</span>
            <div class="chart-track" aria-hidden="true"><span class="chart-fill" style="--bar-width: ${Math.max(4, (datum.value / maximum) * 100)}%"></span></div>
            <strong class="chart-value">${escapeHtml(String(datum.value))} ${escapeHtml(visualization.unit)}</strong>
            <p class="chart-detail">${escapeHtml(datum.detail)}</p>
          </div>`).join("")}
      </div>
      <p class="visualization-source-note">原創資料視覺化：${escapeHtml(visualization.sourceNote)}</p>
    </figure>`;
}

function getFilteredRadarItems() {
  const normalizedQuery = state.filters.query.toLocaleLowerCase("en");
  return [...(state.radar.items ?? [])]
    .filter((item) => {
      const matchesStatus = state.filters.status === "all"
        || (state.filters.status === "needs-review" && item.status === "discovered")
        || (state.filters.status === "reviewed" && isReviewed(item));
      const matchesSource = state.filters.source === "all" || item.sourceId === state.filters.source;
      const searchableText = [item.title, item.journal, ...(item.authors ?? []), ...(item.themes ?? []), ...(item.sportTags ?? [])]
        .join(" ")
        .toLocaleLowerCase("en");
      return matchesStatus && matchesSource && (!normalizedQuery || searchableText.includes(normalizedQuery));
    })
    .sort((left, right) => dateSortValue(right) - dateSortValue(left));
}

async function shareRadarItem(itemId) {
  const item = state.radar.items?.find((candidate) => candidate.id === itemId);
  if (!item) {
    return;
  }

  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set("radar", item.id);
  shareUrl.hash = "research-radar";
  const shareData = {
    title: `${item.title} | EDGE SPORT`,
    text: `${item.journal}: ${item.title}`,
    url: shareUrl.href
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      showToast("分享面板已開啟。");
      return;
    }

    await copyText(shareUrl.href);
    showToast("分享連結已複製。");
  } catch (error) {
    if (error?.name !== "AbortError") {
      showToast("無法自動複製連結，請從網址列分享。");
    }
  }
}

function focusSharedItem() {
  if (!state.sharedItemId) {
    return;
  }

  const sharedItem = document.querySelector(`#radar-${cssEscape(state.sharedItemId)}`);
  if (!sharedItem) {
    return;
  }

  state.sharedItemId = null;
  requestAnimationFrame(() => sharedItem.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function isReviewed(item) {
  return item.status === "reviewed" || item.status === "featured";
}

function dateSortValue(item) {
  const candidate = item.discoveredAt ?? item.publicationDate;
  const parsedDate = Date.parse(candidate);
  return Number.isNaN(parsedDate) ? 0 : parsedDate;
}

function formatDate(value) {
  const parsedDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsedDate.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-Hant-TW", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(parsedDate);
}

function formatPublicationDate(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-Hant-TW", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(parsedDate);
}

function formatDateTime(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-Hant-TW", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(parsedDate);
}

function renderTags(labels) {
  return labels.map((label) => `<span class="tag">${escapeHtml(label)}</span>`).join("");
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

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showToast(message) {
  elements.shareToast.textContent = message;
  elements.shareToast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.shareToast.classList.remove("is-visible"), 3200);
}

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
}
