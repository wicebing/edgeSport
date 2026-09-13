import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const month = args.get("month") ?? new Date().toISOString().slice(0, 7);
if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) throw new Error("--month must use YYYY-MM.");
const id = args.get("id") ?? `${month.slice(0, 4)}-m${month.slice(5)}`;
const date = args.get("date") ?? firstSaturday(month);
const days = args.get("days") ?? "45";
const maximumSources = args.get("max-sources") ?? "8";
console.log(`EDGE SPORT monthly deep-dive: ${id} (${date})`);

if (!args.has("skip-index")) await run("index-inclass.mjs", []);
if (!args.has("skip-harvest")) await run("harvest-research.mjs", ["--days", days]);
if (!args.has("skip-open-intake")) await run("fetch-open-access.mjs", ["--limit", args.get("open-access-limit") ?? "50"]);

const packetArgs = ["--id", id, "--month", month, "--date", date, "--days", days, "--max-sources", maximumSources];
await run("prepare-monthly-packet.mjs", packetArgs);
const generationArgs = ["--id", id, "--month", month];
if (args.get("model")) generationArgs.push("--model", args.get("model"));
await run("generate-monthly-topic.mjs", generationArgs);

if (args.has("draft-only")) {
  console.log(`Monthly draft ready: research-library/monthly-drafts/${id}.json`);
  process.exit(0);
}
await run("publish-monthly-topic.mjs", ["--id", id]);
await run("build-knowledge-index.mjs", []);
await run("validate-content.mjs", []);
console.log(`Monthly Knowledge Index updated: ${id}. Commit and push to update GitHub Pages.`);

function run(file, childArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve(rootDirectory, "scripts", file), ...childArgs], {
      cwd: rootDirectory,
      shell: false,
      windowsHide: true,
      stdio: "inherit"
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${file} exited with ${code ?? 1}.`)));
  });
}

function firstSaturday(value) {
  const date = new Date(`${value}-01T12:00:00Z`);
  date.setUTCDate(1 + ((6 - date.getUTCDay() + 7) % 7));
  return date.toISOString().slice(0, 10);
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
