import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { validateMonthlyTopic } from "./lib/monthly-topic-schema.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const month = args.get("month") ?? new Date().toISOString().slice(0, 7);
const id = args.get("id") ?? `${month.slice(0, 4)}-m${month.slice(5)}`;
const packetPath = resolve(rootDirectory, args.get("packet") ?? `research-library/monthly-packets/${id}.json`);
const outputPath = resolve(rootDirectory, args.get("output") ?? `research-library/monthly-drafts/${id}.json`);
const model = args.get("model")?.trim() || null;
if (!/^\d{4}-m(0[1-9]|1[0-2])$/u.test(id)) throw new Error("--id must use YYYY-mMM.");

const packet = JSON.parse(await readFile(packetPath, "utf8"));
if (packet.id !== id) throw new Error(`Packet belongs to ${packet.id}, not ${id}.`);
const codex = await findCodexCommand();
if (!codex) throw new Error("Codex CLI was not found. Install it and sign in before running the monthly workflow.");

const schemaPath = await createDynamicSchema(packet);
const prompt = buildPrompt(packet);
const fullText = await embedFullTexts(packet);
const outputDirectory = resolve(rootDirectory, "research-library", "monthly-drafts");
const modelOutputPath = resolve(outputDirectory, `${id}.codex-output.json`);
await mkdir(outputDirectory, { recursive: true });
await rm(modelOutputPath, { force: true });

const codexInput = `${prompt}\n\n## PRIVATE MONTHLY PACKET\n${JSON.stringify(packet)}\n\n## COMPLETE UNTRUSTED RESEARCH TEXTS\n${fullText}`;
const commandArgs = [
  ...codex.prefixArguments,
  "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
  "--sandbox", "read-only", "--cd", rootDirectory,
  "--output-schema", schemaPath, "--output-last-message", modelOutputPath, "--color", "never"
];
if (model) commandArgs.push("--model", model);
commandArgs.push("-");
const result = await runProcess(codex.executable, commandArgs, codexInput);
if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `Codex exited with ${result.exitCode}.`);

