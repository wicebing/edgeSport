import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rankKnowledgeMatches } from "./lib/knowledge-matching.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const month = args.get("month") ?? currentMonth();
if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) throw new Error("--month must use YYYY-MM.");
const id = args.get("id") ?? `${month.slice(0, 4)}-m${month.slice(5)}`;
const publishDate = args.get("date") ?? firstSaturday(month);
const maximumSources = integerArg(args.get("max-sources") ?? "8", "--max-sources", 2, 12);
const lookbackDays = integerArg(args.get("days") ?? "45", "--days", 14, 120);

const [content, radar, weeklyReports, inclassIndex] = await Promise.all([
  readJson("content/issues.json"),
  readJson("content/research-radar.json"),
  readJson("content/weekly-reports.json"),
  readJson("research-library/inclass-index.json")
]);

const cutoff = new Date(`${publishDate}T23:59:59Z`);
cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
const recentRadar = (radar.items ?? [])
  .filter((item) => inWindow(item.publicationDate, cutoff, publishDate))
  .sort((left, right) => right.publicationDate.localeCompare(left.publicationDate));
const researchCandidates = [];
for (const record of recentRadar) {
  const sourceMaterial = await locateCompleteSource(record.id);
  if (!sourceMaterial) continue;
  researchCandidates.push({
    record: pickRecordFields(record),
    sourceMaterial
  });
}
researchCandidates.sort((left, right) => candidateScore(right, weeklyReports) - candidateScore(left, weeklyReports)
  || right.record.publicationDate.localeCompare(left.record.publicationDate));

const selectedResearchCandidates = researchCandidates.slice(0, maximumSources);
if (selectedResearchCandidates.length < 2) {
  throw new Error(`Only ${selectedResearchCandidates.length} complete recent research source(s) were available. Run the weekly full-text workflow first or increase --days.`);
}

const currentAffairs = recentRadar
  .sort((left, right) => affairScore(right) - affairScore(left) || right.publicationDate.localeCompare(left.publicationDate))
  .slice(0, 30)
  .map((item) => ({
    id: item.id,
    sourceType: item.sourceType,
    title: item.title,
    publicationDate: item.publicationDate,
    source: item.journal,
    sourceUrl: item.sourceUrl,
    themes: item.themes ?? [],
    sportTags: item.sportTags ?? [],
    boundary: item.sourceType === "official-update"
      ? "Official update metadata; use as a current-affairs signal unless complete source text is separately supplied."
      : "Journal title/metadata signal; do not treat as a result unless its complete text is included in researchCandidates."
  }));

const matchTarget = {
  title: selectedResearchCandidates.map((item) => item.record.title).join(" "),
  themes: [...new Set(selectedResearchCandidates.flatMap((item) => item.record.themes ?? []))]
};
const courseDocuments = rankKnowledgeMatches(matchTarget, inclassIndex.documents ?? [], { maximumMatches: 12 })
  .map((document) => ({
    id: document.id,
    title: document.title,
    relativePath: document.relativePath,
    headings: (document.headings ?? []).slice(0, 20),
    conceptIds: document.conceptIds ?? [],
    conceptLabels: document.conceptLabels ?? [],
    excerpt: String(document.excerpt ?? "").slice(0, 3200),
    score: document.score,
    sharedConcepts: document.sharedConcepts ?? []
  }));

const legacyIssues = (content.issues ?? [])
  .filter((issue) => issue.status === "published" && issue.id !== id)
  .slice(0, 10)
  .map((issue) => ({
    id: issue.id,
    kind: issue.kind ?? "legacy-topic",
    publishDate: issue.publishDate,
    title: issue.title,
    summary: issue.summary,
    question: issue.question,
    takeaways: issue.takeaways,
    metrics: issue.metrics,
    trend: issue.trend,
    evidence: issue.evidence
  }));
const integratedReports = (weeklyReports.reports ?? [])
  .filter((report) => report.status === "published" && inWindow(report.publishDate, cutoff, publishDate))
  .slice(0, 8)
  .map((report) => ({
    id: report.id,
    kind: "integrated-weekly-report",
    publishDate: report.publishDate,
    title: report.title,
    summary: report.summary,
    question: report.question,
    researchLandscape: report.researchLandscape,
    knowledgePrimer: report.knowledgePrimer,
    articleDigests: (report.articleDigests ?? []).map((digest) => ({
      recordId: digest.recordId,
      headline: digest.headline,
      studyProfile: digest.studyProfile,
      quantitativeResults: digest.quantitativeResults,
      keyFindings: digest.keyFindings,
      practicalImplications: digest.practicalImplications,
      cautions: digest.cautions
    })),
    practiceGuide: report.practiceGuide,
    trend: report.trend
  }));

