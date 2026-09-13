from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
import re
import sys
from math import gcd
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Render EDGE SPORT 4 Podcast dialogue with local voices.")
    parser.add_argument("--draft", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--master", required=True)
    parser.add_argument("--timings", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--host-wav", required=True)
    parser.add_argument("--cohost-wav", required=True)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    args = parser.parse_args()

    draft_path = Path(args.draft).resolve()
    config_path = Path(args.config).resolve()
    project_root = config_path.parent.parent
    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    config = json.loads(config_path.read_text(encoding="utf-8"))
    tts_root = (project_root / config["tts"]["root"]).resolve()
    vendor = tts_root / "vendor_coqui311"
    if not vendor.exists():
        raise FileNotFoundError(f"Coqui runtime not found: {vendor}")
    sys.path.insert(0, str(vendor))
    os.environ.setdefault("TTS_HOME", str(tts_root / "coqui_models"))

    import numpy as np
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly

    sample_rate = int(config["tts"].get("sampleRate", 24000))
    work_dir = Path(args.work_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    master_path = Path(args.master).resolve()
    master_path.parent.mkdir(parents=True, exist_ok=True)
    timings_path = Path(args.timings).resolve()
    timings_path.parent.mkdir(parents=True, exist_ok=True)
    device = select_device(torch, args.device)
    print(f"Podcast renderer device: {device}", flush=True)

    rendered: dict[int, Path] = {}
    host_turns = [turn for turn in draft["dialogue"] if turn["speaker"] == "host"]
    cohost_turns = [turn for turn in draft["dialogue"] if turn["speaker"] == "cohost"]
    render_host_turns(host_turns, rendered, work_dir, config, device, torch, Path(args.host_wav).resolve())
    release_gpu(torch)
    render_cohost_turns(cohost_turns, rendered, work_dir, config, device, torch, Path(args.cohost_wav).resolve())
    release_gpu(torch)

    audio_parts: list[np.ndarray] = [make_chime(np, sample_rate, ascending=True), np.zeros(int(sample_rate * 0.32), dtype=np.float32)]
    timeline: list[dict] = []
    elapsed_samples = sum(len(part) for part in audio_parts)
    previous_speaker = None
    for turn in draft["dialogue"]:
        wav, source_rate = read_mono(sf, np, rendered[turn["turn"]])
        wav = resample(np, resample_poly, wav, source_rate, sample_rate)
        wav = clean_segment(np, wav, sample_rate)
        start_seconds = elapsed_samples / sample_rate
        audio_parts.append(wav)
        elapsed_samples += len(wav)
        timeline.append({
            "turn": turn["turn"],
            "speaker": turn["speaker"],
            "startSeconds": round(start_seconds, 3),
            "durationSeconds": round(len(wav) / sample_rate, 3),
            "chunk": rendered[turn["turn"]].name,
        })
        pause = float(config["tts"].get(
            "pauseSpeakerChangeSeconds" if previous_speaker and previous_speaker != turn["speaker"] else "pauseSameSpeakerSeconds",
            0.36,
        ))
        if turn["text"].rstrip().endswith(("?", "!")):
            pause += 0.08
        silence = np.zeros(int(sample_rate * pause), dtype=np.float32)
        audio_parts.append(silence)
        elapsed_samples += len(silence)
        previous_speaker = turn["speaker"]

    audio_parts.extend([np.zeros(int(sample_rate * 0.28), dtype=np.float32), make_chime(np, sample_rate, ascending=False)])
    combined = np.concatenate(audio_parts).astype(np.float32)
    peak = float(np.max(np.abs(combined))) if len(combined) else 0.0
    if peak > 0.97:
        combined *= 0.97 / peak
    sf.write(master_path, combined, sample_rate, subtype="PCM_16")
    metadata = {
        "schemaVersion": 1,
        "id": draft["id"],
        "sampleRate": sample_rate,
        "durationSeconds": round(len(combined) / sample_rate, 3),
        "masterPath": str(master_path),
        "turns": timeline,
        "voices": {
            "host": {"engine": config["hosts"]["host"]["engine"], "profile": "private-local-girl-voice"},
            "cohost": {"engine": config["hosts"]["cohost"]["engine"], "profile": "private-local-man-voice"},
        },
    }
    timings_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote master: {master_path}", flush=True)
    print(f"Duration: {metadata['durationSeconds']:.1f} seconds", flush=True)


def render_host_turns(turns, rendered, work_dir, config, device, torch, speaker_path: Path) -> None:
    if not speaker_path.exists():
        raise FileNotFoundError(f"Y girl-voice profile not found: {speaker_path}")
    voice_digest = file_digest(speaker_path)
    missing = []
    for turn in turns:
        path = chunk_path(work_dir, turn, voice_digest)
        rendered[turn["turn"]] = path
        if not path.exists():
            missing.append((turn, path))
    if not missing:
        print("Reusing all host chunks.", flush=True)
        return

    from TTS.api import TTS

    print(f"Loading XTTS v2 Y girl voice for {len(missing)} turns...", flush=True)
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False, gpu=device == "cuda")
    model.to(device)
    for position, (turn, path) in enumerate(missing, start=1):
        print(f"Y [{position}/{len(missing)}] turn {turn['turn']}", flush=True)
        model.tts_to_file(
            text=normalize_for_speech(turn["text"]),
            speaker_wav=str(speaker_path),
            language="en",
            file_path=str(path),
            split_sentences=True,
        )
    del model


def render_cohost_turns(turns, rendered, work_dir, config, device, torch, speaker_path: Path) -> None:
    if not speaker_path.exists():
        raise FileNotFoundError(f"B man-voice profile not found: {speaker_path}")
    voice_digest = file_digest(speaker_path)
    missing = []
    for turn in turns:
        path = chunk_path(work_dir, turn, voice_digest)
        rendered[turn["turn"]] = path
        if not path.exists():
            missing.append((turn, path))
    if not missing:
        print("Reusing all co-host chunks.", flush=True)
        return

    from TTS.api import TTS

    print(f"Loading XTTS v2 B man voice for {len(missing)} turns...", flush=True)
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False, gpu=device == "cuda")
    model.to(device)
    for position, (turn, path) in enumerate(missing, start=1):
        print(f"B [{position}/{len(missing)}] turn {turn['turn']}", flush=True)
        model.tts_to_file(
            text=normalize_for_speech(turn["text"]),
            speaker_wav=str(speaker_path),
            language="en",
            file_path=str(path),
            split_sentences=True,
        )
    del model


def normalize_for_speech(text: str) -> str:
    replacements = {
        "ACL": "A C L",
        "CMJ": "C M J",
        "MRI": "M R I",
        "BMI": "B M I",
        "VO2": "V O two",
        "HRV": "H R V",
        "RPE": "R P E",
        "PMID": "P M I D",
    }
    for source, target in replacements.items():
        text = re.sub(rf"\b{re.escape(source)}\b", target, text)
    text = text.replace("—", ", ").replace("–", " to ").replace("%", " percent")
    return re.sub(r"\s+", " ", text).strip()


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def chunk_path(work_dir: Path, turn: dict, voice_digest: str) -> Path:
    payload = f"{voice_digest}\0{turn['text']}".encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:12]
    return work_dir / f"turn_{turn['turn']:03d}_{turn['speaker']}_{digest}.wav"


