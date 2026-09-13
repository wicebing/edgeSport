import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePodcastScript, validatePublishedPodcast } from "./lib/podcast-schema.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const id = args.get("id");
if (!/^\d{4}-w\d{2}$/u.test(id ?? "")) throw new Error("--id must use YYYY-wNN.");
const draftPath = resolve(rootDirectory, args.get("draft") ?? `research-library/podcast-drafts/${id}.json`);
const renderPath = resolve(rootDirectory, args.get("render") ?? `research-library/podcast-audio/${id}/${id}-render.json`);
const contentPath = resolve(rootDirectory, "content", "podcasts.json");
const reportsPath = resolve(rootDirectory, "content", "weekly-reports.json");
const [draft, render, podcasts, reports] = await Promise.all([readJson(draftPath), readJson(renderPath), readJson(contentPath), readJson(reportsPath)]);
const report = reports.reports.find((item) => item.id === id && item.status === "published");
if (!report) throw new Error(`Published weekly report not found: ${id}.`);
if (draft.id !== id || render.id !== id) throw new Error("Podcast draft and render IDs must match --id.");
const sourceRecordIds = report.researchSources.map((source) => source.recordId);
const errors = validatePodcastScript(draft, { sourceRecordIds });
if (errors.length) throw new Error(`Podcast draft failed validation:\n- ${errors.join("\n- ")}`);

const audioPath = resolve(rootDirectory, render.audioPath);
const audioStats = await stat(audioPath);
if (audioStats.size !== render.bytes) throw new Error("Rendered MP3 size no longer matches its private render record.");
const timingByTurn = new Map(render.turns.map((turn) => [turn.turn, turn]));
const wordCount = draft.dialogue.reduce((count, turn) => count + turn.text.trim().split(/\s+/u).filter(Boolean).length, 0);
const episode = {
  schemaVersion: 1,
  id,
  status: "published",
  publishDate: draft.publishDate,
  showName: draft.showName,
  title: draft.episodeTitle,
  episodeSubtitle: draft.episodeSubtitle,
  summary: draft.summary,
  language: draft.language,
  estimatedMinutes: draft.estimatedMinutes,
  durationSeconds: render.durationSeconds,
  wordCount,
  hosts: draft.hosts,
  sourceWeeklyReportId: id,
  sourceRecordIds: draft.sourceRecordIds,
  learningGoals: draft.learningGoals,
  showNotes: draft.showNotes,
  chapters: draft.chapters.map((chapter) => ({ ...chapter, startSeconds: timingByTurn.get(chapter.turnStart)?.startSeconds ?? 0 })),
  transcript: draft.dialogue.map((turn) => ({
    ...turn,
    startSeconds: timingByTurn.get(turn.turn)?.startSeconds ?? 0,
    durationSeconds: timingByTurn.get(turn.turn)?.durationSeconds ?? 0
  })),
  factCheck: draft.factCheck,
  closingTakeaways: draft.closingTakeaways,
  disclosure: draft.disclosure,
  editorReview: draft.editorReview,
  publicationMode: "automated",
  automationProvider: "codex",
  renderedAt: render.renderedAt,
  publishedAt: new Date().toISOString(),
  audio: {
    src: render.audioPath,
    mimeType: "audio/mpeg",
    bytes: render.bytes,
    bitrate: render.bitrate,
    sampleRate: render.sampleRate
  },
  researchSources: report.researchSources.map((source) => ({
    recordId: source.recordId,
    title: source.title,
    journal: source.journal,
    publicationDate: source.publicationDate,
    sourceUrl: source.sourceUrl,
    contentLevel: source.contentLevel
  }))
};
const publicErrors = validatePublishedPodcast(episode, { sourceRecordIds });
if (publicErrors.length) throw new Error(`Published podcast failed validation:\n- ${publicErrors.join("\n- ")}`);
podcasts.show = {
  ...(podcasts.show ?? {}),
  name: draft.showName,
  tagline: podcasts.show?.tagline ?? "Human conversations about evidence, performance, and sports medicine.",
  language: draft.language
};
podcasts.episodes = [...(podcasts.episodes ?? []).filter((item) => item.id !== id), episode]
  .sort((left, right) => right.publishDate.localeCompare(left.publishDate));
await writeFile(contentPath, `${JSON.stringify(podcasts, null, 2)}\n`, "utf8");
await pruneUnreferencedAudio(podcasts);
await import("./build-knowledge-index.mjs");
console.log(`Published podcast ${id} to ${contentPath}.`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function pruneUnreferencedAudio(podcastData) {
  const directory = resolve(rootDirectory, "assets", "podcasts");
  const referenced = new Set((podcastData.episodes ?? []).map((item) => basename(item.audio.src)));
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{4}-w\d{2}(?:-[a-f0-9]{12})?\.mp3$/u.test(entry.name) || referenced.has(entry.name)) continue;
    try {
      await rm(resolve(directory, entry.name));
      console.log(`Removed superseded local podcast audio: ${entry.name}`);
    } catch (error) {
      console.warn(`Could not remove superseded podcast audio ${entry.name}: ${error.code ?? error.message}. It is not referenced by the site.`);
    }
  }
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
