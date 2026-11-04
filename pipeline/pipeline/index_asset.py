"""Job `index-asset`: measure, make a thumbnail and proxy, tag, embed, report (docs/TRD.md §4)."""

import io
import tempfile
from pathlib import Path

from PIL import Image

from . import media
from .clients import HostApi, NotFound, Storage
from .models import Vision
from .prompts import render


def _tags_text(t: dict) -> str:
    """Same text the web app embeds (embeddingText in web/src/lib/library-index.ts)."""

    def clean(xs: list[str], n: int) -> list[str]:
        return [x.strip() for x in xs if x.strip()][:n]

    extras = ", ".join([x for x in [t["action"].strip(), *clean(t["objects"], 8), *clean(t["useFor"], 4)] if x])
    return ". ".join(x for x in [t["caption"].strip(), extras] if x)


def index_asset(item_id: str, api: HostApi, storage: Storage, vision: Vision) -> None:
    try:
        item = api.item(item_id)
    except NotFound:
        return  # deleted since the job was queued

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "original"
        try:
            sha = storage.download(item_id, path)
        except NotFound:
            return

        is_video = item["kind"] == "video"
        info = media.video_info(path) if is_video else media.photo_info(path)
        if is_video:
            shots = media.frames(path, info["durationS"])
            hashes = [media.phash(Image.open(io.BytesIO(f))) for f in shots]
        else:
            with Image.open(path) as img:
                hashes = [media.phash(img)]
                shots = [media.jpeg(img, 768)]

        result: dict = {
            "width": info["width"],
            "height": info["height"],
            "contentHash": sha,
            "phash": hashes,
            "variants": {"proxy": False, "thumb": False},
        }
        for key in ("durationS", "codec", "capture"):
            if info.get(key) is not None:
                result[key] = info[key]

        if item["purpose"] == "library":  # final cuts get the light version: hashes and sizes only
            thumb = media.jpeg(Image.open(io.BytesIO(shots[len(shots) // 2])), 512)
            storage.upload_variant(item_id, "thumb", "image/jpeg", thumb)
            result["variants"]["thumb"] = True
            if is_video:
                proxy = Path(tmp) / "proxy.mp4"
                media.make_proxy(path, proxy, info["hdr"])
                storage.upload_variant(item_id, "proxy", "video/mp4", proxy.read_bytes())
                result["variants"]["proxy"] = True

            prompt = render(
                "library-tagger",
                {
                    "kind": item["kind"],
                    "durationSeconds": str(round(info.get("durationS", 0))),
                    "orientation": media.orientation(info["width"], info["height"]),
                    "takenAt": item["takenAt"] or (info["capture"] or {}).get("at", "unknown"),
                },
            )
            tags = vision.tag(prompt, shots)
            result["tags"] = tags
            result["embedding"] = vision.embed(_tags_text(tags))

    api.indexed(item_id, result)