def read_mono(sf, np, path: Path):
    wav, sample_rate = sf.read(path, always_2d=True)
    return wav.mean(axis=1).astype(np.float32), int(sample_rate)


def resample(np, resample_poly, wav, source_rate: int, target_rate: int):
    if source_rate == target_rate:
        return wav
    divisor = gcd(source_rate, target_rate)
    return resample_poly(wav, target_rate // divisor, source_rate // divisor).astype(np.float32)


def clean_segment(np, wav, sample_rate: int):
    if not len(wav):
        return wav
    wav = wav - float(np.mean(wav))
    active = np.abs(wav) > 0.012
    rms = float(np.sqrt(np.mean(np.square(wav[active])))) if np.any(active) else float(np.sqrt(np.mean(np.square(wav))))
    target_rms = 10 ** (-19.0 / 20.0)
    if rms > 0:
        wav = wav * min(3.0, target_rms / rms)
    peak = float(np.max(np.abs(wav)))
    if peak > 0.92:
        wav *= 0.92 / peak
    fade = min(int(sample_rate * 0.025), len(wav) // 2)
    if fade:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        wav[:fade] *= ramp
        wav[-fade:] *= ramp[::-1]
    return wav.astype(np.float32)


def make_chime(np, sample_rate: int, ascending: bool):
    duration = 1.25
    samples = int(sample_rate * duration)
    time = np.arange(samples, dtype=np.float32) / sample_rate
    frequencies = (523.25, 659.25, 783.99) if ascending else (783.99, 659.25, 523.25)
    signal = np.zeros(samples, dtype=np.float32)
    for index, frequency in enumerate(frequencies):
        start = int(index * sample_rate * 0.18)
        local = time[: samples - start]
        envelope = np.exp(-3.1 * local)
        signal[start:] += np.sin(2 * np.pi * frequency * local) * envelope * 0.055
    fade = min(int(sample_rate * 0.04), samples // 2)
    signal[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
    signal[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
    return signal


def select_device(torch, requested: str) -> str:
    if requested == "cpu":
        return "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is unavailable.")
    return "cuda" if requested == "cuda" or torch.cuda.is_available() else "cpu"


def release_gpu(torch) -> None:
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
