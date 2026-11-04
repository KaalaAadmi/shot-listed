"""check-take and clip-pack on real generated videos; only the network is faked."""

import io
import subprocess
import zipfile
from pathlib import Path

from pipeline import media
from pipeline.takes import check_take, clip_pack, pack_name, technical


def make_video(path: Path, size: str, seconds: float = 3, colour: str = "gray") -> Path:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={colour}:s={size}:d={seconds}:r=30", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )
    return path


def facts(path: Path):
    info = media.video_info(path)
    return info, media.frames(path, info["durationS"])


def test_technical_checks_decide_reshoot_with_their_own_fix(tmp_path):
    horizontal, h_frames = facts(make_video(tmp_path / "h.mp4", "1920x1080"))
    assert "vertically" in technical(horizontal, 2, h_frames)[1]
    small, s_frames = facts(make_video(tmp_path / "s.mp4", "360x640"))
    assert "720p" in technical(small, 2, s_frames)[1]
    short, short_frames = facts(make_video(tmp_path / "t.mp4", "720x1280", seconds=1))
    assert "at least 4 seconds" in technical(short, 4, short_frames)[1]
    dark, d_frames = facts(make_video(tmp_path / "d.mp4", "720x1280", colour="black"))
    assert "dark" in technical(dark, 2, d_frames)[1]
    good, g_frames = facts(make_video(tmp_path / "g.mp4", "720x1280"))
    assert technical(good, 2, g_frames)[1] is None


class FakeApi:
    def __init__(self):
        self.result = None

    def shot(self, plan, shot):
        return {"card": "Shot: x", "requiredSeconds": 2, "seconds": 3}

    def take_result(self, plan, result):
        self.result = result


class FakeStorage:
    def __init__(self, path):
        self.path = path

    def download(self, _id, dest):
        dest.write_bytes(self.path.read_bytes())
        return "x"


class FakeVision:
    def __init__(self):
        self.called = False

    def tag(self, prompt, images):
        self.called = True
        assert "Shot: x" in prompt["user"] and len(images) == 3
        ok = {"ok": True, "note": ""}
        return {"verdict": "usable", "matches": {"framing": {"ok": False, "note": "a bit tight"}, "subjectAction": ok}, "fix": "Step back.", "useFromSeconds": -1, "useToSeconds": 99}


JOB = {"payload": {"planId": "p", "shotId": "s", "assetId": "a"}}


def test_a_bad_take_never_reaches_the_model(tmp_path):
    api, vision = FakeApi(), FakeVision()
    check_take(JOB, api, FakeStorage(make_video(tmp_path / "h.mp4", "1920x1080")), vision)
    assert api.result["verdict"] == "reshoot" and "vertically" in api.result["fix"]
    assert (api.result["shotId"], api.result["assetId"]) == ("s", "a")
    assert not vision.called


def test_a_good_take_is_judged_and_the_range_clamped(tmp_path):
    api, vision = FakeApi(), FakeVision()
    check_take(JOB, api, FakeStorage(make_video(tmp_path / "g.mp4", "720x1280")), vision)
    assert api.result["verdict"] == "usable" and api.result["fix"] == "Step back."
    assert 0 <= api.result["useFromSeconds"] <= api.result["useToSeconds"] <= 3.1
    assert "a bit tight" in api.result["notes"]


def test_pack_names_are_numbered_and_safe():
    assert pack_name(1, "hook", "mp4") == "01_hook.mp4"
    assert pack_name(12, "Gym mirror!! shot", "mp4") == "12_gym-mirror-shot.mp4"
    assert pack_name(3, "???", "jpg") == "03_shot.jpg"


def test_clip_pack_trims_in_shot_order_and_lists_what_is_missing(tmp_path):
    src = make_video(tmp_path / "src.mp4", "360x640", seconds=4)

    class PackApi:
        done = None

        def pack(self, plan):
            clips = [{"n": 2, "name": "shot", "kind": "video", "assetId": "a", "from": 1.0, "to": 3.0}, {"n": 1, "name": "hook", "kind": "video", "assetId": "a", "from": 0, "to": 0}]
            return {"title": "Gym Reel", "clips": clips, "missing": ["03: film this one (mirror)"]}

        def pack_done(self, plan, asset):
            self.done = asset

    class PackStorage(FakeStorage):
        uploaded = None

        def upload(self, collection, path, content_type):
            self.uploaded = (collection, path.name, content_type, path.read_bytes())
            return "zip1"

    api, storage = PackApi(), PackStorage(src)
    clip_pack({"payload": {"planId": "p"}}, api, storage)
    collection, name, ctype, data = storage.uploaded
    assert (collection, name, ctype, api.done) == ("clip-packs", "gym-reel.zip", "application/zip", "zip1")
    z = zipfile.ZipFile(io.BytesIO(data))
    assert sorted(z.namelist()) == ["01_hook.mp4", "02_shot.mp4", "MISSING.txt"]
    z.extract("02_shot.mp4", tmp_path)
    assert 1.8 <= media.video_info(tmp_path / "02_shot.mp4")["durationS"] <= 2.3
    assert "film this one" in z.read("MISSING.txt").decode()
