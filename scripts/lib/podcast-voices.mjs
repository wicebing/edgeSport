import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const PROFILE_VERSION = 1;

export async function preparePodcastVoices({ rootDirectory, config, ffmpegPath }) {
  if (!ffmpegPath) throw new Error("The bundled ffmpeg executable is unavailable. Reinstall dependencies with npm install.");
  const outputDirectory = resolve(rootDirectory, "research-library", "podcast-voices");
  await mkdir(outputDirectory, { recursive: true });
  const profiles = {};

  for (const [speakerId, host] of Object.entries(config.hosts ?? {})) {
    if (!host?.speakerAudio) throw new Error(`Podcast ${speakerId} must define hosts.${speakerId}.speakerAudio.`);
    const sourcePath = resolve(rootDirectory, host.speakerAudio);
    await access(sourcePath).catch(() => { throw new Error(`Podcast ${speakerId} source voice was not found: ${sourcePath}`); });
    const sourceBytes = await readFile(sourcePath);
    const checksum = createHash("sha256").update(sourceBytes).digest("hex");
    const profilePath = resolve(outputDirectory, `v${PROFILE_VERSION}-${speakerId}-${checksum.slice(0, 12)}.wav`);

    if (!await exists(profilePath)) {
      console.log(`Preparing private ${host.displayName} voice profile from ${host.speakerAudio}...`);
      await run(ffmpegPath, [
        "-hide_banner", "-loglevel", "warning", "-y",
        "-i", sourcePath,
        "-vn", "-ac", "1", "-ar", String(config.tts.sampleRate),
        "-af", "highpass=f=65,lowpass=f=11000,loudnorm=I=-23:TP=-3:LRA=12",
        "-codec:a", "pcm_s16le",
        profilePath
      ], rootDirectory);
    }
    const details = await stat(profilePath);
    if (details.size < 10_000) throw new Error(`Prepared ${speakerId} voice profile is unexpectedly small.`);
    profiles[speakerId] = {
      id: speakerId,
      displayName: host.displayName,
      role: host.role,
      engine: host.engine,
      sourceChecksum: checksum,
      speakerWav: profilePath,
      bytes: details.size
    };
  }

  const manifest = {
    schemaVersion: 1,
    profileVersion: PROFILE_VERSION,
    preparedAt: new Date().toISOString(),
    sampleRate: config.tts.sampleRate,
    profiles
  };
  await writeFile(resolve(outputDirectory, "voice-profiles.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return profiles;
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: "inherit" });
    child.on("error", rejectPromise);
    child.on("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with ${code ?? 1}.`)));
  });
}
