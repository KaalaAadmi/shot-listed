import os
from dataclasses import dataclass

# The web app embeds search queries with the same model and size (web/src/lib/library-index.ts).
EMBED_MODEL = "gemini-embedding-001"
EMBED_DIMS = 768


@dataclass(frozen=True)
class Config:
    app_url: str  # REEL_STUDIO_URL: the web app
    host_token: str
    storage_url: str
    storage_key: str  # its own `pipeline-host` key from the storage repo
    gemini_key: str
    vision_model: str = "gemini-flash-lite-latest"
    video_model: str = "gemini-flash-latest"  # watches shared reels; same default as the web app's GEMINI_MODEL
    cookies_file: str | None = None  # the burner account's Instagram cookies (Netscape format) for yt-dlp
    poll_seconds: float = 5

    @classmethod
    def from_env(cls) -> "Config":
        def need(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                raise SystemExit(f"{name} is not set (see pipeline/README.md)")
            return value

        return cls(
            app_url=need("REEL_STUDIO_URL").rstrip("/"),
            host_token=need("HOST_TOKEN"),
            storage_url=need("STORAGE_API_URL").rstrip("/"),
            storage_key=need("STORAGE_API_KEY"),
            gemini_key=need("GEMINI_API_KEY"),
            vision_model=os.environ.get("VISION_MODEL", "").strip() or cls.vision_model,
            video_model=os.environ.get("GEMINI_MODEL", "").strip() or cls.video_model,
            cookies_file=os.environ.get("IG_COOKIES_FILE", "").strip() or None,
        )
