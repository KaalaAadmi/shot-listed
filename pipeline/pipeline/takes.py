"""Jobs `check-take` and `clip-pack` (docs/TRD.md §4, prompts/take-checker.md)."""

import io
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageStat

from . import media
from .clients import HostApi, Storage
from .models import Vision
from .prompts import render

PACK_COLLECTION = "clip-packs"  # storage collection; not a Library purpose, so never indexed
MIN_SHORT_SIDE = 720
DARK_LUMA = 40  # mean luma out of 255 below which a take is "very dark"


def technical(info: dict, required_s: float, frames: list[bytes]) -> tuple[str, str | None]:
    """The measured facts as text for the model, and a hard-failure fix (or None). Same order as prompts/take-checker.md."""
    luma = sum(ImageStat.Stat(Image.open(io.BytesIO(f)).convert("L")).mean[0] for f in frames) / len(frames)
    w, h, d = info["width"], info["height"], info["durationS"]
    text = f"{media.orientation(w, h).capitalize()} {w}×{h} · {d:.1f} s (needs ≥ {required_s:.1f} s) · brightness {'very dark' if luma < DARK_LUMA else 'OK'}"
    if w >= h:
        return text, "Film it vertically: hold the phone upright, not sideways."
    if min(w, h) < MIN_SHORT_SIDE:
        return text, f"Film at 1080p or at least {MIN_SHORT_SIDE}p: check the camera's video quality setting."
    if d + 0.05 < required_s:
        return text, f"Record at least {required_s:.0f} seconds; this take is {d:.1f} s."
    if luma < DARK_LUMA:
        return text, "Too dark: move toward a window or turn a light on, and film again."
    return text, None


def check_take(job: dict, api: HostApi, storage: Storage, vision: Vision) -> None:
    plan_id, shot_id, asset_id = (job["payload"][k] for k in ("planId", "shotId", "assetId"))
    ctx = api.shot(plan_id, shot_id)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "take"
        storage.download(asset_id, path)
        info = media.video_info(path)
        frames = media.frames(path, info["durationS"])
    text, hard = technical(info, ctx["requiredSeconds"], frames)
    if hard:
        result = {"verdict": "reshoot", "notes": text, "fix": hard, "useFromSeconds": 0, "useToSeconds": 0}
    else:
        prompt = render("take-checker", {"card": ctx["card"], "technical": text})
        out = vision.tag(prompt, frames)
        length = info["durationS"]
        lo = min(max(0.0, float(out["useFromSeconds"])), length)
        hi = min(max(lo, float(out["useToSeconds"])), length)
        note = "; ".join(f"{k}: {v['note']}" for k, v in out["matches"].items() if v["note"])
        result = {"verdict": out["verdict"], "notes": note, "fix": out["fix"], "useFromSeconds": lo, "useToSeconds": hi}
    api.take_result(plan_id, {"shotId": shot_id, "assetId": asset_id, **result})


def pack_name(n: int, name: str, ext: str) -> str:
    return f"{n:02d}_{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') or 'shot'}.{ext}"


def trim(src: Path, dest: Path, start: float, end: float) -> None:
    """Re-encoded so the cut is frame-accurate; 0 for `end` means to the end of the clip."""
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-i", str(src)]
    if end > start:
        cmd += ["-t", f"{end - start:.3f}"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", str(dest)]
    subprocess.run(cmd, check=True, capture_output=True)


def clip_pack(job: dict, api: HostApi, storage: Storage) -> None:
    plan_id = job["payload"]["planId"]
    manifest = api.pack(plan_id)
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        out = folder / "pack.zip"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
            for c in manifest["clips"]:
                src = folder / f"src-{c['n']}"
                storage.download(c["assetId"], src)
                if c["kind"] == "photo":
                    z.write(src, pack_name(c["n"], c["name"], "jpg"))
                    continue
                cut = folder / f"cut-{c['n']}.mp4"
                trim(src, cut, c["from"], c["to"])
                z.write(cut, pack_name(c["n"], c["name"], "mp4"))
            if manifest["missing"]:
                z.writestr("MISSING.txt", "Still to add:\n" + "\n".join(manifest["missing"]) + "\n")
        slug = re.sub(r"[^a-z0-9]+", "-", manifest["title"].lower()).strip("-") or "clip-pack"
        asset_id = storage.upload(PACK_COLLECTION, out.rename(folder / f"{slug}.zip"), "application/zip")
    api.pack_done(plan_id, asset_id)
