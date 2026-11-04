"""Reading files and making derived ones: ffprobe, ffmpeg and Pillow. No network."""

import io
import json
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

import imagehash
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()

EXIF_IFD = 0x8769
DATETIME_ORIGINAL, SUBSEC_ORIGINAL, OFFSET_ORIGINAL, CAMERA_MODEL = 36867, 37521, 36880, 272
HDR_TRANSFERS = {"smpte2084", "arib-std-b67"}
FRAME_POINTS = (0.1, 0.5, 0.9)  # where in a video the perceptual hashes and tag images come from


def orientation(width: int, height: int) -> str:
    return "square" if width == height else "horizontal" if width > height else "vertical"


def _run(args: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, capture_output=True, **kw)


def parse_capture(text: str | None) -> datetime | None:
    """EXIF ("2024:05:01 12:00:00"), QuickTime ("2024-05-01T12:00:00+0100") or ISO ("...Z"); None if unreadable."""
    if not text:
        return None
    text = text.strip().replace("Z", "+00:00")
    if len(text) >= 19 and text[4] == ":" and text[7] == ":":
        text = text[:4] + "-" + text[5:7] + "-" + text[8:]
    for fmt in ("%Y-%m-%d %H:%M:%S%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _capture_dict(at: datetime | None, subsec: str | None = None, camera: str | None = None) -> dict | None:
    if not at:
        return None
    out: dict = {"at": (at if at.tzinfo else at.astimezone()).isoformat()}
    if at.tzinfo:
        out["tz"] = at.strftime("%z")
    if subsec and subsec.strip().isdigit():
        out["subsec"] = float(f"0.{subsec.strip()}")
    if camera:
        out["camera"] = camera.strip()[:100]
    return out


def exif_capture(path: Path) -> dict | None:
    """Capture data from exiftool (reads HEIC, MOV and MP4 tags that Pillow and ffprobe miss); None if it is missing or finds nothing."""
    if not shutil.which("exiftool"):
        return None
    tags = ["DateTimeOriginal", "OffsetTimeOriginal", "SubSecTimeOriginal", "CreationDate", "CreateDate", "Model"]
    try:
        out = json.loads(_run(["exiftool", "-j", *[f"-{t}" for t in tags], str(path)]).stdout)[0]
    except (subprocess.CalledProcessError, json.JSONDecodeError, IndexError):
        return None
    at = parse_capture(out.get("CreationDate")) or parse_capture(out.get("DateTimeOriginal"))
    if at and not at.tzinfo and (off := out.get("OffsetTimeOriginal")):
        at = parse_capture(f"{at.strftime('%Y-%m-%dT%H:%M:%S')}{str(off).replace(':', '')}") or at
    at = at or parse_capture(out.get("CreateDate"))
    return _capture_dict(at, str(out.get("SubSecTimeOriginal", "")), out.get("Model"))


# ---------- Photos ----------


def photo_info(path: Path) -> dict:
    """Size after rotation and the capture data, without touching the file."""
    with Image.open(path) as img:
        exif = img.getexif()
        ifd = exif.get_ifd(EXIF_IFD)
        width, height = ImageOps.exif_transpose(img).size
    at = parse_capture(ifd.get(DATETIME_ORIGINAL) or exif.get(306))
    if at and (off := ifd.get(OFFSET_ORIGINAL)):
        at = parse_capture(f"{at.strftime('%Y-%m-%dT%H:%M:%S')}{off.replace(':', '')}") or at
    return {
        "width": width,
        "height": height,
        "capture": exif_capture(path) or _capture_dict(at, ifd.get(SUBSEC_ORIGINAL), exif.get(CAMERA_MODEL)),
    }


def jpeg(img: Image.Image, longest: int, quality: int = 80) -> bytes:
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((longest, longest))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def phash(img: Image.Image) -> str:
    return str(imagehash.phash(ImageOps.exif_transpose(img).convert("RGB")))


# ---------- Videos ----------


def probe(path: Path) -> dict:
    out = _run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]).stdout
    return json.loads(out)


def _rotation(stream: dict) -> int:
    for side in stream.get("side_data_list", []):
        if "rotation" in side:
            return int(side["rotation"])
    return int(stream.get("tags", {}).get("rotate", 0))


def video_info(path: Path) -> dict:
    info = probe(path)
    stream = next(s for s in info["streams"] if s["codec_type"] == "video")
    width, height = int(stream["width"]), int(stream["height"])
    if abs(_rotation(stream)) % 180 == 90:
        width, height = height, width
    tags = {k.lower(): v for k, v in info["format"].get("tags", {}).items()}
    at = parse_capture(tags.get("com.apple.quicktime.creationdate") or tags.get("creation_time"))
    return {
        "width": width,
        "height": height,
        "durationS": round(float(info["format"]["duration"]), 3),
        "codec": stream.get("codec_name"),
        "hdr": stream.get("color_transfer") in HDR_TRANSFERS,
        "capture": exif_capture(path) or _capture_dict(at, camera=tags.get("com.apple.quicktime.model")),
    }


def frames(path: Path, duration: float, longest: int = 768) -> list[bytes]:
    """JPEG frames at 10%, 50% and 90% (ffmpeg applies the rotation)."""
    out = []
    for point in FRAME_POINTS:
        cmd = [
            "ffmpeg", "-v", "error", "-ss", f"{duration * point:.3f}", "-i", str(path), "-frames:v", "1",
            "-vf", f"scale={longest}:{longest}:force_original_aspect_ratio=decrease", "-f", "image2pipe", "-c:v", "mjpeg", "-",
        ]  # fmt: skip
        data = _run(cmd).stdout
        if not data:
            raise RuntimeError(f"ffmpeg returned no frame at {point:.0%}")
        out.append(data)
    return out


def make_proxy(path: Path, dest: Path, hdr: bool) -> None:
    """1080p H.264 SDR, with sound. HDR is tone-mapped so it doesn't look washed out."""
    scale = "scale='if(gt(iw,ih),-2,min(1080,iw))':'if(gt(iw,ih),min(1080,ih),-2)'"
    tonemap = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,"
    cmd = [
        "ffmpeg", "-v", "error", "-y", "-i", str(path), "-vf", (tonemap if hdr else "") + scale + ",format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dest),
    ]  # fmt: skip
    _run(cmd)
