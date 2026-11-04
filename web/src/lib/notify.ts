import "server-only";
import { env } from "./env";

/** A phone notification through ntfy.sh when NTFY_TOPIC is set. Never throws: a missed buzz must not fail the work. */
export async function notify(message: string, click?: string): Promise<void> {
  const topic = env().NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    body: message,
    headers: { Title: "ShotListed", ...(click ? { Click: click } : {}) },
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}
