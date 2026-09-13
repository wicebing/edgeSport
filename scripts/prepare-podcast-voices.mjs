import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { preparePodcastVoices } from "./lib/podcast-voices.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(resolve(rootDirectory, "config", "podcast.json"), "utf8"));
const profiles = await preparePodcastVoices({ rootDirectory, config, ffmpegPath });
console.log(`Private podcast voice profiles ready: ${Object.values(profiles).map((profile) => profile.displayName).join(" + ")}.`);
