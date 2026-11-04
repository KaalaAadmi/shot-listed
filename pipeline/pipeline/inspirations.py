"""Jobs `ingest-inspiration` and `analyse-inspiration` (docs/TRD.md §4)."""

import tempfile
from pathlib import Path

import yt_dlp

from .clients import HostApi, Storage
from .models import Gemini
from .prompts import render

COLLECTION = "inspirations"  # storage collection; mirrors INSPIRATIONS in web/src/lib/storage/connector.ts


def meta_of(info: dict) -> dict:
    """The facts yt-dlp found, in the shape POST /api/host/inspirations/{id}/ingested takes. Missing counts are None."""

    def count(key: str) -> int | None:
        v = info.get(key)
        return int(v) if isinstance(v, (int, float)) and v >= 0 else None

    track = (info.get("track") or "").strip()
    return {
        "creator": (info.get("uploader") or info.get("channel") or "").strip()[:100],
        "caption": (info.get("description") or info.get("title") or "")[:5000],
        "views": count("view_count"),
        "likes": count("like_count"),
        "comments": count("comment_count"),
        "durationS": float(info["duration"]) if info.get("duration") else None,
        "audio": {"title": track[:200] or "unknown", "isOriginal": track.lower().startswith("original audio") if track else None},
    }


def stats_text(meta: dict | None) -> str:
    """Same text as the web app's statsText."""
    if not meta:
        return ""

    def n(v: int | None) -> str:
        return "unknown" if v is None else f"{v:,}"

    return f"Views {n(meta['views'])} · Likes {n(meta['likes'])} · Comments {n(meta['comments'])} · Shares unknown"


def download(url: str, folder: Path, cookies: str | None) -> tuple[Path, dict]:
    opts = {"outtmpl": str(folder / "reel.%(ext)s"), "format": "best[ext=mp4]/best", "quiet": True, "noprogress": True, "noplaylist": True}
    if cookies:
        opts["cookiefile"] = cookies
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info)), info


def ingest_inspiration(job: dict, api: HostApi, storage: Storage, cookies: str | None) -> None:
    run, insp_id = job.get("runId"), job["payload"]["inspirationId"]
    row = api.inspiration(insp_id)
    api.event(run, "Downloading", "running")
    with tempfile.TemporaryDirectory() as tmp:
        try:
            path, info = download(row["url"], Path(tmp), cookies)
        except yt_dlp.utils.DownloadError as err:
            # Usually Instagram challenging a data-centre IP or expired cookies. The Inbox offers an upload instead.
            api.event(run, "Downloading", "failed", error=str(err))
            raise
        asset_id = storage.upload(COLLECTION, path, "video/mp4")
    api.ingested(insp_id, asset_id, meta_of(info))


def analyse_inspiration(job: dict, api: HostApi, storage: Storage, gemini: Gemini) -> None:
    run, insp_id = job.get("runId"), job["payload"]["inspirationId"]
    row = api.inspiration(insp_id)
    meta = row["meta"]
    api.event(run, "Watching", "running")
    prompt = render(
        "inspiration-analysis",
        {
            "creatorCaption": meta["caption"] if meta else "",
            "stats": stats_text(meta),
            "audioTitle": meta["audio"]["title"] if meta else "unknown",
            "note": row["note"],
        },
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "reel.mp4"
        storage.download(row["storageAssetId"], path)
        try:
            result = gemini.watch(prompt, path)
        except Exception as err:
            api.event(run, "Watching", "failed", error=str(err))
            raise
    api.analysed(insp_id, result)
