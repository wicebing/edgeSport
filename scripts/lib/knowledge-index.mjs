const TYPE_ORDER = new Map([
  ["monthly-topic", 0],
  ["podcast-episode", 1],
  ["weekly-report", 2],
  ["knowledge-topic", 3],
  ["research-article", 4]
]);

export function buildKnowledgeIndex({ content, weeklyReports, radar, podcasts = { episodes: [] } }) {
  const topics = content.topics ?? [];
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const topicIdByLabel = new Map(topics.map((topic) => [normalise(topic.label), topic.id]));
  const referencesByResearchId = buildResearchBacklinks(content.issues ?? [], weeklyReports.reports ?? [], podcasts.episodes ?? []);

  const issueRecords = (content.issues ?? [])
    .filter((issue) => issue.status === "published")
    .map((issue) => buildIssueRecord(issue, topicById));
  const reportRecords = (weeklyReports.reports ?? [])
    .filter((report) => report.status === "published")
    .map((report) => buildReportRecord(report, topicById));
  const podcastRecords = (podcasts.episodes ?? [])
    .filter((episode) => episode.status === "published")
    .map((episode) => buildPodcastRecord(episode, weeklyReports.reports ?? [], topicById));
  const researchRecords = (radar.items ?? []).map((item) =>
    buildResearchRecord(item, topicIdByLabel, topicById, referencesByResearchId.get(item.id) ?? [])
  );
  const records = [...issueRecords, ...podcastRecords, ...reportRecords, ...researchRecords]
    .sort((left, right) => right.publishDate.localeCompare(left.publishDate)
      || (TYPE_ORDER.get(left.type) ?? 99) - (TYPE_ORDER.get(right.type) ?? 99)
      || left.title.localeCompare(right.title, "zh-Hant"));

  return {
    schemaVersion: 1,
    generatedAt: latestTimestamp([
      radar.lastCollectedAt,
      ...issueRecords.map((record) => record.updatedAt),
      ...reportRecords.map((record) => record.updatedAt),
      ...podcastRecords.map((record) => record.updatedAt)
    ]),
    retentionPolicy: {
      mode: "cumulative",
      statement: "Published issues, weekly reports, podcast episodes and harvested research metadata remain indexed. Existing IDs may be revised in place, but are not removed by routine generation.",
      privateMaterial: "Licensed full text, source captures and private Codex packets remain in the local research-library and are not deployed to GitHub Pages."
    },
    stats: {
      total: records.length,
      monthlyTopics: issueRecords.filter((record) => record.type === "monthly-topic").length,
      knowledgeTopics: issueRecords.filter((record) => record.type === "knowledge-topic").length,
      podcastEpisodes: podcastRecords.length,
      weeklyReports: reportRecords.length,
      researchArticles: researchRecords.length,
      reviewedArticles: researchRecords.filter((record) => record.reviewed).length,
      years: [...new Set(records.map((record) => record.year))].sort((left, right) => right.localeCompare(left))
    },
    records
  };
}

function buildPodcastRecord(episode, reports, topicById) {
  const report = reports.find((item) => item.id === episode.sourceWeeklyReportId);
  const topicIds = report?.topicIds ?? [];
  const topicLabels = labelsForIds(topicIds, topicById);
  const sportTags = report?.sportTags ?? [];
  return baseRecord({
    id: `podcast:${episode.id}`,
    sourceId: episode.id,
    type: "podcast-episode",
    typeLabel: "English Podcast",
    publishDate: episode.publishDate,
    updatedAt: episode.publishedAt ?? episode.renderedAt ?? episode.publishDate,
    title: episode.title,
    summary: episode.summary,
    topicIds,
    topicLabels,
    sportTags,
    tags: [...topicLabels, ...sportTags, "Podcast", "English"],
    href: `?podcast=${encodeURIComponent(episode.id)}#podcast`,
    detail: `${formatDuration(episode.durationSeconds)} · ${(episode.sourceRecordIds ?? []).length} 篇研究`,
    reviewed: episode.editorReview?.approvedForPublish === true,
    related: {
      researchIds: uniqueStrings(episode.sourceRecordIds),
      courseIds: uniqueStrings((report?.courseSources ?? []).map((source) => source.id)),
      priorIds: [episode.sourceWeeklyReportId],
      referencedBy: []
    },
    source: episode
  });
}