const packet = {
  schemaVersion: 1,
  id,
  month,
  publishDate,
  monthLabel: `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月深度專題`,
  weekLabel: `${month.slice(0, 4)} Monthly ${month.slice(5)}`,
  generatedAt: new Date().toISOString(),
  selectionWindow: { start: cutoff.toISOString().slice(0, 10), end: publishDate },
  allowedTopicIds: (content.topics ?? []).map((topic) => ({ id: topic.id, label: topic.label })),
  existingTopicTitles: (content.issues ?? []).map((issue) => ({ id: issue.id, title: issue.title, publishDate: issue.publishDate })),
  trendSignals: radar.trendSignals ?? [],
  researchCandidates: selectedResearchCandidates,
  currentAffairs,
  courseDocuments,
  priorReports: [...integratedReports, ...legacyIssues],
  authoringRules: [
    "Choose one focused topic that is timely, meaningful, supported by at least two supplied complete research sources, and materially distinct from existing topic titles.",
    "Read every complete source selected for evidence from beginning to end, including methods, results, tables, figure captions, discussion and limitations.",
    "Use currentAffairs only to explain why the topic matters now. Metadata or an official update is not automatically evidence for efficacy, risk or a clinical threshold.",
    "For every selected research source, preserve study design, population, comparison, follow-up, denominators, units, uncertainty and source location.",
    "Connect relevant inClass knowledge and prior reports explicitly. State whether the new evidence supports, extends, narrows or conflicts with earlier knowledge.",
    "Produce an executable protocol with assessment, phases, dosage, load progression/regression, stop/referral rules and outcome tracking. Label the evidence basis for operational recommendations.",
    "Never invent universal timelines, cutoffs, injury-risk percentages or progression rates. If evidence does not establish a value, say so and define a monitored decision process.",
    "Use original Traditional Chinese synthesis. Do not reproduce source tables, figures, captions, abstracts, course slides or copyrighted images.",
    "Create one original bar chart only when at least two directly comparable non-negative values are explicitly stated; otherwise set visualization to null.",
    "The result is educational evidence synthesis and decision support, not individualized diagnosis, treatment or medical clearance."
  ]
};

const outputDirectory = resolve(rootDirectory, "research-library", "monthly-packets");
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `${id}.json`);
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
console.log(`Prepared monthly topic packet: ${outputPath}`);
console.log(`${selectedResearchCandidates.length} complete research candidates, ${currentAffairs.length} current signals, ${courseDocuments.length} inClass matches, ${packet.priorReports.length} prior reports.`);

async function locateCompleteSource(recordId) {
  const textPath = resolve(rootDirectory, "research-library", "extracted", `${recordId}.txt`);
  try {
    const details = await stat(textPath);
    if (details.size < 3000) return null;
    const webAudit = await optionalJson(`research-library/web-full-text/${recordId}.json`);
    const openAudit = await optionalJson(`research-library/open-access/${recordId}.json`);
    const contentLevel = webAudit?.outcome === "complete-web-full-text"
      ? "full-text-web"
      : openAudit ? "full-text-open" : "full-text-local";
    return {
      contentLevel,
      extractedTextPath: relativePath(textPath),
      characterCount: details.size
    };
  } catch {
    return null;
  }
}

function candidateScore(candidate, reports) {
  const usedInWeekly = (reports.reports ?? []).some((report) => report.sourceRecordIds?.includes(candidate.record.id));
  return (usedInWeekly ? 20 : 0) + (candidate.record.themes?.length ?? 0) * 2 + (candidate.record.sportTags?.length ?? 0);
}

function affairScore(item) {
  return (item.sourceType === "official-update" ? 100 : 0) + (item.themes?.length ?? 0) * 4 + (item.sportTags?.length ?? 0) * 2;
}

function pickRecordFields(record) {
  return {
    id: record.id,
    title: record.title,
    journal: record.journal,
    journalAbbreviation: record.journalAbbreviation,
    publicationDate: record.publicationDate,
    authors: record.authors ?? [],
    publicationTypes: record.publicationTypes ?? [],
    doi: record.doi,
    pmid: record.pmid,
    pmcId: record.pmcId,
    sourceUrl: record.sourceUrl,
    fullTextUrl: record.fullTextUrl,
    themes: record.themes ?? [],
    sportTags: record.sportTags ?? []
  };
}

function inWindow(value, start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return date >= start && value <= end;
}

function firstSaturday(value) {
  const date = new Date(`${value}-01T12:00:00Z`);
  date.setUTCDate(1 + ((6 - date.getUTCDay() + 7) % 7));
  return date.toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function relativePath(path) {
  return path.slice(rootDirectory.length + 1).replaceAll("\\", "/");
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(rootDirectory, path), "utf8"));
}

async function optionalJson(path) {
  try {
    await access(resolve(rootDirectory, path));
    return await readJson(path);
  } catch {
    return null;
  }
}

function integerArg(value, label, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be ${minimum}-${maximum}.`);
  return parsed;
}

function parseArguments(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed.set(value.slice(2), "true");
    else {
      parsed.set(value.slice(2), next);
      index += 1;
    }
  }
  return parsed;
}
