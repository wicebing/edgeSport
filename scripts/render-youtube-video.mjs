import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import ffmpegPath from "ffmpeg-static";
import { validateYouTubeVideoPlan } from "./lib/youtube-video-plan.mjs";

const WIDTH = 1280;
const HEIGHT = 720;
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArguments(process.argv.slice(2));
const podcasts = JSON.parse(await readFile(resolve(rootDirectory, "content", "podcasts.json"), "utf8"));
const config = JSON.parse(await readFile(resolve(rootDirectory, "config", "podcast.json"), "utf8"));
const latestEpisode = [...(podcasts.episodes ?? [])].sort((left, right) => right.publishDate.localeCompare(left.publishDate))[0];
const id = args.get("id") ?? latestEpisode?.id;
const episode = podcasts.episodes?.find((item) => item.id === id && item.status === "published");
if (!episode) throw new Error(`Published podcast episode not found: ${id ?? "none"}.`);
if (!ffmpegPath) throw new Error("The bundled ffmpeg executable is unavailable. Reinstall dependencies with npm install.");

const outputDirectory = resolve(rootDirectory, "youtube-output");
const framesDirectory = resolve(outputDirectory, "frames");
assertInsideOutput(framesDirectory);
await rm(framesDirectory, { recursive: true, force: true });
await mkdir(framesDirectory, { recursive: true });
const planPath = resolve(outputDirectory, "edgeSport4Podcast-plan.json");
const plan = JSON.parse(await readFile(planPath, "utf8"));
const reportUrl = `${String(config.publishing.publicSiteBaseUrl).replace(/\/?$/u, "/")}?report=${encodeURIComponent(episode.sourceWeeklyReportId)}#weekly-reports`;
const planErrors = validateYouTubeVideoPlan(plan, episode, { reportUrl });
if (planErrors.length) throw new Error(`YouTube plan is not renderable:\n- ${planErrors.join("\n- ")}`);

const baseName = `edgeSport4Podcast-${episode.id}`;
const videoPath = resolve(outputDirectory, `${baseName}.mp4`);
const temporaryVideoPath = resolve(outputDirectory, `${baseName}.tmp.mp4`);
const subtitlePath = resolve(outputDirectory, `${baseName}.srt`);
const thumbnailPath = resolve(outputDirectory, `${baseName}-thumbnail.png`);
const metadataPath = resolve(outputDirectory, `${baseName}-upload.txt`);
const manifestPath = resolve(outputDirectory, `${baseName}-manifest.json`);
const concatPath = resolve(outputDirectory, "frames.ffconcat");
const audioPath = resolve(rootDirectory, episode.audio.src);
const logo = await loadImage(resolve(rootDirectory, "assets", "yabilab-logo.png"));
const hosts = new Map(episode.hosts.map((host) => [host.id, host]));
const segmentByStart = new Map(plan.segments.map((segment) => [segment.chapterTurnStart, segment]));

const coverPath = resolve(framesDirectory, "frame-000-cover.png");
await writeFile(coverPath, renderCover({ episode, plan, logo }));
await writeFile(thumbnailPath, renderCover({ episode, plan, logo, thumbnail: true }));
const visualFrames = [{ path: coverPath, duration: Math.max(0.5, episode.transcript[0]?.startSeconds ?? 1.5) }];
let activeSegment = plan.segments[0];
for (let index = 0; index < episode.transcript.length; index += 1) {
  const turn = episode.transcript[index];
  activeSegment = segmentByStart.get(turn.turn) ?? activeSegment;
  const nextStart = episode.transcript[index + 1]?.startSeconds ?? episode.durationSeconds;
  const duration = Math.max(0.2, nextStart - turn.startSeconds);
  const framePath = resolve(framesDirectory, `frame-${String(turn.turn).padStart(3, "0")}.png`);
  await writeFile(framePath, renderTurn({ episode, plan, turn, host: hosts.get(turn.speaker), segment: activeSegment, logo, progress: (index + 1) / episode.transcript.length }));
  visualFrames.push({ path: framePath, duration });
}

