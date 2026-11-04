"""The host's loop: claim a job, run it while a thread keeps the lease alive, report the outcome."""

import logging
import threading
from collections.abc import Callable

from .clients import HostApi, NotFound, Storage
from .config import Config
from .index_asset import index_asset
from .inspirations import analyse_inspiration, ingest_inspiration
from .models import Gemini
from .takes import check_take, clip_pack

log = logging.getLogger("pipeline")
HEARTBEAT_SECONDS = 60


def handlers(api: HostApi, storage: Storage, gemini: Gemini, cookies: str | None = None) -> dict[str, Callable[[dict], None]]:
    """One entry per job type this host can run. Later phases add theirs here."""
    return {
        "index-asset": lambda job: index_asset(job["payload"]["itemId"], api, storage, gemini),
        "ingest-inspiration": lambda job: ingest_inspiration(job, api, storage, cookies),
        "analyse-inspiration": lambda job: analyse_inspiration(job, api, storage, gemini),
        "check-take": lambda job: check_take(job, api, storage, gemini),
        "clip-pack": lambda job: clip_pack(job, api, storage),
    }


def run_job(job: dict, api: HostApi, table: dict[str, Callable[[dict], None]], beat: float = HEARTBEAT_SECONDS) -> None:
    stop = threading.Event()

    def keep_alive() -> None:
        while not stop.wait(beat):
            try:
                if not api.heartbeat(job["id"]):
                    log.warning("job %s was handed on; finishing anyway", job["id"])
                    return
            except Exception:
                log.exception("heartbeat failed")

    threading.Thread(target=keep_alive, daemon=True).start()
    try:
        handler = table.get(job["type"])
        if not handler:
            raise RuntimeError(f"this host can't run {job['type']} jobs")
        handler(job)
        api.complete(job["id"])
        log.info("done %s %s", job["type"], job["id"])
    except NotFound:
        api.complete(job["id"])  # what the job was about is gone
    except Exception as err:  # noqa: BLE001 - any failure goes back to the queue
        log.exception("failed %s %s", job["type"], job["id"])
        api.fail(job["id"], f"{type(err).__name__}: {err}")
    finally:
        stop.set()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.from_env()
    api = HostApi(cfg.app_url, cfg.host_token)
    table = handlers(api, Storage(cfg.storage_url, cfg.storage_key), Gemini(cfg), cfg.cookies_file)
    idle = threading.Event()
    while True:
        try:
            job = api.claim()
        except Exception:
            log.exception("could not reach ShotListed")
            job = None
        if job:
            run_job(job, api, table)
        else:
            idle.wait(cfg.poll_seconds)


if __name__ == "__main__":
    main()
