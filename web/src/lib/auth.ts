import "server-only";
import { timingSafeEqual } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { env } from "./env";

/** Who is calling: you in the browser, the iOS Shortcut, or the Mac mini agent. */
export type Caller = "owner" | "shortcut" | "agent";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Kept separate from `Authorization`, which Clerk reads as its own session token. */
export const TOKEN_HEADER = "x-reel-token";

/**
 * Routes list which callers they accept. A token in X-Reel-Token is checked first so the
 * Shortcut and the agent never need a Clerk session; otherwise the Clerk user must
 * be the single owner configured in OWNER_USER_ID.
 */
export async function authorize(req: Request, allowed: Caller[]): Promise<Caller> {
  const token = req.headers.get(TOKEN_HEADER)?.trim();
  if (token) {
    const { SHORTCUT_TOKEN, AGENT_TOKEN } = env();
    if (allowed.includes("shortcut") && sameSecret(token, SHORTCUT_TOKEN)) return "shortcut";
    if (allowed.includes("agent") && sameSecret(token, AGENT_TOKEN)) return "agent";
    throw new HttpError(401, "Invalid token");
  }

  if (!allowed.includes("owner")) throw new HttpError(401, "Token required");
  const { userId } = await auth();
  if (!userId) throw new HttpError(401, "Sign in required");
  if (userId !== env().OWNER_USER_ID) throw new HttpError(403, "This Reel Studio belongs to someone else");
  return "owner";
}
