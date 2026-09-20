import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { findCodexCommand } from "./lib/codex-cli.mjs";
import { validateYouTubeVideoPlan } from "./lib/youtube-video-plan.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const podcasts = JSON.parse(await readFile(resolve(rootDirectory, "content", "podcasts.json"), "utf8"));
const config = JSON.parse(await readFile(resolve(rootDirectory, "config", "podcast.json"), "utf8"));
const latestEpisode = [...(podcasts.episodes ?? [])].sort((left, right) => right.publishDate.localeCompare(left.publishDate))[0];
const id = args.get("id") ?? latestEpisode?.id;
const episode = podcasts.episodes?.find((item) => item.id === id && item.status === "published");
if (!episode) throw new Error(`Published podcast episode not found: ${id ?? "none"}.`);
const reportUrl = buildReportUrl(config, episode);
const codex = await findCodexCommand();
if (!codex) throw new Error("Codex CLI was not found. Install it and sign in before planning the YouTube video.");
console.log(`Using Codex CLI from ${codex.source}.`);

const outputDirectory = resolve(rootDirectory, "youtube-output");
const outputPath = resolve(outputDirectory, "edgeSport4Podcast-plan.json");
const modelOutputPath = resolve(outputDirectory, "edgeSport4Podcast-codex-output.json");
const schemaPath = resolve(outputDirectory, "edgeSport4Podcast-youtube-schema.json");
await mkdir(outputDirectory, { recursive: true });
await Promise.all([rm(modelOutputPath, { force: true }), writeDynamicSchema(schemaPath, episode)]);
const prompt = buildPrompt(episode, reportUrl);
const commandArgs = [
  ...codex.prefixArguments,
  "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
  "--sandbox", "read-only", "--cd", rootDirectory,
  "--output-schema", schemaPath, "--output-last-message", modelOutputPath, "--color", "never"
];
if (args.get("model")) commandArgs.push("--model", args.get("model"));
commandArgs.push("-");
const result = await runProcess(codex.executable, commandArgs, `${prompt}\n\n## VERIFIED PUBLIC PODCAST EPISODE\n${JSON.stringify(episode)}`);
if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Codex exited with ${result.exitCode}.`);
const plan = extractJsonObject(await readFile(modelOutputPath, "utf8"));
const validationErrors = validateYouTubeVideoPlan(plan, episode, { reportUrl });
if (validationErrors.length) throw new Error(`Codex YouTube plan failed validation:\n- ${validationErrors.join("\n- ")}`);
await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(`Created replaceable Codex YouTube plan: ${outputPath}`);

function buildPrompt(podcast, publicReportUrl) {
  const chapterStarts = podcast.chapters.map((chapter) => chapter.turnStart);
  const sources = podcast.researchSources.map((source) => `${source.title}: ${source.sourceUrl}`).join("\n");
  return `# edgeSport4Podcast YouTube upload plan

Return one JSON object only and obey the supplied schema. Plan a restrained, evidence-led YouTube podcast video whose primary value is the existing audio. The renderer will show clean static chapter cards and the exact timestamped transcript, so do not invent animation, stock footage, quotations or new research claims.

Requirements:
- Preserve the exact brand edgeSport4Podcast. The digit 4 means "for".
- Create a clear, non-clickbait YouTube title containing edgeSport4Podcast and staying within 100 characters.
- Write a useful description with a short episode summary, chapter timecodes from the episode, all original research URLs, the educational boundary and the synthetic Ying/Bing voice disclosure.
- Link the written report with this exact URL in both youtubeDescription and pinnedComment: ${publicReportUrl}
- Create exactly one visual segment for each chapter turn start: ${chapterStarts.join(", ")}.
- Headlines and supporting lines must summarize only the verified episode and remain readable on a static 1280x720 card.
- Ying is the female-voice evidence guide; Bing is the male-voice analytical partner.
- The video uses the full podcast audio and exact transcript. Do not rewrite captions.
- thumbnailHeadline should be informative rather than sensational.
- pinnedComment should invite evidence-focused discussion and link listeners back to the written report without offering personal medical advice.

Original research links that must all appear in youtubeDescription:
${sources}`;
}

function buildReportUrl(configData, podcast) {
  const base = String(configData?.publishing?.publicSiteBaseUrl ?? "");
  if (!/^https:\/\//u.test(base)) throw new Error("config.podcast.publishing.publicSiteBaseUrl must use HTTPS.");
  return `${base.replace(/\/?$/u, "/")}?report=${encodeURIComponent(podcast.sourceWeeklyReportId)}#weekly-reports`;
}

async function writeDynamicSchema(path, episode) {
  const schema = JSON.parse(await readFile(resolve(rootDirectory, "scripts", "schemas", "youtube-video-plan.schema.json"), "utf8"));
  const starts = episode.chapters.map((chapter) => chapter.turnStart);
  schema.properties.episodeId = { type: "string", const: episode.id };
  schema.properties.showName = { type: "string", const: episode.showName };
  schema.properties.segments.minItems = starts.length;
  schema.properties.segments.maxItems = starts.length;
  schema.$defs.segment.properties.chapterTurnStart = { type: "integer", enum: starts };
  await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}

function runProcess(command, commandArgs, stdinText) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd: rootDirectory, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.stdin.end(stdinText);
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => resolvePromise({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

function extractJsonObject(value) {
  const text = String(value ?? "").trim().replace(/^```json\s*/iu, "").replace(/\s*```$/u, "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error("Codex did not return JSON.");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  throw new Error("Codex returned incomplete JSON.");
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
