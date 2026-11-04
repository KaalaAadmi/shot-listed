"""index-asset on real generated files; only the network (web app, storage, Gemini) is faked."""

import json
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from pipeline import media
from pipeline.clients import HostApi, NotFound
from pipeline.index_asset import _tags_text, index_asset
from pipeline.main import run_job
from pipeline.prompts import PROMPTS_DIR, render

TAGS = {
    "caption": "Man doing dips in a gym",
    "setting": "gym",
    "shotType": "medium",
    "action": "doing dips",
    "mood": "focused",
    "peopleCount": 1,
    "faceVisible": True,
    "visibleText": "",
    "objects": ["bench", "rack"],
    "useFor": ["workout"],
    "quality": {"sharp": True, "wellLit": True, "stable": True, "note": ""},
    "unusable": False,
    "unusableReason": "",
}


class FakeApi:
    def __init__(self, item: dict):
        self._item, self.result, self.completed, self.failed = item, None, [], []

    def item(self, _id):
        return self._item

    def indexed(self, _id, result):
        self.result = result

    def complete(self, job_id):
        self.completed.append(job_id)

    def fail(self, job_id, error):
        self.failed.append(error)

    def heartbeat(self, _id):
        return True


class FakeStorage:
    def __init__(self, source: Path):
        self.source, self.variants = source, {}

    def download(self, _id, dest: Path) -> str:
        import hashlib

        dest.write_bytes(self.source.read_bytes())
        return hashlib.sha256(self.source.read_bytes()).hexdigest()

    def upload_variant(self, _id, name, content_type, data):
        self.variants[name] = (content_type, data)


class FakeVision:
    def __init__(self):
        self.calls = []

    def tag(self, prompt, images):
        self.calls.append((prompt, images))
        return dict(TAGS)

    def embed(self, text):
        self.text = text
        return [0.1] * 768


def photo(tmp_path: Path) -> Path:
    img = Image.new("RGB", (400, 300), "red")
    exif = img.getexif()
    exif[274] = 6  # rotated: stored 400x300, shown 300x400
    exif[272] = "iPhone 15"
    exif.get_ifd(0x8769)[36867] = "2024:05:01 12:30:00"
    exif.get_ifd(0x8769)[37521] = "45"
    exif.get_ifd(0x8769)[36880] = "+01:00"
    path = tmp_path / "a.jpg"
    img.save(path, exif=exif)
    return path


def video(tmp_path: Path) -> Path:
    path = tmp_path / "v.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10",
         "-f", "lavfi", "-i", "sine=duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
         "-metadata", "creation_time=2024-05-01T11:30:00Z", str(path)],
        check=True,
    )  # fmt: skip
    return path


def item(kind: str, purpose: str = "library") -> dict:
    return {"id": "i1", "kind": kind, "purpose": purpose, "takenAt": None, "filename": "x", "contentType": "x", "contentHash": None}


def test_photo_is_measured_tagged_and_reported(tmp_path):
    api, storage, vision = FakeApi(item("photo")), FakeStorage(photo(tmp_path)), FakeVision()
    index_asset("i1", api, storage, vision)
    r = api.result
    assert (r["width"], r["height"]) == (300, 400)  # after rotation
    assert r["capture"]["subsec"] == 0.45 and r["capture"]["camera"] == "iPhone 15"
    assert r["capture"]["at"].startswith("2024-05-01T12:30:00+01:00")
    assert len(r["phash"]) == 1 and len(r["phash"][0]) == 16
    assert r["variants"] == {"proxy": False, "thumb": True}
    assert storage.variants["thumb"][0] == "image/jpeg"
    assert r["tags"]["caption"] == TAGS["caption"] and len(r["embedding"]) == 768
    assert vision.text == "Man doing dips in a gym. doing dips, bench, rack, workout"
    prompt, images = vision.calls[0]
    assert "Orientation: vertical" in prompt["user"] and len(images) == 1


def test_video_gets_three_frames_hashes_and_a_proxy(tmp_path):
    api, storage, vision = FakeApi(item("video")), FakeStorage(video(tmp_path)), FakeVision()
    index_asset("i1", api, storage, vision)
    r = api.result
    assert (r["width"], r["height"]) == (320, 240) and r["durationS"] == pytest.approx(3, abs=0.2)
    assert len(r["phash"]) == 3 and len(vision.calls[0][1]) == 3
    assert r["variants"] == {"proxy": True, "thumb": True}
    assert storage.variants["proxy"][0] == "video/mp4" and len(storage.variants["proxy"][1]) > 1000
    assert r["capture"]["at"].startswith("2024-05-01T11:30:00")


def test_final_cuts_get_the_light_version(tmp_path):
    api, storage, vision = FakeApi(item("video", "final-cut")), FakeStorage(video(tmp_path)), FakeVision()
    index_asset("i1", api, storage, vision)
    assert "tags" not in api.result and not storage.variants and not vision.calls
    assert len(api.result["phash"]) == 3


def test_deleted_item_is_skipped(tmp_path):
    class Gone(FakeApi):
        def item(self, _id):
            raise NotFound("gone")

    api = Gone({})
    index_asset("i1", api, FakeStorage(photo(tmp_path)), FakeVision())
    assert api.result is None


def test_job_loop_reports_success_and_failure():
    api = FakeApi({})
    job = {"id": "j", "type": "index-asset", "payload": {}}
    run_job(job, api, {"index-asset": lambda j: None}, beat=3600)
    assert api.completed == ["j"] and not api.failed
    run_job(job, api, {"index-asset": lambda j: 1 / 0}, beat=3600)
    assert "ZeroDivisionError" in api.failed[0]
    run_job({"id": "k", "type": "mystery", "payload": {}}, api, {}, beat=3600)
    assert "can't run mystery" in api.failed[1]


def test_capture_formats():
    assert media.parse_capture("2024:05:01 12:30:00").year == 2024
    assert media.parse_capture("2024-05-01T11:30:00.000000Z").hour == 11
    assert media.parse_capture("2024-05-01T12:30:00+0100").utcoffset().total_seconds() == 3600
    assert media.parse_capture("nonsense") is None and media.parse_capture(None) is None


def test_prompt_matches_the_web_bundle():
    """The host and the web app must render the same prompt from the same file."""
    bundle = json.loads((Path(__file__).parents[2] / "web/src/lib/prompts.generated.json").read_text())
    got = render("library-tagger", {"kind": "photo"}, PROMPTS_DIR)
    want = bundle["library-tagger"]
    assert got["system"] == want["system"] and got["schema"] == want["schema"]
    assert got["prompt"] == f"library-tagger@{want['version']}"
    assert "Kind: photo" in got["user"]


def test_embedding_text_matches_the_web_rule():
    assert _tags_text({**TAGS, "objects": [f"o{i}" for i in range(12)], "useFor": ["a", "b", "c", "d", "e"]}).endswith("o7, a, b, c, d")


def test_host_api_claims_and_sends_the_token():
    import httpx

    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.url.path, req.headers["x-reel-token"]))
        return httpx.Response(204) if req.url.path.endswith("claim") else httpx.Response(409)

    api = HostApi("https://app", "tok", httpx.Client(transport=httpx.MockTransport(handler)))
    assert api.claim() is None and api.heartbeat("j") is False
    assert seen[0] == ("POST", "/api/host/jobs/claim", "tok")
