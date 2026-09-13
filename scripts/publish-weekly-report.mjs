import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublicReport, validateWeeklyReport } from "./lib/weekly-report-schema.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = parseArguments(process.argv.slice(2));
const reportId = argumentsByName.get("id");
const draftPath = resolve(rootDirectory, argumentsByName.get("draft") ?? `research-library/weekly-drafts/${reportId ?? ""}.json`);
const packetPath = resolve(rootDirectory, argumentsByName.get("packet") ?? `research-library/weekly-packets/${reportId ?? ""}.json`);
const outputPath = resolve(rootDirectory, "content", "weekly-reports.json");
const automated = argumentsByName.has("automated");
const automationProvider = argumentsByName.get("provider") ?? "codex";

if (!reportId || !/^\d{4}-w\d{2}$/.test(reportId)) {
  throw new Error("--id must use YYYY-wNN, for example 2026-w38.");
}

const [draft, packet, publicReports, issueContent] = await Promise.all([
  readJson(draftPath),
  readJson(packetPath),
  readJson(outputPath),
  readJson(resolve(rootDirectory, "content", "issues.json"))
]);

if (draft.id !== reportId || packet.id !== reportId) {
  throw new Error("The report ID must match both the draft and packet IDs.");
}

const topicIds = new Set((issueContent.topics ?? []).map((topic) => topic.id));
const validationContext = buildValidationContext(packet);
const validationErrors = validateWeeklyReport(draft, validationContext, { requireApproval: !automated });
if (automated) {
  const incompleteSources = (draft.articleDigests ?? []).filter((digest) => !["full-text-web", "full-text-local", "full-text-open"].includes(digest.contentLevel));
  if (incompleteSources.length > 0) {
    validationErrors.push(`automated publication requires complete full text for every source; ${incompleteSources.length} incomplete source(s) remain.`);
  }
  if (draft.editorReview?.approvedForPublish !== false) {
    validationErrors.push("automated publication must remain explicitly marked as not human reviewed.");
  }
}
for (const topicId of draft.topicIds ?? []) {
  if (!topicIds.has(topicId)) {
    validationErrors.push(`weekly report.topicIds includes unknown site topic ${topicId}.`);
  }
}

if (validationErrors.length > 0) {
  throw new Error(`The weekly draft is not ready for publication:\n- ${validationErrors.join("\n- ")}`);
}

const publicReport = buildPublicReport(draft, packet, {
  publicationMode: automated ? "automated" : "editor-reviewed",
  automationProvider: automated ? automationProvider : null
});
const existingReports = publicReports.reports ?? [];
const previousIndex = existingReports.findIndex((report) => report.id === reportId);
if (previousIndex >= 0) {
  existingReports[previousIndex] = publicReport;
} else {
  existingReports.unshift(publicReport);
}

publicReports.schemaVersion = 1;
publicReports.reports = existingReports.sort((left, right) => right.publishDate.localeCompare(left.publishDate));
await writeFile(outputPath, `${JSON.stringify(publicReports, null, 2)}\n`, "utf8");
console.log(`Published ${reportId} to ${outputPath}.`);

function buildValidationContext(packetData) {
  return {
    sourceRecordIds: packetData.selectedArticles.map((article) => article.record.id),
    contentLevelByRecord: new Map(packetData.selectedArticles.map((article) => [article.record.id, article.sourceMaterial.contentLevel])),
    courseIdsByRecord: new Map(packetData.selectedArticles.map((article) => [
      article.record.id,
      new Set(article.inClassMatches.map((match) => match.courseDocumentId))
    ])),
    issueIdsByRecord: new Map(packetData.selectedArticles.map((article) => [
      article.record.id,
      new Set(article.priorIssueMatches.map((match) => match.issueId))
    ]))
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseArguments(argumentsList) {
  const parsedArguments = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument?.startsWith("--")) {
      continue;
    }

    const name = argument.slice(2);
    const nextArgument = argumentsList[index + 1];
    if (!nextArgument || nextArgument.startsWith("--")) {
      parsedArguments.set(name, "true");
      continue;
    }

    parsedArguments.set(name, nextArgument);
    index += 1;
  }
  return parsedArguments;
}
