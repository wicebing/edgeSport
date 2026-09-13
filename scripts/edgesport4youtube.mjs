import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const podcasts = JSON.parse(await readFile(resolve(rootDirectory, "content", "podcasts.json"), "utf8"));
const latestEpisode = [...(podcasts.episodes ?? [])].filter((item) => item.status === "published").sort((left, right) => right.publishDate.localeCompare(left.publishDate))[0];
const id = args.get("id") ?? latestEpisode?.id;
if (!/^\d{4}-w\d{2}$/u.test(id ?? "")) throw new Error("No published podcast was found. Run npm.cmd run podcast:run first.");

const outputDirectory = resolve(rootDirectory, "youtube-output");
if (basename(outputDirectory) !== "youtube-output" || dirname(outputDirectory) !== rootDirectory) throw new Error(`Unsafe YouTube output directory: ${outputDirectory}`);
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
console.log(`edgeSport4Podcast YouTube package: ${id}`);
const planArguments = ["--id", id];
if (args.get("model")) planArguments.push("--model", args.get("model"));
await run("generate-youtube-video-plan.mjs", planArguments);
if (args.has("plan-only")) {
  console.log("YouTube plan is ready. Video rendering was skipped by --plan-only.");
  process.exit(0);
}
await run("render-youtube-video.mjs", ["--id", id]);
console.log("Step 3 complete. Upload the MP4 to YouTube, optionally upload the SRT and thumbnail, then delete youtube-output when no longer needed.");

function run(file, childArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve(rootDirectory, "scripts", file), ...childArgs], { cwd: rootDirectory, shell: false, windowsHide: true, stdio: "inherit" });
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
