import test from "node:test";
import assert from "node:assert/strict";
import { buildKnowledgeIndex } from "../scripts/lib/knowledge-index.mjs";

const content = {
  topics: [{ id: "sports-medicine", label: "運動醫學" }],
  issues: [{
    id: "2026-m09",
    kind: "monthly-deep-dive",
    status: "published",
    publishDate: "2026-09-05",
    publishedAt: "2026-09-05T10:00:00.000Z",
    title: "肩關節負荷決策",
    summary: "整合球速與不穩定症狀。",
    readingMinutes: 18,
    topicIds: ["sports-medicine"],
    sportTags: ["棒球"],
    researchSourceIds: ["pmid-1"],
    courseConnectionsDetailed: [{ courseId: "course-1" }],
    priorReportConnections: [],
    editorReview: { approvedForPublish: false }
  }]
};

const weeklyReports = {
  reports: [{
    id: "2026-w36",
    status: "published",
    publishDate: "2026-09-04",
    title: "肩部監測週報",
    summary: "追蹤個人輸出趨勢。",
    question: "何時調整投球？",
    topicIds: ["sports-medicine"],
    sportTags: ["棒球"],
    sourceRecordIds: ["pmid-1"],
    researchSources: [{ recordId: "pmid-1" }],
    courseSources: [],
    priorWeeklySources: [],
    editorReview: { approvedForPublish: false }
  }]
};

const radar = {
  lastCollectedAt: "2026-09-06T10:00:00.000Z",
  items: [{
    id: "pmid-1",
    status: "discovered",
    journal: "Sports Journal",
    title: "Pitch velocity and shoulder symptoms",
    publicationDate: "2026-09-03",
    discoveredAt: "2026-09-06T10:00:00.000Z",
    pmid: "1",
    sourceUrl: "https://example.com/1",
    themes: ["運動醫學"],
    sportTags: ["棒球"]
  }]
};

const podcasts = {
  episodes: [{
    id: "2026-w36",
    status: "published",
    publishDate: "2026-09-04",
    publishedAt: "2026-09-04T12:00:00.000Z",
    title: "Read the shoulder trend",
    summary: "An English conversation about individual pitching trends.",
    durationSeconds: 720,
    sourceWeeklyReportId: "2026-w36",
    sourceRecordIds: ["pmid-1"],
    closingTakeaways: ["Track the trend"],
    transcript: [{ text: "Connect the change with symptoms and workload." }],
    editorReview: { approvedForPublish: false }
  }]
};

test("builds one cumulative record for every public issue, report, podcast and research item", () => {
  const index = buildKnowledgeIndex({ content, weeklyReports, radar, podcasts });
  assert.equal(index.stats.total, 4);
  assert.equal(index.stats.podcastEpisodes, 1);
  assert.deepEqual(index.records.map((record) => record.id).sort(), ["issue:2026-m09", "podcast:2026-w36", "report:2026-w36", "research:pmid-1"]);
  assert.equal(index.retentionPolicy.mode, "cumulative");
});

test("preserves deep searchable report text and research backlinks", () => {
  const index = buildKnowledgeIndex({ content, weeklyReports, radar, podcasts });
  const report = index.records.find((record) => record.id === "report:2026-w36");
  const podcast = index.records.find((record) => record.id === "podcast:2026-w36");
  const research = index.records.find((record) => record.id === "research:pmid-1");
  assert.match(report.searchText, /何時調整投球/u);
  assert.match(podcast.searchText, /symptoms and workload/u);
  assert.deepEqual(research.related.referencedBy.map((item) => `${item.type}:${item.id}`).sort(), ["monthly-topic:2026-m09", "podcast-episode:2026-w36", "weekly-report:2026-w36"]);
  assert.deepEqual(research.topicIds, ["sports-medicine"]);
});