function buildIssueRecord(issue, topicById) {
  const isMonthly = issue.kind === "monthly-deep-dive";
  const topicLabels = labelsForIds(issue.topicIds, topicById);
  const researchIds = uniqueStrings([
    ...(issue.researchSourceIds ?? []),
    ...(issue.evidence ?? []).map((source) => source.sourceId)
  ]);
  return baseRecord({
    id: `issue:${issue.id}`,
    sourceId: issue.id,
    type: isMonthly ? "monthly-topic" : "knowledge-topic",
    typeLabel: isMonthly ? "月度深度議題" : "歷史知識議題",
    publishDate: issue.publishDate,
    updatedAt: issue.publishedAt ?? issue.generatedAt ?? issue.publishDate,
    title: issue.title,
    summary: issue.summary,
    topicIds: issue.topicIds ?? [],
    topicLabels,
    sportTags: issue.sportTags ?? [],
    tags: [...topicLabels, ...(issue.sportTags ?? [])],
    href: `?issue=${encodeURIComponent(issue.id)}#reading`,
    detail: `${issue.readingMinutes ?? "--"} min read · ${researchIds.length} 個研究來源`,
    reviewed: issue.editorReview?.approvedForPublish === true,
    related: {
      researchIds,
      courseIds: uniqueStrings((issue.courseConnectionsDetailed ?? []).map((item) => item.courseId)),
      priorIds: uniqueStrings((issue.priorReportConnections ?? []).map((item) => item.reportId)),
      referencedBy: []
    },
    source: issue
  });
}

function buildReportRecord(report, topicById) {
  const topicLabels = labelsForIds(report.topicIds, topicById);
  const researchIds = uniqueStrings([
    ...(report.sourceRecordIds ?? []),
    ...(report.researchSources ?? []).map((source) => source.recordId)
  ]);
  return baseRecord({
    id: `report:${report.id}`,
    sourceId: report.id,
    type: "weekly-report",
    typeLabel: "每週整合週報",
    publishDate: report.publishDate,
    updatedAt: report.publishedAt ?? report.generatedAt ?? report.publishDate,
    title: report.title,
    summary: report.summary,
    topicIds: report.topicIds ?? [],
    topicLabels,
    sportTags: report.sportTags ?? [],
    tags: [...topicLabels, ...(report.sportTags ?? [])],
    href: `?report=${encodeURIComponent(report.id)}#weekly-reports`,
    detail: `${researchIds.length} 篇完整研究 · ${(report.courseSources ?? []).length} 份 inClass 對照`,
    reviewed: report.editorReview?.approvedForPublish === true,
    related: {
      researchIds,
      courseIds: uniqueStrings((report.courseSources ?? []).map((source) => source.id)),
      priorIds: uniqueStrings((report.priorWeeklySources ?? []).map((source) => source.id)),
      referencedBy: []
    },
    source: report
  });
}

