// The model calls the caption engine needs. Gemini does both (it can watch video);
// Claude can write the captions if you add an Anthropic key. Tests pass stubs.

export type UploadedVideo = { name: string; uri: string; mimeType: string };

export type ModelPart = { text: string } | { video: UploadedVideo } | { image: { mimeType: string; base64: string } };

/** Anything that can return JSON matching a schema. Enough for writing captions. */
export interface JsonModel {
  /** Short name shown in the app, e.g. "Claude Sonnet 5.5". */
  label: string;
  /** One structured call: returns parsed JSON matching `schema` (validate it anyway). */
  generateJson(args: {
    system: string;
    parts: ModelPart[];
    schema: Record<string, unknown>;
    temperature: number;
  }): Promise<unknown>;
}

/** A model that can also watch video. Needed for the description step. */
export interface CaptionModel extends JsonModel {
  /** Sends the video to the model provider; resolves once it is ready to be used in a prompt. */
  uploadVideo(video: Blob, mimeType: string, displayName: string): Promise<UploadedVideo>;
  deleteVideo(video: UploadedVideo): Promise<void>;
}
