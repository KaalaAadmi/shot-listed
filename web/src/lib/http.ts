import "server-only";
import { z } from "zod";
import { HttpError } from "./auth";
import { StorageError } from "./storage/client.ts";

/** Wrap a route body so thrown HttpErrors and validation errors become clean JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof StorageError) {
      // The storage service's own 4xx messages are meant for people ("Already finished",
      // "Not found"); its 5xx details stay in the logs.
      if (err.status < 500) return Response.json({ error: err.message }, { status: err.status });
      console.error(err);
      return Response.json({ error: "The storage service had a problem. Try again in a moment." }, { status: 502 });
    }
    if (err instanceof z.ZodError) {
      return Response.json({ error: "Invalid request", issues: err.issues }, { status: 400 });
    }
    // Details go to the Vercel logs, not the caller; they can include hostnames or keys.
    console.error(err);
    return Response.json({ error: "Something went wrong on the server. Check the Vercel logs." }, { status: 500 });
  }
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  return schema.parse(body);
}