function buildResearchRecord(item, topicIdByLabel, topicById, referencedBy) {
  const topicIds = uniqueStrings((item.themes ?? []).map((label) => topicIdByLabel.get(normalise(label))).filter(Boolean));
  const topicLabels = labelsForIds(topicIds, topicById);
  const reviewed = item.status === "reviewed" || item.status === "featured";
  const identifier = item.pmid ? `PMID ${item.pmid}` : item.doi ? `DOI ${item.doi}` : "官方來源";
  return baseRecord({
    id: `research:${item.id}`,
    sourceId: item.id,
    type: "research-article",
    typeLabel: reviewed ? "已整理研究" : "研究題錄",
    publishDate: item.publicationDate,
    updatedAt: item.review?.reviewedAt ?? item.discoveredAt ?? item.publicationDate,
    title: item.title,
    summary: item.review?.summary ?? `${item.journal}收錄的研究題錄；完成全文整理前僅作為可回查的研究訊號。`,
    topicIds,
    topicLabels,
    sportTags: item.sportTags ?? [],
    tags: [...(item.themes ?? []), ...(item.sportTags ?? [])],
    href: `?radar=${encodeURIComponent(item.id)}#research-radar`,
    sourceUrl: item.sourceUrl,
    journal: item.journal,
    detail: `${item.journal} · ${identifier}${referencedBy.length ? ` · 被 ${referencedBy.length} 份整理引用` : ""}`,
    reviewed,
    related: {
      researchIds: [],
      courseIds: [],
      priorIds: [],
      referencedBy
    },
    source: item
  });
}

function baseRecord(record) {
  return {
    id: record.id,
    sourceId: record.sourceId,
    type: record.type,
    typeLabel: record.typeLabel,
    publishDate: record.publishDate,
    updatedAt: record.updatedAt,
    year: String(record.publishDate ?? "").slice(0, 4),
    title: record.title,
    summary: record.summary,
    topicIds: uniqueStrings(record.topicIds),
    topicLabels: uniqueStrings(record.topicLabels),
    sportTags: uniqueStrings(record.sportTags),
    tags: uniqueStrings(record.tags),
    href: record.href,
    sourceUrl: record.sourceUrl ?? null,
    journal: record.journal ?? null,
    detail: record.detail,
    reviewed: record.reviewed,
    related: record.related,
    searchText: collectSearchText(record.source, [record.typeLabel, ...record.tags, ...record.topicLabels])
  };
}

function buildResearchBacklinks(issues, reports, podcasts) {
  const links = new Map();
  for (const issue of issues.filter((item) => item.status === "published")) {
    const ids = uniqueStrings([...(issue.researchSourceIds ?? []), ...(issue.evidence ?? []).map((source) => source.sourceId)]);
    for (const id of ids) addBacklink(links, id, { id: issue.id, type: issue.kind === "monthly-deep-dive" ? "monthly-topic" : "knowledge-topic", title: issue.title, href: `?issue=${encodeURIComponent(issue.id)}#reading` });
  }
  for (const report of reports.filter((item) => item.status === "published")) {
    const ids = uniqueStrings([...(report.sourceRecordIds ?? []), ...(report.researchSources ?? []).map((source) => source.recordId)]);
    for (const id of ids) addBacklink(links, id, { id: report.id, type: "weekly-report", title: report.title, href: `?report=${encodeURIComponent(report.id)}#weekly-reports` });
  }
  for (const episode of podcasts.filter((item) => item.status === "published")) {
    for (const id of uniqueStrings(episode.sourceRecordIds)) addBacklink(links, id, { id: episode.id, type: "podcast-episode", title: episode.title, href: `?podcast=${encodeURIComponent(episode.id)}#podcast` });
  }
  return links;
}

function addBacklink(map, researchId, value) {
  if (!researchId) return;
  const items = map.get(researchId) ?? [];
  if (!items.some((item) => item.id === value.id && item.type === value.type)) items.push(value);
  map.set(researchId, items);
}

function labelsForIds(ids = [], topicById) {
  return uniqueStrings(ids.map((id) => topicById.get(id)?.label).filter(Boolean));
}

function collectSearchText(value, seed = []) {
  const strings = [...seed];
  visit(value, strings);
  return uniqueStrings(strings.map((item) => String(item).trim()).filter((item) => item.length > 1)).join(" \n");
}

function visit(value, output) {
  if (typeof value === "string") {
    if (!/^https?:\/\//iu.test(value)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visit(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["coverImage", "visualization"].includes(key)) continue;
    visit(child, output);
  }
}

function latestTimestamp(values) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function normalise(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-Hant");
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(Number(seconds ?? 0) / 60));
  return `${minutes} min listen`;
}