await writeFile(subtitlePath, `${episode.transcript.map((turn, index) => renderSubtitle(index + 1, turn, hosts.get(turn.speaker)?.displayName ?? turn.speaker)).join("\n\n")}\n`, "utf8");
const concatLines = ["ffconcat version 1.0"];
for (const frame of visualFrames) {
  concatLines.push(`file '${escapeConcatPath(frame.path)}'`, `duration ${frame.duration.toFixed(3)}`);
}
concatLines.push(`file '${escapeConcatPath(visualFrames.at(-1).path)}'`);
await writeFile(concatPath, `${concatLines.join("\n")}\n`, "utf8");
await Promise.all([rm(temporaryVideoPath, { force: true }), rm(videoPath, { force: true })]);
await run(ffmpegPath, [
  "-hide_banner", "-loglevel", "warning", "-y",
  "-f", "concat", "-safe", "0", "-i", concatPath,
  "-i", audioPath,
  "-i", subtitlePath,
  "-map", "0:v:0", "-map", "1:a:0", "-map", "2:0",
  "-c:v", "libx264", "-preset", "medium", "-tune", "stillimage", "-crf", "31",
  "-r", "5", "-g", "50", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "96k",
  "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
  "-metadata", `title=${plan.youtubeTitle}`,
  "-t", String(episode.durationSeconds), "-movflags", "+faststart",
  temporaryVideoPath
]);
const videoStats = await stat(temporaryVideoPath);
if (videoStats.size < 100_000 || videoStats.size > 200 * 1024 * 1024) throw new Error(`YouTube video size is unexpected: ${videoStats.size} bytes.`);
await rename(temporaryVideoPath, videoPath);

await writeFile(metadataPath, renderUploadText(plan, episode, videoPath, subtitlePath, thumbnailPath), "utf8");
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  replacementPolicy: "youtube-output is replaceable and is not a permanent archive",
  episodeId: episode.id,
  durationSeconds: episode.durationSeconds,
  frameRate: 5,
  resolution: `${WIDTH}x${HEIGHT}`,
  bytes: videoStats.size,
  files: {
    video: relative(rootDirectory, videoPath).replaceAll("\\", "/"),
    subtitles: relative(rootDirectory, subtitlePath).replaceAll("\\", "/"),
    thumbnail: relative(rootDirectory, thumbnailPath).replaceAll("\\", "/"),
    uploadText: relative(rootDirectory, metadataPath).replaceAll("\\", "/")
  }
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`YouTube upload video ready: ${videoPath}`);
console.log(`Duration ${(episode.durationSeconds / 60).toFixed(1)} min, ${(videoStats.size / 1024 / 1024).toFixed(1)} MB, 1280x720 at 5 fps.`);
console.log(`Subtitles, thumbnail and upload copy are in ${outputDirectory}.`);

function renderCover({ episode: item, plan: videoPlan, logo: logoImage, thumbnail = false }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  paintBackground(context, "#102c27", "#1c5144", logoImage);
  label(context, "edgeSport4Podcast", 70, 78, "#b8d94d", 25);
  drawTextBlock(context, videoPlan.thumbnailHeadline, 70, 175, 920, thumbnail ? 68 : 61, 1.08, 4, "#ffffff", 800);
  context.fillStyle = "rgba(255,255,255,0.72)";
  context.font = "500 25px Arial";
  context.fillText(item.episodeSubtitle, 74, 520, 1080);
  context.fillStyle = "#ff8b6d";
  context.font = "700 20px Arial";
  context.fillText(`Ying · female voice    Bing · male voice    ${formatClock(item.durationSeconds)}`, 74, 585);
  if (!thumbnail) {
    context.fillStyle = "rgba(255,255,255,0.48)";
    context.font = "500 16px Arial";
    context.fillText("Evidence-led sports science · Full English transcript included", 74, 632);
  }
  return canvas.toBuffer("image/png");
}

