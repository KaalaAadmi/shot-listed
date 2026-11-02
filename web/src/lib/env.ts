import "server-only";
import { z } from "zod";

// Read lazily so `next build` works without secrets; each route validates on first use.
const schema = z.object({
  // The r2-storage service (its own repo and Vercel project) and this app's key for it.
  // Reel Studio holds no R2 credentials; create the key with `npm run create-key` there.
  STORAGE_API_URL: z.string().url(),
  STORAGE_API_KEY: z.string().startsWith("rsk_"),

  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1).default("reel_studio"),

  // The only Clerk user allowed into the app.
  OWNER_USER_ID: z.string().min(1),
  // Bearer tokens for non-browser clients. Generate with `openssl rand -hex 32`.
  SHORTCUT_TOKEN: z.string().min(32),
  AGENT_TOKEN: z.string().min(32),

  // Captions screen. Optional so the Library works before you add a key.
  GEMINI_API_KEY: z.string().min(1).optional(),
  // "gemini-flash-latest" follows Google's newest Flash model; pin a version here if you prefer.
  GEMINI_MODEL: z.string().min(1).default("gemini-flash-latest"),
  // Optional: with a key, Claude writes the captions from your Social Media Manager prompt
  // (Gemini still watches the video). Without one, Gemini does both.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CLAUDE_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Reel Studio is missing or has invalid env vars: ${missing}`);
    }
    cached = parsed.data;
  }
  return cached;
}
