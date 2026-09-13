import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { validateWeeklyReport } from "./lib/weekly-report-schema.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = parseArguments(process.argv.slice(2));
const reportId = argumentsByName.get("id");
const reviewer = argumentsByName.get("reviewer")?.trim() ?? "";

if (!reportId || !/^\d{4}-w\d{2}$/u.test(reportId)) {
  throw new Error("--id must use YYYY-wNN.");
}
if (!reviewer) {
  throw new Error("--reviewer is required so the public report has an accountable verifier.");
}
if (!argumentsByName.has("confirm")) {
  throw new Error("Release stopped. Add --confirm only after checking every statement, number, limitation, inClass match, table, and chart against the named source.");
}

const draftPath = resolve(rootDirectory, argumentsByName.get("draft") ?? `research-library/weekly-drafts/${reportId}.json`);
const packetPath = resolve(rootDirectory, argumentsByName.get("packet") ?? `research-library/weekly-packets/${reportId}.json`);
const [draft, packet, draftStats] = await Promise.all([
  readJson(draftPath),
  readJson(packetPath),
  stat(draftPath)
]);
if (draftStats.mtimeMs < Date.parse(packet.generatedAt)) {
  throw new Error("Release stopped: the draft is older than the current research packet. Regenerate the draft before review and publication.");
}
const packetContext = {
  sourceRecordIds: packet.selectedArticles.map((article) => article.record.id),
  contentLevelByRecord: new Map(packet.selectedArticles.map((article) => [article.record.id, article.sourceMaterial.contentLevel])),
  courseIdsByRecord: new Map(packet.selectedArticles.map((article) => [article.record.id, new Set(article.inClassMatches.map((match) => match.courseDocumentId))])),
  issueIdsByRecord: new Map(packet.selectedArticles.map((article) => [article.record.id, new Set(article.priorIssueMatches.map((match) => match.issueId))]))
};
const validationErrors = validateWeeklyReport(draft, packetContext, { requireApproval: false });
if (validationErrors.length > 0) {
  throw new Error(`Release stopped: the draft does not match the current research packet:\n- ${validationErrors.join("\n- ")}`);
}
const abstractOnly = (draft.articleDigests ?? []).filter((digest) => digest.contentLevel === "abstract-only");
const incomplete = (draft.articleDigests ?? []).filter((digest) => digest.contentLevel === "full-text-excerpt");
if ((abstractOnly.length > 0 || incomplete.length > 0) && !argumentsByName.has("allow-abstracts")) {
  throw new Error(`Release stopped: ${abstractOnly.length} abstract-only and ${incomplete.length} excerpt-only article(s) remain. Supply complete full text and regenerate, or explicitly add --allow-abstracts after verifying the labels and cautions.`);
}

draft.status = "draft";
draft.editorReview = {
  approvedForPublish: true,
  verifiedBy: reviewer,
  verifiedAt: new Date().toISOString().slice(0, 10)
};
await writeFile(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");

await runNodeScript("publish-weekly-report.mjs", ["--id", reportId, "--draft", draftPath]);
await runNodeScript("validate-content.mjs", []);
console.log(`Released ${reportId}. Commit the public content and site files when you are ready.`);

function runNodeScript(fileName, scriptArguments) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve(rootDirectory, "scripts", fileName), ...scriptArguments], {
      cwd: rootDirectory,
      shell: false,
      windowsHide: true,
      stdio: "inherit"
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${fileName} exited with code ${code ?? 1}.`));
    });
  });
}

function parseArguments(argumentsList) {
  const parsed = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument?.startsWith("--")) continue;
    const next = argumentsList[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(argument.slice(2), "true");
    } else {
      parsed.set(argument.slice(2), next);
      index += 1;
    }
  }
  return parsed;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
