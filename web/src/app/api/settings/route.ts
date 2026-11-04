import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { captionVoice, getSettings, updateSettings } from "@/lib/library";
import type { SettingsDoc } from "@/lib/types";

function view(s: SettingsDoc) {
  const voice = captionVoice(s);
  return {
    ingestMode: s.ingestMode,
    captionSystemPrompt: voice.systemPrompt,
    captionContentHistory: voice.contentHistory,
    systemPromptIsDefault: voice.systemPromptIsDefault,
    contentHistoryIsDefault: voice.contentHistoryIsDefault,
    hashtagPlacement: s.hashtagPlacement ?? "caption",
    blankLineBeforeHashtags: s.blankLineBeforeHashtags ?? false,
    checkDescriptionFirst: s.checkDescriptionFirst ?? true,
    creatorProfile: voice.creatorProfile,
    creatorProfileIsDefault: voice.creatorProfileIsDefault,
    updatedAt: s.updatedAt,
  };
}

export async function GET(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json(view(await getSettings()));
  });
}

// Every field optional: each control on the Settings screen saves on its own.
// `null` for a prompt field restores the default.
const body = z
  .object({
    ingestMode: z.enum(["phone-upload", "mac-photos"]),
    captionSystemPrompt: z.string().max(40_000).nullable(),
    captionContentHistory: z.string().max(40_000).nullable(),
    hashtagPlacement: z.enum(["caption", "first-comment"]),
    blankLineBeforeHashtags: z.boolean(),
    checkDescriptionFirst: z.boolean(),
    creatorProfile: z.string().max(40_000).nullable(),
  })
  .partial();

export async function PUT(req: Request) {
  return handle(async () => {
    await authorize(req, ["owner"]);
    return Response.json(view(await updateSettings(await readJson(req, body))));
  });
}
