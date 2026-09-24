"""ffmpeg invocations used by the processing worker.

Inputs are raw PCM16 mono produced by `assemble.py`. Chunks for speech
recognition are cut in Python at exact sample offsets, so every chunk's start
time on the media clock is known precisely.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

FFMPEG = "ffmpeg"
# Chirp 3 returns word timestamps for files up to 20 minutes; stay well below.
STT_CHUNK_SECONDS = 15 * 60


class FfmpegError(RuntimeError):
    pass


async def run_ffmpeg(args: list[str], *, timeout_s: float = 900) -> None:
    process = await asyncio.create_subprocess_exec(
        FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_s)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise FfmpegError("ffmpeg timed out") from None
    if process.returncode != 0:
        raise FfmpegError(f"ffmpeg failed ({process.returncode}): {stderr.decode(errors='replace')[-500:]}")


async def decode_to_pcm16(data: bytes, sample_rate: int, *, timeout_s: float = 300) -> bytes:
    """Any audio ffmpeg reads (a FLAC chunk, say) as raw PCM16 mono at `sample_rate`."""
    process = await asyncio.create_subprocess_exec(
        FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        "1",
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        pcm, stderr = await asyncio.wait_for(process.communicate(data), timeout=timeout_s)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise FfmpegError("ffmpeg timed out") from None
    if process.returncode != 0:
        raise FfmpegError(f"ffmpeg failed ({process.returncode}): {stderr.decode(errors='replace')[-500:]}")
    return pcm


@dataclass(frozen=True)
class FlacChunk:
    path: Path
    offset_ms: int
    duration_ms: int


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


async def pcm_to_flac_chunks(
    pcm: bytes, sample_rate: int, out_dir: Path, *, chunk_seconds: int = STT_CHUNK_SECONDS
) -> list[FlacChunk]:
    bytes_per_chunk = chunk_seconds * sample_rate * 2
    chunks: list[FlacChunk] = []
    for index, start in enumerate(range(0, len(pcm), bytes_per_chunk)):
        piece = pcm[start : start + bytes_per_chunk]
        raw = out_dir / f"chunk-{index:03d}.pcm"
        flac = out_dir / f"chunk-{index:03d}.flac"
        await asyncio.to_thread(_write, raw, piece)
        await run_ffmpeg(
            ["-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", str(raw), "-c:a", "flac", str(flac)]
        )
        await asyncio.to_thread(raw.unlink, True)
        offset_ms = (start // 2) * 1000 // sample_rate
        chunks.append(FlacChunk(flac, offset_ms, (len(piece) // 2) * 1000 // sample_rate))
    return chunks


async def mix_to_m4a(
    candidate_pcm: Path, candidate_rate: int, interviewer_pcm: Path | None, interviewer_rate: int, out: Path
) -> None:
    """Both voices on one track for playback and download."""
    args = ["-f", "s16le", "-ar", str(candidate_rate), "-ac", "1", "-i", str(candidate_pcm)]
    has_interviewer = interviewer_pcm is not None and (await asyncio.to_thread(interviewer_pcm.stat)).st_size > 0
    if interviewer_pcm is not None and has_interviewer:
        args += ["-f", "s16le", "-ar", str(interviewer_rate), "-ac", "1", "-i", str(interviewer_pcm)]
        args += [
            "-filter_complex",
            "[0:a]aresample=24000[a0];[a0][1:a]amix=inputs=2:duration=longest:normalize=0[out]",
            "-map",
            "[out]",
        ]
    args += ["-c:a", "aac", "-b:a", "64k", "-ar", "24000", "-ac", "1", "-movflags", "+faststart", str(out)]
    await run_ffmpeg(args)