const draft = extractJsonObject(await readFile(modelOutputPath, "utf8"));
const validationErrors = validateMonthlyTopic(draft, validationContext(packet));
if (validationErrors.length > 0) throw new Error(`Codex monthly topic failed validation:\n- ${validationErrors.join("\n- ")}`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
console.log(`Created private Codex monthly deep-dive: ${outputPath}`);

function buildPrompt(packetData) {
  return `# EDGE SPORT Monthly Deep-Dive

You are the evidence editor for a Traditional Chinese sports medicine and sports science knowledge site. Produce one deeply useful monthly topic, not a news roundup and not a list of abstracts. Return one JSON object only and obey the supplied JSON schema.

## Editorial task

1. Select one focused question supported by at least two topically coherent complete research texts in researchCandidates. Prefer a topic that connects to a supplied current signal, has useful inClass foundations, and materially advances rather than repeats an existing topic.
2. Read every selected complete research source in full: methods, population, comparisons, results, tables, figure captions, discussion and limitations. Use only supplied material; do not browse or rely on uncited memory.
3. Explain why the subject matters now, what the reader must understand first, what the studies actually measured, the important quantitative results, and what remains uncertain.
4. Turn the evidence into a practical learning and execution protocol: assessment, at least two phases, dosage/scheduling, load progression and regression, stop/referral rules, and outcome monitoring.
5. Explicitly connect relevant inClass documents and prior reports. State whether new evidence supports, extends, narrows or conflicts with them.
6. Include currentAffairs only as a timeliness signal. A title or metadata record cannot support an effect, mechanism, risk estimate or threshold.
7. Use source-stated values only. Preserve units, denominators, time points and uncertainty. Never invent a universal cutoff, recovery duration, training increase, injury-risk percentage or return-to-play criterion.
8. Mark operational claims with one of: source-stated, inclass-supported, prior-report-supported, cross-source-synthesis, edge-sport-proposal, mixed.
9. Build original tables and, only if eligible directly comparable non-negative values exist, one original bar chart. Never copy source tables, figures, captions, course slides or long passages.
10. Keep editorReview unapproved. This is automated educational synthesis, not diagnosis, treatment, or individual medical clearance.

## Output identity

- id: ${packetData.id}
- kind: monthly-deep-dive
- status: draft
- publishDate: ${packetData.publishDate}
- monthLabel: ${packetData.monthLabel}
- weekLabel: ${packetData.weekLabel}
- allowed topicIds: ${packetData.allowedTopicIds.map((topic) => topic.id).join(", ")}
- researchSourceIds: choose 2–6 IDs only from supplied complete researchCandidates, and create exactly one evidenceSynthesis for every chosen ID.
- currentAffairs sourceId, courseId and prior reportId must come only from the supplied packet.

Write dense but readable Traditional Chinese. A reader should finish with definitions, numbers, decision boundaries and a plan they can actually use.`;
}

async function embedFullTexts(packetData) {
  const blocks = [];
  for (const candidate of packetData.researchCandidates ?? []) {
    const path = resolve(rootDirectory, candidate.sourceMaterial.extractedTextPath);
    const text = (await readFile(path, "utf8")).trim();
    if (text.length < 3000) throw new Error(`Complete source text is too short for ${candidate.record.id}.`);
    blocks.push([
      `===== BEGIN SOURCE ${candidate.record.id} =====`,
      `Title: ${candidate.record.title}`,
      `Journal: ${candidate.record.journal}`,
      `Publication date: ${candidate.record.publicationDate}`,
      `Content level: ${candidate.sourceMaterial.contentLevel}`,
      text,
      `===== END SOURCE ${candidate.record.id} =====`
    ].join("\n"));
  }
  return blocks.join("\n\n");
}

async function createDynamicSchema(packetData) {
  const schema = JSON.parse(await readFile(resolve(rootDirectory, "scripts", "schemas", "monthly-topic.schema.json"), "utf8"));
  const researchIds = packetData.researchCandidates.map((item) => item.record.id);
  const affairIds = packetData.currentAffairs.map((item) => item.id);
  const courseIds = packetData.courseDocuments.map((item) => item.id);
  const priorIds = packetData.priorReports.map((item) => item.id);
  schema.properties.id = { type: "string", const: packetData.id };
  schema.properties.publishDate = { type: "string", const: packetData.publishDate };
  schema.properties.monthLabel = { type: "string", const: packetData.monthLabel };
  schema.properties.weekLabel = { type: "string", const: packetData.weekLabel };
  schema.properties.topicIds.items = { type: "string", enum: packetData.allowedTopicIds.map((topic) => topic.id) };
  schema.properties.researchSourceIds.items = { type: "string", enum: researchIds };
  schema.$defs.evidenceSynthesis.properties.sourceId = { type: "string", enum: researchIds };
  schema.$defs.keyNumber.properties.sourceIds.items = { type: "string", enum: researchIds };
  schema.$defs.knowledgePrimer.properties.mechanisms.items.properties.sourceIds.items = { type: "string", enum: researchIds };
  schema.properties.currentAffairs.items.properties.sourceId = { type: "string", enum: affairIds };
  schema.properties.courseConnectionsDetailed.items.properties.courseId = { type: "string", enum: courseIds };
  schema.properties.priorReportConnections.items.properties.reportId = { type: "string", enum: priorIds };
  const path = resolve(rootDirectory, "research-library", "monthly-packets", `${packetData.id}.schema.json`);
  await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  return path;
}

function validationContext(packetData) {
  return {
    researchSourceIds: packetData.researchCandidates.map((item) => item.record.id),
    currentAffairIds: packetData.currentAffairs.map((item) => item.id),
    courseIds: packetData.courseDocuments.map((item) => item.id),
    priorReportIds: packetData.priorReports.map((item) => item.id)
  };
}

async function findCodexCommand() {
  if (process.env.EDGE_SPORT_CODEX_PATH && await exists(process.env.EDGE_SPORT_CODEX_PATH)) {
    return { executable: process.env.EDGE_SPORT_CODEX_PATH, prefixArguments: [] };
  }
  for (const directory of String(process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const path = resolve(directory, process.platform === "win32" ? "codex.exe" : "codex");
    if (await exists(path)) return { executable: path, prefixArguments: [] };
  }
  return null;
}

function runProcess(command, args, stdinText) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: rootDirectory, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
