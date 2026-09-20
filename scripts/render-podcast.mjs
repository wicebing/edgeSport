import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { validatePodcastScript } from "./lib/podcast-schema.mjs";
import { preparePodcastVoices } from "./lib/podcast-voices.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const id = args.get("id");
if (!/^\d{4}-w\d{2}$/u.test(id ?? "")) throw new Error("--id must use YYYY-wNN.");
const configPath = resolve(rootDirectory, args.get("config") ?? "config/podcast.json");
const draftPath = resolve(rootDirectory, args.get("draft") ?? `research-library/podcast-drafts/${id}.json`);
const reportData = JSON.parse(await readFile(resolve(rootDirectory, "content", "weekly-reports.json"), "utf8"));
const report = reportData.reports.find((item) => item.id === id);
if (!report) throw new Error(`Weekly report not found: ${id}.`);
const draft = JSON.parse(await readFile(draftPath, "utf8"));
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!ffmpegPath) throw new Error("The bundled ffmpeg executable is unavailable. Reinstall dependencies with npm install.");
const voiceProfiles = await preparePodcastVoices({ rootDirectory, config, ffmpegPath });
const sourceRecordIds = report.researchSources.map((source) => source.recordId);
const validationErrors = validatePodcastScript(draft, { sourceRecordIds, requireNaturalDialogue: true });
if (validationErrors.length) throw new Error(`Podcast script is not renderable:\n- ${validationErrors.join("\n- ")}`);

const privateDirectory = resolve(rootDirectory, "research-library", "podcast-audio", id);
const workDirectory = resolve(privateDirectory, "chunks");
const masterPath = resolve(privateDirectory, `${id}-master.wav`);
const timingPath = resolve(privateDirectory, `${id}-timings.json`);
const publicDirectory = resolve(rootDirectory, "assets", "podcasts");
const temporaryPath = resolve(publicDirectory, `${id}.tmp.mp3`);
await Promise.all([mkdir(workDirectory, { recursive: true }), mkdir(publicDirectory, { recursive: true })]);

const python = await findPython();
const pythonArguments = [
  ...python.prefix,
  resolve(rootDirectory, "scripts", "render_podcast_audio.py"),
  "--draft", draftPath,
  "--config", configPath,
  "--master", masterPath,
  "--timings", timingPath,
  "--work-dir", workDirectory,
  "--host-wav", voiceProfiles.host.speakerWav,
  "--cohost-wav", voiceProfiles.cohost.speakerWav,
  "--device", args.get("device") ?? config.tts.device ?? "auto"
];
await run(python.command, pythonArguments);
await rm(temporaryPath, { force: true });
await run(ffmpegPath, [
  "-hide_banner", "-loglevel", "warning", "-y",
  "-i", masterPath,
  "-af", "highpass=f=65,lowpass=f=11000,loudnorm=I=-16:TP=-1.5:LRA=11",
  "-ar", String(config.tts.sampleRate),
  "-ac", "1",
  "-codec:a", "libmp3lame",
  "-b:a", config.tts.mp3Bitrate,
  temporaryPath
]);
const temporaryStats = await stat(temporaryPath);
if (temporaryStats.size < 1000 || temporaryStats.size > 95 * 1024 * 1024) throw new Error(`Rendered MP3 has an invalid size: ${temporaryStats.size} bytes.`);
const audioDigest = createHash("sha256").update(await readFile(temporaryPath)).digest("hex").slice(0, 12);
const publicFileName = `${id}-${audioDigest}.mp3`;
const finalPath = resolve(publicDirectory, publicFileName);
if (await pathExists(finalPath)) await rm(temporaryPath, { force: true });
else await rename(temporaryPath, finalPath);
const timing = JSON.parse(await readFile(timingPath, "utf8"));
const renderRecord = {
  schemaVersion: 1,
  id,
  renderedAt: new Date().toISOString(),
  durationSeconds: timing.durationSeconds,
  sampleRate: config.tts.sampleRate,
  bitrate: config.tts.mp3Bitrate,
  audioPath: `assets/podcasts/${publicFileName}`,
  bytes: temporaryStats.size,
  timingPath: relativePrivatePath(timingPath),
  turns: timing.turns,
  voices: timing.voices
};
const renderRecordPath = resolve(privateDirectory, `${id}-render.json`);
await writeFile(renderRecordPath, `${JSON.stringify(renderRecord, null, 2)}\n`, "utf8");
console.log(`Rendered edgeSport4Podcast MP3: ${finalPath}`);
console.log(`Duration ${(timing.durationSeconds / 60).toFixed(1)} min, ${(temporaryStats.size / 1024 / 1024).toFixed(1)} MB.`);

async function findPython() {
  const candidates = [];
  if (process.env.EDGE_SPORT_PODCAST_PYTHON) candidates.push({ command: process.env.EDGE_SPORT_PODCAST_PYTHON, prefix: [] });
  if (process.platform === "win32" && process.env.USERPROFILE) candidates.push({ command: resolve(process.env.USERPROFILE, "anaconda3", "python.exe"), prefix: [] });
  candidates.push({ command: process.platform === "win32" ? "python.exe" : "python3", prefix: [] });
  for (const candidate of candidates) {
    if (candidate.command.includes("\\") || candidate.command.includes("/")) {
      try { await access(candidate.command); return candidate; } catch { continue; }
    }
    return candidate;
  }
  throw new Error("Python 3.11 with the ../tts Coqui runtime was not found. Set EDGE_SPORT_PODCAST_PYTHON.");
}

function run(command, commandArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd: rootDirectory, shell: false, windowsHide: true, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with ${code ?? 1}.`)));
  });
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

function relativePrivatePath(path) {
  return path.slice(rootDirectory.length + 1).replaceAll("\\", "/");
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
