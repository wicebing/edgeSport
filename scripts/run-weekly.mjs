import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = parseArguments(process.argv.slice(2));
const publishDate = argumentsByName.get("date") ?? formatIsoDate(nextSaturday(new Date()));
const reportId = argumentsByName.get("id") ?? isoWeekId(new Date(`${publishDate}T12:00:00Z`));
const title = argumentsByName.get("title") ?? "本週運動科學新知整合";
const days = argumentsByName.get("days") ?? "7";
const maximumArticles = argumentsByName.get("max-articles") ?? "8";
const provider = argumentsByName.get("provider") ?? "codex";
const reviewer = argumentsByName.get("reviewer") ?? "";

if (!/^\d{4}-\d{2}-\d{2}$/u.test(publishDate)) {
  throw new Error("--date must use YYYY-MM-DD.");
}
if (!/^\d{4}-w\d{2}$/u.test(reportId)) {
  throw new Error("--id must use YYYY-wNN.");
}
if (argumentsByName.has("allow-abstracts") && !argumentsByName.has("draft-only") && !argumentsByName.has("prepare-only")) {
  throw new Error("--allow-abstracts requires --draft-only. Automatic website publication accepts complete web/local/open full text only.");
}

console.log(`EDGE SPORT weekly workflow: ${reportId} (${publishDate})`);
console.log(argumentsByName.has("allow-abstracts")
  ? "Evidence mode: complete full text preferred; abstract-only records are allowed and will be labeled."
  : "Evidence mode: complete web/local/open-access full text required for every selected article.");

const packetArguments = [
  "--id", reportId,
  "--date", publishDate,
  "--title", title,
  "--max-articles", maximumArticles
];
if (argumentsByName.get("articles")) {
  packetArguments.push("--articles", argumentsByName.get("articles"));
} else if (argumentsByName.get("theme")) {
  packetArguments.push("--theme", argumentsByName.get("theme"));
} else {
  packetArguments.push("--all");
}

if (!argumentsByName.has("skip-index")) {
  await runNodeScript("index-inclass.mjs", []);
}

if (!argumentsByName.has("skip-harvest")) {
  await runNodeScript("harvest-research.mjs", ["--days", days]);
}

if (!argumentsByName.has("skip-full-text-intake")) {
  const openAccessArguments = ["--limit", argumentsByName.get("open-access-limit") ?? "30"];
  if (argumentsByName.get("articles")) {
    openAccessArguments.push("--articles", argumentsByName.get("articles"));
  }
  await runNodeScript("fetch-open-access.mjs", openAccessArguments);

  const ingestArguments = [];
  if (reviewer) ingestArguments.push("--reviewer", reviewer);
  if (argumentsByName.get("pdf-dir")) ingestArguments.push("--dir", argumentsByName.get("pdf-dir"));
  await runNodeScript("ingest-full-text-folder.mjs", ingestArguments);

  if (!argumentsByName.has("skip-web-full-text") && !argumentsByName.has("no-institutional-download")) {
    console.log("Preparing the candidate set for authorized institutional/open-web full-text reading.");
    await runNodeScript("prepare-weekly-packet.mjs", packetArguments);

    const webArguments = ["--id", reportId, "--limit", maximumArticles];
    if (argumentsByName.get("resolver")) webArguments.push("--resolver", argumentsByName.get("resolver"));
    if (argumentsByName.get("max-html-mb")) webArguments.push("--max-html-mb", argumentsByName.get("max-html-mb"));
    if (argumentsByName.get("download-timeout-seconds")) webArguments.push("--timeout-seconds", argumentsByName.get("download-timeout-seconds"));
    if (argumentsByName.get("download-delay-ms")) webArguments.push("--delay-ms", argumentsByName.get("download-delay-ms"));
    await runNodeScript("fetch-web-full-text.mjs", webArguments);

    if (argumentsByName.has("pdf-fallback")) {
      const institutionalArguments = ["--id", reportId, "--limit", maximumArticles];
      if (argumentsByName.get("resolver")) institutionalArguments.push("--resolver", argumentsByName.get("resolver"));
      if (argumentsByName.get("max-pdf-mb")) institutionalArguments.push("--max-mb", argumentsByName.get("max-pdf-mb"));
      if (argumentsByName.get("download-timeout-seconds")) institutionalArguments.push("--timeout-seconds", argumentsByName.get("download-timeout-seconds"));
      if (argumentsByName.get("download-delay-ms")) institutionalArguments.push("--delay-ms", argumentsByName.get("download-delay-ms"));
      await runNodeScript("fetch-institutional-pdfs.mjs", institutionalArguments);
      await runNodeScript("ingest-full-text-folder.mjs", ingestArguments);
    }
  }
}

if (!argumentsByName.has("allow-abstracts")) {
  packetArguments.push("--full-text-only");
}
await runNodeScript("prepare-weekly-packet.mjs", packetArguments);

if (argumentsByName.has("prepare-only")) {
  console.log(`Prepared ${reportId}. Generation was skipped by --prepare-only.`);
  process.exit(0);
}

const generationArguments = ["--id", reportId, "--provider", provider];
if (!argumentsByName.has("draft-only")) generationArguments.push("--auto-publish");
if (argumentsByName.get("model")) generationArguments.push("--model", argumentsByName.get("model"));
if (argumentsByName.get("max-ai-credits")) generationArguments.push("--max-ai-credits", argumentsByName.get("max-ai-credits"));
await runNodeScript("generate-weekly-draft.mjs", generationArguments);

console.log("");
if (argumentsByName.has("draft-only")) {
  console.log(`Draft ready: research-library/weekly-drafts/${reportId}.json`);
  console.log("Publication was skipped by --draft-only. After human review, release with:");
  console.log(`npm.cmd run weekly:release -- --id ${reportId} --reviewer "Your Name" --confirm`);
  process.exit(0);
}

await runNodeScript("publish-weekly-report.mjs", ["--id", reportId, "--automated", "--provider", provider]);
await runNodeScript("validate-content.mjs", []);
console.log(`Public weekly archive updated: content/weekly-reports.json (${reportId}).`);
console.log("The report is labeled as Codex/LLM automated and not human reviewed. Commit and push the project to update GitHub Pages.");

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
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${fileName} exited with code ${code ?? 1}.`));
      }
    });
  });
}

function nextSaturday(date) {
  const result = new Date(date);
  const daysUntilSaturday = (6 - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + daysUntilSaturday);
  return result;
}

function isoWeekId(date) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-w${String(week).padStart(2, "0")}`;
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
