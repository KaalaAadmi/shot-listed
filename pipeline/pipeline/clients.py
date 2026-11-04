"""HTTP clients for the two services the host talks to: ShotListed's host API and the storage service."""

import hashlib
from pathlib import Path

import httpx


class NotFound(Exception):
    """The item or file is gone (deleted since the job was queued). The job has nothing left to do."""


def _check(res: httpx.Response) -> httpx.Response:
    if res.status_code == 404:
        raise NotFound(res.text)
    res.raise_for_status()
    return res


class HostApi:
    """ShotListed's /api/host/* routes. The host never connects to Atlas."""

    def __init__(self, base: str, token: str, client: httpx.Client | None = None):
        self.base = base
        self.http = client or httpx.Client(timeout=30)
        self.headers = {"X-Reel-Token": token}

    def _call(self, method: str, path: str, **kw) -> httpx.Response:
        return _check(self.http.request(method, f"{self.base}/api/host{path}", headers=self.headers, **kw))

    def claim(self) -> dict | None:
        res = self._call("POST", "/jobs/claim")
        return None if res.status_code == 204 else res.json()["job"]

    def heartbeat(self, job_id: str) -> bool:
        try:
            self._call("POST", f"/jobs/{job_id}/heartbeat")
            return True
        except httpx.HTTPStatusError as err:
            if err.response.status_code == 409:
                return False
            raise

    def complete(self, job_id: str) -> None:
        self._call("POST", f"/jobs/{job_id}/complete")

    def fail(self, job_id: str, error: str) -> None:
        self._call("POST", f"/jobs/{job_id}/fail", json={"error": error[:2000]})

    def item(self, item_id: str) -> dict:
        return self._call("GET", f"/items/{item_id}").json()

    def indexed(self, item_id: str, result: dict) -> None:
        self._call("POST", f"/items/{item_id}/indexed", json=result)

    def event(self, run_id: str | None, step: str, status: str, summary: str | None = None, error: str | None = None) -> None:
        """Moves a progress bar. Best effort: a lost event must not fail the job."""
        if not run_id:
            return
        body = {"step": step, "status": status, **({"summary": summary} if summary else {}), **({"error": error[:300]} if error else {})}
        try:
            self._call("POST", f"/runs/{run_id}/events", json=body)
        except httpx.HTTPError:
            pass

    def inspiration(self, inspiration_id: str) -> dict:
        return self._call("GET", f"/inspirations/{inspiration_id}").json()

    def ingested(self, inspiration_id: str, storage_asset_id: str, meta: dict) -> None:
        self._call("POST", f"/inspirations/{inspiration_id}/ingested", json={"storageAssetId": storage_asset_id, "meta": meta})

    def analysed(self, inspiration_id: str, result: dict) -> None:
        # The web app scores the reel before it answers, which calls a model.
        self._call("POST", f"/inspirations/{inspiration_id}/analysed", json=result, timeout=180)

    def shot(self, plan_id: str, shot_id: str) -> dict:
        return self._call("GET", f"/plans/{plan_id}/shots/{shot_id}").json()

    def take_result(self, plan_id: str, result: dict) -> None:
        self._call("POST", f"/plans/{plan_id}/takes", json=result)

    def pack(self, plan_id: str) -> dict:
        return self._call("GET", f"/plans/{plan_id}/pack").json()

    def pack_done(self, plan_id: str, storage_asset_id: str) -> None:
        self._call("POST", f"/plans/{plan_id}/pack", json={"storageAssetId": storage_asset_id})


class Storage:
    """The r2-storage service, with this host's own key."""

    def __init__(self, base: str, key: str, client: httpx.Client | None = None):
        self.base = base
        self.http = client or httpx.Client(timeout=60)
        self.headers = {"Authorization": f"Bearer {key}"}

    def _call(self, method: str, path: str, **kw) -> httpx.Response:
        return _check(self.http.request(method, f"{self.base}/v1{path}", headers=self.headers, **kw))

    def download(self, asset_id: str, dest: Path) -> str:
        """Saves the original (or the proxy, if the original was dropped); returns its SHA-256."""
        url = self._call("POST", f"/assets/{asset_id}/url", json={}).json()["url"]
        digest = hashlib.sha256()
        with self.http.stream("GET", url, timeout=600) as res:
            _check(res)
            with dest.open("wb") as out:
                for chunk in res.iter_bytes(1 << 20):
                    digest.update(chunk)
                    out.write(chunk)
        return digest.hexdigest()

    def upload(self, collection: str, path: Path, content_type: str) -> str:
        """Stores a file as a new asset and returns its ID. Single PUT only; reels are far below the 64 MB multipart line."""
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        start = self._call(
            "POST",
            "/uploads",
            json={"collection": collection, "filename": path.name, "contentType": content_type, "size": path.stat().st_size, "contentHash": digest},
        ).json()
        if start["mode"] == "duplicate":
            return start["assetId"]
        if start["mode"] != "single":
            raise RuntimeError(f"this reel is too big for a single upload ({start['mode']})")  # ponytail: multipart if reels ever pass 64 MB
        _check(self.http.put(start["url"], content=path.read_bytes(), headers=start.get("headers") or {}, timeout=600))
        self._call("POST", f"/uploads/{start['assetId']}/complete", json={})
        return start["assetId"]

    def upload_variant(self, asset_id: str, name: str, content_type: str, data: bytes) -> None:
        put = self._call(
            "POST", f"/assets/{asset_id}/variants", json={"name": name, "contentType": content_type, "size": len(data)}
        ).json()
        _check(self.http.put(put["url"], content=data, headers=put.get("headers") or {}, timeout=600))
        self._call("POST", f"/assets/{asset_id}/variants/{name}/complete")