function renderTurn({ episode: item, turn, host, segment, logo: logoImage, progress }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  const palette = accentPalette(segment?.accent);
  paintBackground(context, "#0f2925", palette.dark, logoImage);
  label(context, `edgeSport4Podcast  ·  ${item.id}`, 60, 58, palette.accent, 19);
  context.fillStyle = "rgba(255,255,255,0.58)";
  context.font = "600 16px Arial";
  context.fillText(segment?.headline ?? item.title, 60, 102, 1120);
  context.fillStyle = palette.accent;
  context.beginPath();
  context.arc(94, 174, 34, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#102c27";
  context.font = "800 30px Arial";
  context.textAlign = "center";
  context.fillText(host?.displayName ?? turn.speaker, 94, 185);
  context.textAlign = "left";
  context.fillStyle = "#ffffff";
  context.font = "700 18px Arial";
  context.fillText(host?.role ?? "Podcast speaker", 145, 167);
  context.fillStyle = "rgba(255,255,255,0.55)";
  context.font = "500 15px Arial";
  context.fillText(formatClock(turn.startSeconds), 145, 194);
  const fitted = fitText(context, turn.text, 1080, 10);
  drawLines(context, fitted.lines, 60, 276, fitted.lineHeight, "#ffffff", fitted.fontSize, 600);
  context.fillStyle = "rgba(255,255,255,0.07)";
  context.fillRect(60, 661, 1160, 6);
  context.fillStyle = palette.accent;
  context.fillRect(60, 661, 1160 * progress, 6);
  context.fillStyle = "rgba(255,255,255,0.45)";
  context.font = "500 13px Arial";
  context.fillText("Educational discussion · See the written report and original sources", 60, 695);
  return canvas.toBuffer("image/png");
}

function paintBackground(context, start, end, logoImage) {
  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.globalAlpha = 0.065;
  const logoWidth = 410;
  const logoHeight = logoWidth * (logoImage.height / logoImage.width);
  context.drawImage(logoImage, 820, 150, logoWidth, logoHeight);
  context.globalAlpha = 1;
}

function fitText(context, text, maxWidth, maxLines) {
  for (let fontSize = 35; fontSize >= 23; fontSize -= 2) {
    context.font = `600 ${fontSize}px Arial`;
    const lines = wrapLines(context, text, maxWidth);
    if (lines.length <= maxLines) return { lines, fontSize, lineHeight: Math.round(fontSize * 1.36) };
  }
  context.font = "600 21px Arial";
  return { lines: wrapLines(context, text, maxWidth), fontSize: 21, lineHeight: 29 };
}

function drawTextBlock(context, text, x, y, maxWidth, fontSize, lineMultiplier, maxLines, color, weight) {
  context.font = `${weight} ${fontSize}px Arial`;
  const lines = wrapLines(context, text, maxWidth).slice(0, maxLines);
  drawLines(context, lines, x, y, Math.round(fontSize * lineMultiplier), color, fontSize, weight);
}

function drawLines(context, lines, x, y, lineHeight, color, fontSize, weight) {
  context.fillStyle = color;
  context.font = `${weight} ${fontSize}px Arial`;
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
}

function wrapLines(context, text, maxWidth) {
  const words = String(text ?? "").split(/\s+/u).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

function label(context, text, x, y, color, size) {
  context.fillStyle = color;
  context.font = `800 ${size}px Arial`;
  context.fillText(text, x, y);
}

function accentPalette(name) {
  return ({
    lime: { accent: "#b8d94d", dark: "#173d34" },
    sky: { accent: "#54b3d1", dark: "#133b48" },
    coral: { accent: "#ff8b6d", dark: "#4d2a25" },
    mint: { accent: "#76d7b2", dark: "#17473b" },
    gold: { accent: "#f2c866", dark: "#4a3c1f" },
    violet: { accent: "#b8a2e8", dark: "#302947" }
  })[name] ?? { accent: "#b8d94d", dark: "#173d34" };
}

function renderSubtitle(index, turn, speaker) {
  const end = turn.startSeconds + turn.durationSeconds;
  return `${index}\n${srtTime(turn.startSeconds)} --> ${srtTime(end)}\n${speaker}: ${turn.text}`;
}

function srtTime(value) {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

function formatClock(value) {
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function renderUploadText(videoPlan, item, video, subtitles, thumbnail) {
  return `TITLE\n${videoPlan.youtubeTitle}\n\nDESCRIPTION\n${videoPlan.youtubeDescription}\n\nTAGS\n${videoPlan.tags.join(", ")}\n\nPINNED COMMENT\n${videoPlan.pinnedComment}\n\nDISCLOSURE\n${videoPlan.disclosure}\n\nFILES\nVideo: ${video}\nSubtitles: ${subtitles}\nThumbnail: ${thumbnail}\nEpisode: ${item.id}\n`;
}

function escapeConcatPath(path) {
  return path.replaceAll("\\", "/").replaceAll("'", "'\\''");
}

function assertInsideOutput(path) {
  if (!path.startsWith(`${outputDirectory}${sep}`)) throw new Error(`Unsafe YouTube output path: ${path}`);
}

function run(command, commandArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, { cwd: rootDirectory, shell: false, windowsHide: true, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with ${code ?? 1}.`)));
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
