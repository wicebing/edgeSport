import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReviewedRecord } from "./lib/research-review.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const radarPath = resolve(rootDirectory, "content", "research-radar.json");
const issuesPath = resolve(rootDirectory, "content", "issues.json");
const argumentsByName = parseArguments(process.argv.slice(2));
const reviewArgument = argumentsByName.get("review");
const featuredInIssueId = argumentsByName.get("issue") ?? null;

if (!reviewArgument) {
  console.error("Usage: npm run research:publish-review -- --review research-library/reviews/pmid-123456.json [--issue 2026-w38]");
  process.exit(1);
}

const reviewPath = resolve(process.cwd(), reviewArgument);
const reviewInput = JSON.parse(await readFile(reviewPath, "utf8"));
const radar = JSON.parse(await readFile(radarPath, "utf8"));
const recordIndex = radar.items?.findIndex((item) => item.id === reviewInput.recordId) ?? -1;

if (recordIndex < 0) {
  throw new Error(`No research-radar item found for ${reviewInput.recordId}.`);
}

if (featuredInIssueId) {
  const issues = JSON.parse(await readFile(issuesPath, "utf8"));
  const linkedIssue = issues.issues?.find((issue) => issue.id === featuredInIssueId && issue.status === "published");
  if (!linkedIssue) {
    throw new Error(`--issue must reference an existing published issue. Could not find ${featuredInIssueId}.`);
  }
}

const existingRecord = radar.items[recordIndex];
const reviewedRecord = {
  ...existingRecord,
  status: featuredInIssueId ? "featured" : "reviewed",
  review: reviewInput.review,
  rights: reviewInput.rights,
  synthesisTable: reviewInput.synthesisTable,
  visualization: reviewInput.visualization,
  featuredInIssueId
};
const validationErrors = validateReviewedRecord(reviewedRecord, `research-radar item ${reviewedRecord.id}`);

if (validationErrors.length > 0) {
  console.error("The review is not ready for public publication:");
  for (const error of validationErrors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

radar.items[recordIndex] = reviewedRecord;
await writeFile(radarPath, `${JSON.stringify(radar, null, 2)}\n`, "utf8");
await import("./build-knowledge-index.mjs");
console.log(`Published ${reviewedRecord.id} as ${reviewedRecord.status} in the public research radar.`);

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
