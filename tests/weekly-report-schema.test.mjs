import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicReport, validateWeeklyReport } from "../scripts/lib/weekly-report-schema.mjs";

function makeReport() {
  return {
    schemaVersion: 1,
    id: "2026-w38",
    status: "draft",
    publishDate: "2026-09-19",
    weekLabel: "2026 年第 38 週",
    title: "本週運動科學新知整合",
    summary: "摘要",
    question: "這些新研究如何改變實務判斷？",
    evidenceStatement: "1 篇開放取用全文。",
    topicIds: ["monitoring"],
    sportTags: ["足球"],
    sourceRecordIds: ["pmid-1"],
    trend: { title: "趨勢", body: "趨勢說明" },
    articleDigests: [{
      recordId: "pmid-1",
      contentLevel: "full-text-open",
      headline: "重點",
      summary: "研究摘要",
      keyFindings: ["發現"],
      whatIsNew: "知識進展",
      inClassComparison: { matchStatus: "no-direct-match", sourceIds: [], summary: "無直接對照" },
      priorWeeklyComparison: { matchStatus: "no-direct-match", sourceIds: [], summary: "無直接對照" },
      practicalImplications: ["實務意涵"],
      cautions: ["限制"],
      evidenceTable: {
        title: "研究速覽",
        headers: ["面向", "內容"],
        rows: [["族群", "來源所述族群"]],
        sourceNote: "EDGE SPORT 原創整理"
      },
      visualization: null
    }],
    comparisonTable: {
      title: "知識進展",
      headers: ["焦點", "課程", "過往週報", "新研究"],
      rows: [["監測", "基礎", "尚無", "新增"]]
    },
    editorReview: { approvedForPublish: false, verifiedBy: "", verifiedAt: "" }
  };
}

test("accepts a source-bounded report with an original evidence table", () => {
  assert.deepEqual(validateWeeklyReport(makeReport()), []);
});

test("accepts a verified academic-web full-text report", () => {
  const report = makeReport();
  report.articleDigests[0].contentLevel = "full-text-web";
  assert.deepEqual(validateWeeklyReport(report), []);
});

test("rejects a full-text digest that only contains a reading placeholder", () => {
  const report = makeReport();
  report.articleDigests[0].contentLevel = "full-text-web";
  report.articleDigests[0].headline = "研究內容待全文核查";
  const errors = validateWeeklyReport(report, {
    sourceRecordIds: ["pmid-1"],
    contentLevelByRecord: new Map([["pmid-1", "full-text-web"]])
  });
  assert.ok(errors.some((error) => error.includes("placeholder")));
});

test("rejects a digest without its evidence table", () => {
  const report = makeReport();
  delete report.articleDigests[0].evidenceTable;
  assert.ok(validateWeeklyReport(report).some((error) => error.includes("evidenceTable")));
});

test("rejects malformed chart data", () => {
  const report = makeReport();
  report.articleDigests[0].visualization = {
    type: "bar",
    title: "比較",
    caption: "來源內直接比較",
    unit: "%",
    sourceNote: "EDGE SPORT 原創重繪",
    data: [{ label: "A", value: -1, detail: "錯誤值" }]
  };
  assert.ok(validateWeeklyReport(report).some((error) => error.includes("visualization")));
});

test("requires one digest for every selected source", () => {
  const report = makeReport();
  report.sourceRecordIds.push("pmid-2");

  const errors = validateWeeklyReport(report, {
    sourceRecordIds: ["pmid-1", "pmid-2"]
  });

  assert.ok(errors.some((error) => error.includes("articleDigests is missing pmid-2")));
});

test("builds a transparent Codex-automated public report", () => {
  const publicReport = buildPublicReport(makeReport(), {
    generatedAt: "2026-09-13T00:00:00.000Z",
    selectedArticles: [{
      record: {
        id: "pmid-1",
        title: "Study",
        journal: "Journal",
        publicationDate: "2026-09-12",
        sourceUrl: "https://doi.org/10.1000/example",
        fullTextUrl: null
      },
      sourceMaterial: { contentLevel: "full-text-open" }
    }],
    courseDocuments: [],
    priorIssues: []
  }, {
    publicationMode: "automated",
    automationProvider: "codex"
  });

  assert.equal(publicReport.status, "published");
  assert.equal(publicReport.publicationMode, "automated");
  assert.equal(publicReport.automationProvider, "codex");
  assert.equal(publicReport.editorReview.approvedForPublish, false);
});
