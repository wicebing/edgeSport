import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateMonthlyTopic } from "./lib/monthly-topic-schema.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const id = args.get("id");
if (!/^\d{4}-m(0[1-9]|1[0-2])$/u.test(id ?? "")) throw new Error("--id must use YYYY-mMM.");
const draftPath = resolve(rootDirectory, args.get("draft") ?? `research-library/monthly-drafts/${id}.json`);
const packetPath = resolve(rootDirectory, args.get("packet") ?? `research-library/monthly-packets/${id}.json`);
const contentPath = resolve(rootDirectory, "content", "issues.json");
const [draft, packet, content] = await Promise.all([readJson(draftPath), readJson(packetPath), readJson(contentPath)]);
if (draft.id !== id || packet.id !== id) throw new Error("Draft and packet IDs must match --id.");

const validationErrors = validateMonthlyTopic(draft, {
  researchSourceIds: packet.researchCandidates.map((item) => item.record.id),
  currentAffairIds: packet.currentAffairs.map((item) => item.id),
  courseIds: packet.courseDocuments.map((item) => item.id),
  priorReportIds: packet.priorReports.map((item) => item.id)
});
if (validationErrors.length > 0) throw new Error(`Monthly draft failed validation:\n- ${validationErrors.join("\n- ")}`);

const researchById = new Map(packet.researchCandidates.map((item) => [item.record.id, item]));
const affairsById = new Map(packet.currentAffairs.map((item) => [item.id, item]));
const coursesById = new Map(packet.courseDocuments.map((item) => [item.id, item]));
const reportsById = new Map(packet.priorReports.map((item) => [item.id, item]));
const synthesisById = new Map(draft.evidenceSynthesis.map((item) => [item.sourceId, item]));
const publicTopic = {
  ...draft,
  status: "published",
  publicationMode: "automated",
  automationProvider: "codex",
  generatedAt: packet.generatedAt,
  publishedAt: new Date().toISOString(),
  coverImage: selectCoverImage(draft),
  evidence: draft.researchSourceIds.map((sourceId) => {
    const source = researchById.get(sourceId);
    const synthesis = synthesisById.get(sourceId);
    return {
      sourceId,
      type: `${evidenceLevelLabel(synthesis.evidenceLevel)}｜${synthesis.studyDesign}`,
      citation: source.record.title,
      source: `${source.record.journal} · ${source.record.publicationDate}`,
      url: source.record.sourceUrl,
      note: synthesis.interpretation,
      contentLevel: source.sourceMaterial.contentLevel
    };
  }),
  currentAffairs: draft.currentAffairs.map((connection) => {
    const source = affairsById.get(connection.sourceId);
    return { ...connection, title: source.title, source: source.source, publicationDate: source.publicationDate, sourceUrl: source.sourceUrl, sourceType: source.sourceType };
  }),
  courseConnectionsDetailed: draft.courseConnectionsDetailed.map((connection) => {
    const course = coursesById.get(connection.courseId);
    return { ...connection, title: course.title, concepts: course.sharedConcepts ?? course.conceptLabels ?? [] };
  }),
  priorReportConnections: draft.priorReportConnections.map((connection) => {
    const report = reportsById.get(connection.reportId);
    return { ...connection, title: report.title, publishDate: report.publishDate, kind: report.kind };
  }),
  courseConnections: draft.courseConnectionsDetailed.map((connection) => `${coursesById.get(connection.courseId).title}：${connection.progression}`)
};

content.issues = [...(content.issues ?? []).filter((issue) => issue.id !== id), publicTopic]
  .sort((left, right) => right.publishDate.localeCompare(left.publishDate));
await writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
console.log(`Published monthly deep-dive ${id} to ${contentPath}.`);

function selectCoverImage(topic) {
  const value = `${topic.title} ${topic.sportTags.join(" ")} ${topic.topicIds.join(" ")}`.toLocaleLowerCase("en");
  if (/baseball|棒球|pitch|throw|shoulder|肩/u.test(value)) {
    return { src: "https://images.unsplash.com/photo-1508344928928-7165b67de128?auto=format&fit=crop&w=1600&q=85", alt: "棒球投手在球場上完成投球動作", credit: "Photo source: Unsplash" };
  }
  if (/run|marathon|endurance|跑|耐力/u.test(value)) {
    return { src: "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=1600&q=85", alt: "運動員進行戶外耐力訓練", credit: "Photo source: Unsplash" };
  }
  if (/nutrition|營養|hydration|補水/u.test(value)) {
    return { src: "https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=1600&q=85", alt: "運動營養與恢復規劃", credit: "Photo source: Unsplash" };
  }
  return { src: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1600&q=85", alt: "運動員在訓練場進行系統性訓練", credit: "Photo source: Unsplash" };
}

function evidenceLevelLabel(value) {
  return ({ high: "高", moderate: "中", low: "低", "very-low": "極低", "not-graded": "未分級" })[value] ?? value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed.set(value.slice(2), "true");
    else { parsed.set(value.slice(2), next); index += 1; }
  }
  return parsed;
}
