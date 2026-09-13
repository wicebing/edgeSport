import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { validatePodcastScript } from "./lib/podcast-schema.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const id = args.get("id");
if (!/^\d{4}-w\d{2}$/u.test(id ?? "")) throw new Error("--id must use YYYY-wNN.");
const packetPath = resolve(rootDirectory, args.get("packet") ?? `research-library/podcast-packets/${id}.json`);
const outputPath = resolve(rootDirectory, args.get("output") ?? `research-library/podcast-drafts/${id}.json`);
const packet = JSON.parse(await readFile(packetPath, "utf8"));
if (packet.id !== id) throw new Error(`Podcast packet belongs to ${packet.id}, not ${id}.`);
const codex = await findCodexCommand();
if (!codex) throw new Error("Codex CLI was not found. Install it and sign in before generating the podcast script.");

const schemaPath = await createDynamicSchema(packet);
const outputDirectory = resolve(rootDirectory, "research-library", "podcast-drafts");
const modelOutputPath = resolve(outputDirectory, `${id}.codex-output.json`);
await mkdir(outputDirectory, { recursive: true });
await rm(modelOutputPath, { force: true });
const prompt = buildPrompt(packet);
const commandArgs = [
  ...codex.prefixArguments,
  "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
  "--sandbox", "read-only", "--cd", rootDirectory,
  "--output-schema", schemaPath, "--output-last-message", modelOutputPath, "--color", "never"
];
if (args.get("model")) commandArgs.push("--model", args.get("model"));
commandArgs.push("-");
const result = await runProcess(codex.executable, commandArgs, `${prompt}\n\n## PRIVATE PODCAST PACKET\n${JSON.stringify(packet)}`);
if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Codex exited with ${result.exitCode}.`);
const draft = extractJsonObject(await readFile(modelOutputPath, "utf8"));
const sourceRecordIds = packet.weeklyReport.researchSources.map((source) => source.recordId);
const validationErrors = validatePodcastScript(draft, { sourceRecordIds });
if (draft.id !== id || draft.sourceWeeklyReportId !== id) validationErrors.push("Podcast IDs must match the packet weekly report.");
if (validationErrors.length > 0) throw new Error(`Codex podcast script failed validation:\n- ${validationErrors.join("\n- ")}`);
await writeFile(outputPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
console.log(`Created private Codex podcast script: ${outputPath}`);

function buildPrompt(packetData) {
  const sourceIds = packetData.weeklyReport.researchSources.map((source) => source.recordId);
  const minimum = packetData.show.targetMinutes.minimum;
  const maximum = packetData.show.targetMinutes.maximum;
  return `# EDGE SPORT 4 Podcast — English dialogue script

You are the evidence editor and podcast writer for EDGE SPORT. Return one JSON object only and obey the supplied schema.

Write a relaxed, humane, intellectually honest English conversation between Y (girl-voice evidence guide, schema speaker ID host) and B (man-voice analytical partner, schema speaker ID cohost). The tone is clean, comfortable, curious and evidence-literate—not a lecture, advertisement, radio drama or rapid-fire news roundup.

Editorial requirements:
- Base every research claim only on weeklyReport. Use relatedIssues only for explicitly labeled historical context.
- Cover all research sources: ${sourceIds.join(", ")}.
- Aim for ${minimum}-${maximum} spoken minutes and 1,400-2,700 words across 26-50 mostly alternating turns.
- Each turn must sound natural aloud, use contractions where suitable, and stay under 760 characters for stable TTS.
- Make this a genuinely mutual discussion. Y and B must both ask substantive questions, answer, explain evidence, introduce viewpoints, challenge overreach and refine the practical conclusion. Do not make B merely interview Y or make Y deliver a continuous lecture.
- Open with a human hook and the week's central question. Explain definitions, methods, important numbers, practical meaning, limitations and what would change a decision.
- Let the co-host ask the questions an intelligent coach, clinician or athlete would actually ask. Let the host correct overreach gently.
- Do not invent risk percentages, thresholds, dosages, recovery timelines, diagnoses or return-to-play criteria.
- Put supporting research IDs in evidenceSourceIds for factual turns. Transitions may use an empty array.
- factCheck must preserve the main quantitative claims and evidence boundaries.
- Use the exact host IDs host and cohost. Display names must be ${packetData.show.hosts.host.displayName} and ${packetData.show.hosts.cohost.displayName}.
- disclosure must clearly say the speech is synthetic, Y is locally generated from the supplied girl-voice sample, B is locally generated from the supplied man-voice sample, and the episode is educational.
- Keep editorReview unapproved.`;
}

async function createDynamicSchema(packetData) {
  const schema = JSON.parse(await readFile(resolve(rootDirectory, "scripts", "schemas", "podcast-script.schema.json"), "utf8"));
  const sourceIds = packetData.weeklyReport.researchSources.map((source) => source.recordId);
  schema.properties.id = { type: "string", const: packetData.id };
  schema.properties.publishDate = { type: "string", const: packetData.publishDate };
  schema.properties.showName = { type: "string", const: packetData.show.name };
  schema.properties.sourceWeeklyReportId = { type: "string", const: packetData.id };
  schema.properties.sourceRecordIds.items = { type: "string", enum: sourceIds };
  schema.$defs.dialogueTurn.properties.evidenceSourceIds.items = { type: "string", enum: sourceIds };
  schema.$defs.factCheck.properties.evidenceSourceIds.items = { type: "string", enum: sourceIds };
  const path = resolve(rootDirectory, "research-library", "podcast-packets", `${packetData.id}.schema.json`);
  await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  return path;
}

async function findCodexCommand() {
  if (process.env.EDGE_SPORT_CODEX_PATH && await exists(process.env.EDGE_SPORT_CODEX_PATH)) return { executable: process.env.EDGE_SPORT_CODEX_PATH, prefixArguments: [] };
  for (const directory of String(process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const path = resolve(directory, process.platform === "win32" ? "codex.exe" : "codex");
    if (await exists(path)) return { executable: path, prefixArguments: [] };
  }
  return null;
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

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
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
