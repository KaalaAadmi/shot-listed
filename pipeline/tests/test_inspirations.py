"""analyse-inspiration with fakes for the network; meta and stats text on their own."""

from pipeline.inspirations import analyse_inspiration, meta_of, stats_text


def test_meta_of_keeps_unknown_counts_as_none():
    meta = meta_of({"uploader": "gymguy", "description": "leg day", "view_count": 1200, "like_count": None, "duration": 14.2, "track": "Original audio - gymguy"})
    assert meta["creator"] == "gymguy"
    assert (meta["views"], meta["likes"], meta["comments"]) == (1200, None, None)
    assert meta["audio"] == {"title": "Original audio - gymguy", "isOriginal": True}
    assert meta_of({})["audio"] == {"title": "unknown", "isOriginal": None}


def test_stats_text_matches_the_web_app():
    meta = {"views": 120000, "likes": 8100, "comments": None}
    assert stats_text(meta) == "Views 120,000 · Likes 8,100 · Comments unknown · Shares unknown"
    assert stats_text(None) == ""


class FakeApi:
    def __init__(self):
        self.events, self.result = [], None

    def inspiration(self, _id):
        return {"url": "", "note": "love the hook", "storageAssetId": "a1", "meta": meta_of({"description": "caption text"}), "runId": "r1"}

    def event(self, run, step, status, **kw):
        self.events.append((run, step, status))

    def analysed(self, _id, result):
        self.result = result


class FakeStorage:
    def download(self, _id, dest):
        dest.write_bytes(b"video")
        return "x"


class FakeGemini:
    def watch(self, prompt, video):
        self.prompt = prompt
        assert video.read_bytes() == b"video"
        return {"concept": {}}


def test_analyse_sends_the_rendered_prompt_and_reports_the_result():
    api, gemini = FakeApi(), FakeGemini()
    analyse_inspiration({"runId": "r1", "payload": {"inspirationId": "i1"}}, api, FakeStorage(), gemini)
    assert api.result == {"concept": {}}
    assert api.events == [("r1", "Watching", "running")]
    assert "caption text" in gemini.prompt["user"] and "love the hook" in gemini.prompt["user"]
    assert gemini.prompt["prompt"] == "inspiration-analysis@1"
