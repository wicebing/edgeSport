const PODCASTS_URL = "content/podcasts.json";

const state = {
  show: null,
  episodes: [],
  selectedId: new URLSearchParams(window.location.search).get("podcast")
};

const elements = {
  list: document.querySelector("#podcast-list"),
  detail: document.querySelector("#podcast-detail")
};

initializePodcasts().catch((error) => {
  console.error(error);
  elements.list.innerHTML = `<div class="podcast-empty"><h3>Podcast 暫時無法載入</h3><p>請確認 content/podcasts.json 與公開音檔已產生。</p></div>`;
});

async function initializePodcasts() {
  const response = await fetch(PODCASTS_URL);
  if (!response.ok) throw new Error(`Podcast request failed with ${response.status}.`);
  const payload = await response.json();
  state.show = payload.show;
  state.episodes = (payload.episodes ?? [])
    .filter((episode) => episode.status === "published")
    .sort((left, right) => right.publishDate.localeCompare(left.publishDate));
  if (!state.episodes.some((episode) => episode.id === state.selectedId)) state.selectedId = state.episodes[0]?.id ?? null;
  bindEvents();
  render();
}

function bindEvents() {
  elements.list.addEventListener("click", (event) => {
    const link = event.target.closest("[data-open-podcast]");
    if (!link) return;
    event.preventDefault();
    selectEpisode(link.dataset.openPodcast);
  });
  elements.detail.addEventListener("click", (event) => {
    const chapter = event.target.closest("[data-podcast-time]");
    if (!chapter) return;
    const audio = elements.detail.querySelector("audio");
    if (!audio) return;
    audio.currentTime = Number(chapter.dataset.podcastTime) || 0;
    audio.play().catch(() => {});
  });
}

function render() {
  if (!state.episodes.length) {
    elements.list.innerHTML = "";
    elements.detail.innerHTML = `
      <div class="podcast-empty">
        <p class="eyebrow eyebrow-dark">Ready for the first episode</p>
        <h3>週報完成後，再產生英文 Podcast</h3>
        <p>執行 <code>npm.cmd run podcast:run -- --id YYYY-wNN</code>，Codex 會撰寫對談稿，本機 TTS 會建立雙人音軌並加入網站。</p>
      </div>`;
    return;
  }
  elements.list.innerHTML = state.episodes.map(renderEpisodeCard).join("");
  elements.detail.innerHTML = renderEpisodeDetail(selectedEpisode());
  window.lucide?.createIcons({ attrs: { "aria-hidden": "true" } });
}

function renderEpisodeCard(episode) {
  const selected = episode.id === state.selectedId;
  return `
    <a class="podcast-card ${selected ? "is-selected" : ""}" href="?podcast=${escapeAttribute(episode.id)}#podcast" data-open-podcast="${escapeAttribute(episode.id)}" aria-current="${selected ? "true" : "false"}">
      <span>${escapeHtml(episode.id)} · ${escapeHtml(formatDate(episode.publishDate))}</span>
      <strong>${escapeHtml(episode.title)}</strong>
      <small>${escapeHtml(formatDuration(episode.durationSeconds))} · English dialogue · ${escapeHtml(String(episode.sourceRecordIds.length))} studies</small>
    </a>`;
}

function renderEpisodeDetail(episode) {
  const hostById = new Map(episode.hosts.map((host) => [host.id, host.displayName]));
  const speakerLabel = episode.hosts.map((host) => host.displayName).join(" + ");
  return `
    <header class="podcast-episode-header">
      <div>
        <p class="eyebrow eyebrow-dark">${escapeHtml(episode.showName)} · ${escapeHtml(episode.id)}</p>
        <h2>${escapeHtml(episode.title)}</h2>
        <p class="podcast-subtitle">${escapeHtml(episode.episodeSubtitle)}</p>
        <p>${escapeHtml(episode.summary)}</p>
      </div>
      <div class="podcast-duration"><strong>${escapeHtml(formatDuration(episode.durationSeconds))}</strong><span>${escapeHtml(String(episode.wordCount))} words</span></div>
    </header>
    <div class="podcast-player-shell">
      <div><i data-lucide="headphones"></i><span>${escapeHtml(speakerLabel)}</span></div>
      <audio controls preload="metadata" src="${safeMediaUrl(episode.audio.src)}">Your browser does not support HTML audio.</audio>
      <a href="${safeMediaUrl(episode.audio.src)}" download>Download MP3</a>
    </div>
    <div class="podcast-content-grid">
      <section>
        <p class="podcast-label">EPISODE CHAPTERS</p>
        <ol class="podcast-chapters">${episode.chapters.map((chapter) => `<li><button type="button" data-podcast-time="${escapeAttribute(String(chapter.startSeconds))}"><span>${escapeHtml(formatTime(chapter.startSeconds))}</span><strong>${escapeHtml(chapter.title)}</strong><small>${escapeHtml(chapter.summary)}</small></button></li>`).join("")}</ol>
      </section>
      <section>
        <p class="podcast-label">SHOW NOTES</p>
        <ul class="podcast-notes">${episode.showNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
        <a class="button button-secondary" href="?report=${encodeURIComponent(episode.sourceWeeklyReportId)}#weekly-reports">Read the full weekly report <i data-lucide="arrow-up-right"></i></a>
      </section>
    </div>
    <section class="podcast-takeaways"><p class="podcast-label">TAKE IT WITH YOU</p><div>${episode.closingTakeaways.map((item) => `<article>${escapeHtml(item)}</article>`).join("")}</div></section>
    <details class="podcast-transcript">
      <summary>English transcript with timestamps</summary>
      <div>${episode.transcript.map((turn) => `<p><button type="button" data-podcast-time="${escapeAttribute(String(turn.startSeconds))}">${escapeHtml(formatTime(turn.startSeconds))}</button><strong>${escapeHtml(hostById.get(turn.speaker) ?? turn.speaker)}</strong><span>${escapeHtml(turn.text)}</span></p>`).join("")}</div>
    </details>
    <section class="podcast-sources">
      <p class="podcast-label">RESEARCH DISCUSSED</p>
      <ol>${episode.researchSources.map((source) => `<li><span>${escapeHtml(source.journal)} · ${escapeHtml(source.publicationDate)}</span><a href="${safeUrl(source.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a></li>`).join("")}</ol>
    </section>
    <p class="podcast-disclosure"><strong>Synthetic voice disclosure:</strong> ${escapeHtml(episode.disclosure)}</p>`;
}

function selectEpisode(id) {
  if (!state.episodes.some((episode) => episode.id === id)) return;
  state.selectedId = id;
  const url = new URL(window.location.href);
  url.searchParams.set("podcast", id);
  url.hash = "podcast";
  window.history.replaceState({}, "", url);
  render();
  document.querySelector("#podcast").scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectedEpisode() {
  return state.episodes.find((episode) => episode.id === state.selectedId) ?? state.episodes[0];
}

function formatDuration(seconds) {
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function safeMediaUrl(value) {
  return /^assets\/podcasts\/\d{4}-w\d{2}(?:-[a-f0-9]{12})?\.mp3$/u.test(value ?? "") ? value : "";
}

function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : "#"; } catch { return "#"; }
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
