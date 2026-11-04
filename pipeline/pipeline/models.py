"""Model calls the host makes. Gemini does both; tests pass a fake with the same two methods."""

import json
import mimetypes
import time
from pathlib import Path
from typing import Protocol

from google import genai
from google.genai import types

from .config import EMBED_DIMS, EMBED_MODEL, Config


class Vision(Protocol):
    def tag(self, prompt: dict, images: list[bytes]) -> dict: ...

    def embed(self, text: str) -> list[float]: ...


class Gemini:
    def __init__(self, cfg: Config):
        self.client = genai.Client(api_key=cfg.gemini_key)
        self.model = cfg.vision_model
        self.video_model = cfg.video_model

    def tag(self, prompt: dict, images: list[bytes]) -> dict:
        parts = [types.Part.from_bytes(data=img, mime_type="image/jpeg") for img in images]
        parts.append(types.Part.from_text(text=prompt["user"]))
        res = self.client.models.generate_content(
            model=self.model,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(
                system_instruction=prompt["system"],
                temperature=prompt["temperature"],
                response_mime_type="application/json",
                response_json_schema=prompt["schema"],
            ),
        )
        if not res.text:
            raise RuntimeError("Gemini returned an empty response")
        return json.loads(res.text)

    def embed(self, text: str) -> list[float]:
        res = self.client.models.embed_content(
            model=EMBED_MODEL, contents=text, config=types.EmbedContentConfig(output_dimensionality=EMBED_DIMS)
        )
        return list(res.embeddings[0].values)

    def watch(self, prompt: dict, video: Path) -> dict:
        """Gemini watches the video with sound (Files API) and answers in the prompt's schema."""
        mime = mimetypes.guess_type(video.name)[0] or "video/mp4"
        file = self.client.files.upload(file=str(video), config=types.UploadFileConfig(mime_type=mime))
        try:
            deadline = time.monotonic() + 180
            while file.state and file.state.name != "ACTIVE":
                if file.state.name == "FAILED" or time.monotonic() > deadline:
                    raise RuntimeError("Gemini could not process this video")
                time.sleep(3)
                file = self.client.files.get(name=file.name)
            res = self.client.models.generate_content(
                model=self.video_model,
                contents=[types.Content(role="user", parts=[types.Part.from_uri(file_uri=file.uri, mime_type=mime), types.Part.from_text(text=prompt["user"])])],
                config=types.GenerateContentConfig(
                    system_instruction=prompt["system"],
                    temperature=prompt["temperature"],
                    response_mime_type="application/json",
                    response_json_schema=prompt["schema"],
                ),
            )
        finally:
            try:
                self.client.files.delete(name=file.name)
            except Exception:  # noqa: BLE001 - Gemini expires uploads on its own
                pass
        if not res.text:
            raise RuntimeError("Gemini returned an empty response")
        return json.loads(res.text)
