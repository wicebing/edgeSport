import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const reports = JSON.parse(await readFile(resolve(rootDirectory, "content", "weekly-reports.json"), "utf8"));
const latestPublishedReport = [...(reports.reports ?? [])]
  .filter((report) => report.status === "published")
  .sort((left, right) => right.publishDate.localeCompare(left.publishDate))[0];
const id = args.get("id") ?? latestPublishedReport?.id;
if (!/^\d{4}-w\d{2}$/u.test(id ?? "")) throw new Error("No published weekly report was found. Run npm.cmd run weekly:run first.");

console.log(`edgeSport4Podcast: ${id}`);
await run("prepare-podcast-voices.mjs", []);
await run("prepare-podcast-packet.mjs", ["--id", id]);
const generationArguments = ["--id", id];
if (args.get("model")) generationArguments.push("--model", args.get("model"));
await run("generate-podcast-script.mjs", generationArguments);
if (args.has("script-only")) {
  console.log(`Podcast script ready: research-library/podcast-drafts/${id}.json`);
  process.exit(0);
}
const renderArguments = ["--id", id];
if (args.get("device")) renderArguments.push("--device", args.get("device"));
await run("render-podcast.mjs", renderArguments);
await run("publish-podcast.mjs", ["--id", id]);
await run("validate-content.mjs", []);
console.log(`edgeSport4Podcast ${id} is ready. Preview it, then commit and push the MP3, transcript and public metadata.`);
console.log("Step 3 — create the replaceable YouTube upload package: npm.cmd run podcast:youtube");

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
