import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const weeklyReports = await readJson("content/weekly-reports.json");
const issues = await readJson("content/issues.json");
const podcasts = await readJson("content/podcasts.json");
const config = await readJson("config/podcast.json");
const latestPublishedReport = [...(weeklyReports.reports ?? [])]
  .filter((item) => item.status === "published")
  .sort((left, right) => right.publishDate.localeCompare(left.publishDate))[0];
const reportId = args.get("id") ?? latestPublishedReport?.id;
const report = weeklyReports.reports?.find((item) => item.id === reportId && item.status === "published");
if (!report) throw new Error(`Published weekly report not found: ${reportId ?? "none"}.`);

const reportSourceIds = new Set(report.researchSources.map((source) => source.recordId));
const relatedIssues = (issues.issues ?? [])
  .filter((issue) => issue.status === "published")
  .filter((issue) => issue.topicIds?.some((id) => report.topicIds.includes(id))
    || issue.researchSourceIds?.some((id) => reportSourceIds.has(id))
    || issue.sportTags?.some((tag) => report.sportTags.includes(tag)))
  .slice(0, 8)
  .map((issue) => ({
    id: issue.id,
    kind: issue.kind ?? "knowledge-topic",
    publishDate: issue.publishDate,
    title: issue.title,
    summary: issue.summary,
    question: issue.question,
    takeaways: issue.takeaways,
    trend: issue.trend,
    researchSourceIds: issue.researchSourceIds ?? (issue.evidence ?? []).map((source) => source.sourceId).filter(Boolean)
  }));
const priorEpisodes = (podcasts.episodes ?? []).slice(0, 6).map((episode) => ({
  id: episode.id,
  publishDate: episode.publishDate,
  title: episode.title,
  summary: episode.summary,
  closingTakeaways: episode.closingTakeaways
}));

const packet = {
  schemaVersion: 1,
  id: report.id,
  publishDate: report.publishDate,
  generatedAt: new Date().toISOString(),
  show: {
    name: config.showName,
    tagline: config.tagline,
    language: config.language,
    targetMinutes: config.targetMinutes,
    hosts: config.hosts,
    disclosure: config.disclosure
  },
  weeklyReport: report,
  relatedIssues,
  priorEpisodes,
  editorialRules: [
    "The weekly report is the source of truth. Do not add facts from memory or title-only records.",
    "Cover every research source in the weekly report and preserve denominators, units, comparisons, uncertainty and limitations.",
    "Use natural spoken English and explain specialist terms before using them.",
    "Create a genuine conversation: questions, clarifications, respectful disagreement and practical examples without staged hype.",
    "Distinguish source findings from EDGE SPORT operational proposals and from individualized medical decisions.",
    "Do not reproduce abstracts or source prose. Paraphrase the public synthesis in original podcast language.",
    "Do not diagnose listeners or provide individual return-to-play clearance.",
    "End with a concise, actionable recap and direct listeners to the written report and original sources."
  ]
};

const outputDirectory = resolve(rootDirectory, "research-library", "podcast-packets");
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `${report.id}.json`);
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
console.log(`Prepared private podcast packet for ${report.id}: ${outputPath}`);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(rootDirectory, path), "utf8"));
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
