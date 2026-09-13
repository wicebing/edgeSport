import test from "node:test";
import assert from "node:assert/strict";
import { buildPublicReport, validateWeeklyReport } from "../scripts/lib/weekly-report-schema.mjs";

function makeReport() {
  const report = {
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

  report.researchLandscape = {
    title: "本週研究地圖",
    overview: "本週研究聚焦監測與訓練決策。",
    themes: [{
      name: "訓練監測",
      articleIds: ["pmid-1"],
      signal: "研究提供可追蹤的負荷訊號。",
      evidenceStrength: "moderate"
    }],
    keyNumbers: [{
      value: "12%",
      label: "主要結果",
      context: "研究族群於指定追蹤時間的結果。",
      sourceRecordId: "pmid-1"
    }]
  };
  report.knowledgePrimer = {
    title: "背景與操作定義",
    overview: "先界定概念，再決定如何量測與應用。",
    definitions: [{
      term: "訓練負荷",
      definition: "訓練刺激的外部與內部劑量。",
      operationalMeaning: "同步記錄訓練量與運動員反應。",
      basis: "source-stated"
    }, {
      term: "反應監測",
      definition: "追蹤訓練後的表現與症狀變化。",
      operationalMeaning: "比較個人基線與連續趨勢。",
      basis: "cross-source-synthesis"
    }],
    mechanisms: [{
      title: "刺激—反應",
      explanation: "相同外部負荷可能產生不同的個體反應。",
      practicalMeaning: "進階決策需同時參考完成量、症狀與表現。",
      sourceRecordIds: ["pmid-1"]
    }]
  };
  report.articleDigests[0].studyProfile = {
    design: "前瞻性觀察研究",
    population: "成人運動員",
    interventionOrExposure: "例行訓練負荷",
    comparator: "個人基線",
    outcomes: "表現與症狀",
    followUp: "四週"
  };
  report.articleDigests[0].quantitativeResults = [{
    measure: "主要結果",
    result: "改善 12%",
    context: "研究族群於四週追蹤",
    sourceLocation: "Results"
  }];
  report.practiceGuide = {
    title: "監測到行動的實務方案",
    scope: "用於日常訓練負荷調整，不取代醫療診斷。",
    targetPopulation: "進行規律訓練的成人運動員",
    goal: "以個人基線與連續趨勢支持進階或退階決策。",
    assessmentBattery: {
      title: "最低可行評估組合",
      headers: ["領域", "工具"],
      rows: [["內部負荷", "session-RPE"]],
      sourceNote: "依研究結果與 EDGE SPORT 操作整合。"
    },
    phases: [{
      phase: "階段 1：建立基線",
      typicalTiming: "開始介入前或狀況穩定時",
      objectives: ["建立個人參考值"],
      entryCriteria: ["可完成例行測試"],
      actions: ["記錄負荷、症狀與表現"],
      dosage: "至少連續記錄一週",
      monitoring: ["資料完整率"],
      progressionCriteria: ["資料穩定且無警訊"],
      regressionCriteria: ["症狀惡化或資料品質不足"],
      evidenceBasis: "edge-sport-proposal"
    }, {
      phase: "階段 2：漸進調整",
      typicalTiming: "基線建立後",
      objectives: ["在可接受反應下增加刺激"],
      entryCriteria: ["通過前階段進階條件"],
      actions: ["一次只調整一個主要負荷變項"],
      dosage: "依個體反應逐次調整",
      monitoring: ["症狀、表現與恢復"],
      progressionCriteria: ["反應回到基線且表現維持"],
      regressionCriteria: ["症狀持續或表現明顯下降"],
      evidenceBasis: "mixed"
    }],
    loadManagement: {
      baseline: "以個人近期可耐受訓練建立參考。",
      progression: "依反應調整，不使用無來源的固定百分比。",
      monitoring: "每次記錄外部負荷、內部負荷、症狀與表現。",
      weeklyReview: "每週檢查趨勢、遺漏資料與警訊。"
    },
    stopRules: [{
      trigger: "症狀較基線持續上升",
      action: "降低或修改當次負荷並重新評估",
      restartCriteria: "症狀回到可接受範圍且功能測試穩定",
      urgency: "modify",
      evidenceBasis: "edge-sport-proposal"
    }, {
      trigger: "出現急性功能喪失或嚴重警訊",
      action: "停止訓練並轉介合格醫療人員",
      restartCriteria: "完成專業評估並取得明確後續計畫",
      urgency: "stop",
      evidenceBasis: "inclass-supported"
    }],
    outcomeTracking: [{
      domain: "負荷",
      measure: "session-RPE × 時間",
      frequency: "每次訓練後",
      targetOrInterpretation: "與個人基線及近期趨勢比較"
    }, {
      domain: "表現",
      measure: "任務特異性測試",
      frequency: "每週",
      targetOrInterpretation: "確認表現沒有伴隨負荷增加而惡化"
    }],
    riskDiscussion: ["單一指標不能準確代表整體受傷風險。"],
    uncertainties: ["研究結果未必可直接外推至不同運動與族群。"]
  };
  report.decisionPathway = {
    title: "每次進階前的決策流程",
    start: "先確認資料完整與當日狀態。",
    steps: [{
      question: "是否出現停止或轉介警訊？",
      ifYes: "停止訓練並接受專業評估。",
      ifNo: "進入反應檢查。"
    }, {
      question: "症狀、表現與恢復是否維持在可接受範圍？",
      ifYes: "維持或小幅進階，繼續監測。",
      ifNo: "退回前一可耐受負荷並找出原因。"
    }],
    note: "此流程支援訓練決策，不取代臨床判斷或醫療許可。"
  };

  return report;
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
