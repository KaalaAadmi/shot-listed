import shutil

import pytest
from PIL import Image

from pipeline import media


@pytest.mark.skipif(not shutil.which("exiftool"), reason="exiftool not installed")
def test_exiftool_reads_capture_time(tmp_path):
    path = tmp_path / "a.jpg"
    Image.new("RGB", (8, 8)).save(path)
    media._run(["exiftool", "-overwrite_original", "-DateTimeOriginal=2024:05:01 12:00:00", "-OffsetTimeOriginal=+01:00", "-Model=Test Cam", str(path)])
    cap = media.photo_info(path)["capture"]
    assert cap["at"].startswith("2024-05-01T12:00:00+01:00") and cap["camera"] == "Test Cam"
