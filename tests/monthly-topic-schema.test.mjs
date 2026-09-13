import test from "node:test";
import assert from "node:assert/strict";
import { validateMonthlyTopic } from "../scripts/lib/monthly-topic-schema.mjs";

const context = {
  researchSourceIds: ["pmid-1", "pmid-2"],
  currentAffairIds: ["news-1"],
  courseIds: ["course-1"],
  priorReportIds: ["2026-w01"]
};

function makeTopic() {
  const result = (sourceId) => ({ measure: "結果", result: "12%", context: "研究族群與時點", sourceLocation: "Results" });
  const synthesis = (sourceId) => ({
    sourceId,
    studyDesign: "前瞻性研究",
    population: "成人運動員",
    methods: "比較介入與對照並追蹤四週",
    quantitativeResults: [result(sourceId)],
    interpretation: "結果支持監測，不建立個人門檻。",
    limitations: ["樣本與情境限制外推。"],
    evidenceLevel: "moderate"
  });
  return {
    schemaVersion: 1,
    id: "2026-m09",
    kind: "monthly-deep-dive",
    status: "draft",
    publishDate: "2026-09-05",
    monthLabel: "2026 年 9 月深度專題",
    weekLabel: "2026 Monthly 09",
    title: "月度深度議題",
    summary: "整合新研究、課程與既有報告。",
    readingMinutes: 18,
    topicIds: ["monitoring"],
    sportTags: ["棒球"],
    question: "如何把研究轉成決策？",
    evidenceLens: "兩篇完整研究與課程整合",
    whyNow: { currentSignal: "新研究出現。", knowledgeGap: "門檻未建立。", decisionNeed: "需要可追蹤流程。" },
    learningObjectives: ["定義概念", "解讀數據", "執行流程"],
    knowledgePrimer: {
      overview: "先界定量測與決策邊界。",
      definitions: [
        { term: "指標一", definition: "定義一", distinction: "不等於診斷", basis: "source-stated" },
        { term: "指標二", definition: "定義二", distinction: "不等於預測", basis: "inclass-supported" },
        { term: "指標三", definition: "定義三", distinction: "不等於因果", basis: "cross-source-synthesis" }
      ],
      mechanisms: [
        { title: "機轉一", explanation: "來源支持的解釋。", practicalMeaning: "用於監測。", sourceIds: ["pmid-1"] },
        { title: "機轉二", explanation: "來源支持的解釋。", practicalMeaning: "用於評估。", sourceIds: ["pmid-2"] }
      ]
    },
    keyNumbers: [
      { value: "12%", label: "結果一", context: "族群與時點", sourceIds: ["pmid-1"] },
      { value: "24 人", label: "樣本", context: "完整樣本", sourceIds: ["pmid-2"] },
      { value: "4 週", label: "追蹤", context: "介入時間", sourceIds: ["pmid-1"] }
    ],
    researchSourceIds: ["pmid-1", "pmid-2"],
    evidenceSynthesis: [synthesis("pmid-1"), synthesis("pmid-2")],
    visualization: null,
    comparisonTable: { title: "研究比較", headers: ["面向", "研究一", "研究二"], rows: [["族群", "成人", "成人"]], sourceNote: "原創整理。" },
    takeaways: [{ title: "重點一", body: "內容一" }, { title: "重點二", body: "內容二" }, { title: "重點三", body: "內容三" }],
    actionProtocol: {
      title: "執行方案",
      scope: "教育性決策支援。",
      targetPopulation: "成人運動員",
      goal: "建立可追蹤決策。",
      assessmentTable: { title: "評估", headers: ["領域", "方法"], rows: [["表現", "個人基線"]], sourceNote: "混合依據。" },
      phases: [
        { phase: "建立基線", timing: "開始前", entryCriteria: ["可完成測試"], actions: ["記錄"], dosage: "依個人情況", monitoring: ["症狀"], progressionCriteria: ["穩定"], regressionCriteria: ["惡化"], evidenceBasis: "edge-sport-proposal" },
        { phase: "漸進執行", timing: "基線後", entryCriteria: ["狀況穩定"], actions: ["逐次增加"], dosage: "依反應調整", monitoring: ["表現"], progressionCriteria: ["可耐受"], regressionCriteria: ["表現下降"], evidenceBasis: "mixed" }
      ],
      loadManagement: { baseline: "個人近期資料", progression: "一次調一項", monitoring: "內外部負荷", reviewCadence: "每週" },
      stopRules: [
        { trigger: "症狀增加", action: "調整", restartCriteria: "回到可接受狀態", urgency: "modify", evidenceBasis: "edge-sport-proposal" },
        { trigger: "功能喪失", action: "停止並評估", restartCriteria: "取得專業計畫", urgency: "stop", evidenceBasis: "inclass-supported" }
      ],
      outcomeTracking: [
        { domain: "負荷", measure: "sRPE", frequency: "每次", interpretation: "比較基線" },
        { domain: "表現", measure: "任務測試", frequency: "每週", interpretation: "觀察趨勢" }
      ]
    },
    decisionPath: [
      { stage: "安全", question: "有警訊嗎？", signals: ["症狀", "功能"], action: "有則停止。" },
      { stage: "資料", question: "資料可比較嗎？", signals: ["同工具", "同情境"], action: "不可比較就先核對。" },
      { stage: "進展", question: "反應可接受嗎？", signals: ["症狀穩定", "表現維持"], action: "決定維持或進退階。" }
    ],
    fieldChecklist: ["確認對象", "建立基線", "記錄負荷", "檢查症狀", "每週回顧"],
    metrics: [
      { name: "負荷", why: "描述刺激", practice: "每次記錄" },
      { name: "症狀", why: "描述反應", practice: "同尺度記錄" },
      { name: "表現", why: "描述能力", practice: "固定條件測量" }
    ],
    currentAffairs: [{ sourceId: "news-1", relevance: "說明時效性。", evidenceBoundary: "不作效果證據。" }],
    courseConnectionsDetailed: [{ courseId: "course-1", knowledge: "課程基礎。", progression: "新研究延伸量化情境。" }],
    priorReportConnections: [{ reportId: "2026-w01", knowledge: "先前流程。", progression: "本月加入新數據。" }],
    trend: { title: "研究趨勢", body: "從單一數值轉向多維決策。" },
    uncertainties: ["個人門檻未知。", "介入效果仍待驗證。"],
    editorReview: { approvedForPublish: false, verifiedBy: "", verifiedAt: "" }
  };
}

test("accepts a traceable monthly deep-dive", () => {
  assert.deepEqual(validateMonthlyTopic(makeTopic(), context), []);
});

test("rejects an unavailable research source", () => {
  const topic = makeTopic();
  topic.researchSourceIds[1] = "pmid-unknown";
  assert.ok(validateMonthlyTopic(topic, context).some((error) => error.includes("unavailable")));
});

test("rejects a shallow protocol", () => {
  const topic = makeTopic();
  topic.actionProtocol.phases = [];
  assert.ok(validateMonthlyTopic(topic, context).some((error) => error.includes("phases")));
});
