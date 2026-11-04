import { z } from "zod";
import { authorize } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { recordIndexed } from "@/lib/library-match";
import { EMBED_DIMS } from "@/lib/library-index";

const hash = z.string().regex(/^[0-9a-f]{16}$/);

const tags = z.object({
  caption: z.string().min(1).max(500),
  setting: z.string().max(40),
  shotType: z.string().max(40),
  action: z.string().max(300),
  mood: z.string().max(100),
  peopleCount: z.number().int().min(0).max(100),
  faceVisible: z.boolean(),
  visibleText: z.string().max(1000),
  objects: z.array(z.string().max(100)).max(50),
  useFor: z.array(z.string().max(100)).max(50),
  quality: z.object({ sharp: z.boolean(), wellLit: z.boolean(), stable: z.boolean(), note: z.string().max(300) }),
  unusable: z.boolean(),
  unusableReason: z.string().max(300),
});

const body = z.object({
  durationS: z.number().nonnegative().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codec: z.string().max(40).optional(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  capture: z
    .object({ at: z.string().datetime({ offset: true }), subsec: z.number().min(0).max(1).optional(), tz: z.string().max(20).optional(), camera: z.string().max(100).optional() })
    .optional(),
  phash: z.array(hash).min(1).max(3),
  variants: z.object({ proxy: z.boolean(), thumb: z.boolean() }),
  tags: tags.optional(),
  embedding: z.array(z.number()).length(EMBED_DIMS).optional(),
});

/** The host reports what it measured and saw; ShotListed saves it and looks for copies. */
export async function POST(req: Request, ctx: RouteContext<"/api/host/items/[id]/indexed">) {
  return handle(async () => {
    await authorize(req, ["host"]);
    const { id } = await ctx.params;
    await recordIndexed(id, await readJson(req, body));
    return new Response(null, { status: 204 });
  });
}
