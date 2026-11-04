import "server-only";
import { createPartFromUri, GoogleGenAI, type Part } from "@google/genai";
import type { CaptionModel, UploadedVideo } from "./model.ts";

const ACTIVE_TIMEOUT_MS = 3 * 60 * 1000;
const POLL_MS = 3000;

/**
 * Gemini watches video with its audio track, so the reel's voiceover, music and
 * on-screen text all reach the description without running ffmpeg or a transcriber.
 */
export function geminiModel(apiKey: string, model: string): CaptionModel {
  const ai = new GoogleGenAI({ apiKey });

  return {
    label: `Gemini (${model})`,

    async uploadVideo(video, mimeType, displayName) {
      const file = await ai.files.upload({ file: video, config: { mimeType, displayName } });
      if (!file.name || !file.uri) throw new Error("Gemini did not return a file reference");

      // Uploaded videos are processed before they can be used; poll until ACTIVE.
      const deadline = Date.now() + ACTIVE_TIMEOUT_MS;
      let state = file.state;
      while (state !== "ACTIVE") {
        if (state === "FAILED") throw new Error("Gemini could not process this video");
        if (Date.now() > deadline) throw new Error("Gemini took too long to process the video");
        await new Promise((r) => setTimeout(r, POLL_MS));
        state = (await ai.files.get({ name: file.name })).state;
      }
      return { name: file.name, uri: file.uri, mimeType: file.mimeType ?? mimeType };
    },

    async generateJson({ system, parts, schema, temperature }) {
      const contents: Part[] = parts.map((p) =>
        "video" in p
          ? createPartFromUri(p.video.uri, p.video.mimeType)
          : "image" in p
            ? { inlineData: { data: p.image.base64, mimeType: p.image.mimeType } }
            : { text: p.text },
      );
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: contents }],
        config: {
          systemInstruction: system,
          temperature,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      });
      const text = res.text;
      if (!text) throw new Error("Gemini returned an empty response");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error("Gemini returned text that is not valid JSON");
      }
    },

    async deleteVideo(video: UploadedVideo) {
      // Gemini expires uploaded files on its own; this just removes it as soon as we're done.
      await ai.files.delete({ name: video.name }).catch(() => undefined);
    },
  };
}
