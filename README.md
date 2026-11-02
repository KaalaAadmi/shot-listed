# Reel Studio

Turns saved Instagram reels into plans you can shoot and edit, using your own photos
and videos. This repo is being built in phases. Built so far:

- **Media library:** your photos and clips, managed from a Next.js web app on Vercel.
  The files and their records live in the separate **r2-storage** service (Cloudflare
  R2 for the files, its own MongoDB database for the details); Reel Studio talks to it
  through a small connector (`web/src/lib/storage/`).
- **Captions from your final cut:** upload the reel you exported from Edits; Gemini
  watches it with sound, describes it, and your v3.0 Social Media Manager prompt writes
  three caption options with keywords, hashtags, a recommended pick and a review,
  ready to copy into Instagram.

```
web/               Next.js 16 app (Vercel): Library, Captions, Settings, API
web/src/lib/storage/  Connector for the r2-storage service
docs/mac-agent.md  What the Mac mini agent will do once you have the Mac
docs/              PRD, TRD, APP_FLOW, DATABASE_SCHEMA, IMPLEMENTATION_PLAN, SPLIT_GUIDE
prompts/           Every model prompt, its output schema and test cases (README inside)
```

## How uploads work

The phone never sends files through Vercel. Reel Studio asks the storage service for a
short-lived signed URL and the browser uploads straight to R2:

1. The browser hashes the file (SHA-256, 8 MiB at a time; the row shows **Checking**).
2. `POST /api/media/uploads` with name, type, size and the hash.
   - Under 64 MB: the reply is one signed PUT URL.
   - Over 64 MB (most videos): the reply is a multipart plan. The browser asks for part
     URLs in batches, uploads 4 parts at a time, and retries a failed part up to 3 times.
   - Same bytes already stored (from any device): the reply is `duplicate` and nothing
     is sent.
   - An earlier attempt at the same file stopped part-way: the reply is `resume` with the
     parts R2 already has, and only the rest are sent. Retry does the same.
3. `POST /api/media/uploads/{id}/complete`. The storage service asks R2 for the stored
   size and only marks the item uploaded if it matches.

These routes check who is calling (your session, the Shortcut's or the Mac agent's
token) and pass the request to the storage service with Reel Studio's API key. Files
land at `apps/shot-listed/<collection>/YYYY/MM/<id>.<ext>` (`library` or `finals`). The
bucket stays private; the Library shows items through signed URLs that expire after an
hour.

## Captions from your final cut

1. **Captions → Choose your final cut**, pick the export from your camera roll, and
   optionally add notes (comment keyword, location, what you want people to do).
2. The video uploads like any other file (into storage's `finals` collection), then three steps run in the background
   and show live on the page: **Send to Gemini**, **Watch and describe**, **Write captions**.
   A failed step shows its error and a **Retry from here** button.
3. You get, following your Social Media Manager prompt (v3.0):
   - A **description**: summary, the hook in the first 3 seconds, shot-by-shot beats,
     on-screen text and speech verbatim, audio, setting and mood. This is what the
     caption writer reads. **Copy description** gives you the same text for any other chat.
   - A **review**: an honest rating, the past reel it's most like, the lesson from that
     reel, one thing to improve, and whether to post it as a **Trial**.
   - **Three caption options** in your structure (hook, 1–2 context lines, a question),
     each with its own 3–5 hashtags. One is marked **Recommended**, with the reason.
   - **Keywords woven in**: the 4–6 phrases and which option and line carry each.
4. Tap an option to select it, edit the text or the hashtag line in place (saved as you
   type), and check the preview of how it will look on Instagram, with character and
   hashtag counts.
5. **Copy caption** gives you the whole caption with its line breaks already in it, since
   you can't add new lines while posting:
   - each line of your structure stays on its own line, hashtags on the last one;
   - blank lines, if any, hold an invisible character (U+2800, Braille Pattern Blank),
     because Instagram drops truly empty lines;
   - spaces at the start and end of each line are removed, since a trailing space can
     swallow the line break.
6. **New captions** writes a fresh round, optionally with direction ("drier", "lean into
   the anime angle"). It reuses the description, so it's quick and cheap.
7. **Delete video** frees the R2 space but keeps the description and captions.

Settings → **Caption voice** holds the two texts every round uses, editable in place:
your **Social Media Manager prompt** and your **Content history**. Both start as the v3.0
versions you gave, and each has **Restore default**. Add each new reel's numbers to the
content history so the review compares against them. The app adds a short note after
your prompt so the answer comes back as cards instead of the Section 8 text layout; it
doesn't change your rules. Settings also has where hashtags go (end of caption or first
comment) and an optional blank line before them, off by default to match your line 5.

**Which model does what:** Gemini watches the video, because it takes video with its
audio track, so voiceover, music and on-screen text all reach the description without
ffmpeg or a separate transcriber. The captions are written by **Claude** if you set
`ANTHROPIC_API_KEY` (your prompt was written for Claude), or by Gemini if you don't.
The screen shows which one wrote each round.

**Privacy and cost:** on Gemini's free tier, Google may use what you send to improve
its products; on the paid tier it does not. Check the current
[Gemini API terms](https://ai.google.dev/gemini-api/terms) before choosing. Video costs
roughly 100–300 tokens per second depending on resolution, so a 30–60 second reel is
a few thousand to about 18,000 tokens. Each caption round sends your prompt and history
(about 4,000 tokens) plus the description, and gets about 1,500 back; with Claude Sonnet
5.5 that is roughly 2–5 cents a round.

## Library source: phone now, Mac mini later

Settings has a **Library source** switch:

- **Upload from my phone** (default). Add photos and videos from the Library screen.
  Tip: in Safari, Share → **Add to Home Screen** so it opens like an app.
- **Sync from the Mac mini.** The agent described in `docs/mac-agent.md` reads your
  iCloud Photos library and uploads new items itself. The server side is already built:
  the agent checks in, sees the setting and syncs only while the Mac is selected. Phone
  uploads keep working in this mode, for Film it takes.

Both write to the same storage collection, so switching loses nothing; a photo the phone
already uploaded is recognised by its content hash and never stored twice.

## Setup (about 30 minutes)

### 1. The storage service

Set up and deploy the **r2-storage** repo first; its README walks through the R2
bucket, its own Atlas project and the Vercel deploy. Then create Reel Studio's key there:

```bash
ADMIN_TOKEN=... npm run create-key -- --url https://<your-storage>.vercel.app \
  --app shot-listed --name vercel --scopes read,write,delete
```

Keep the printed `rsk_…` key for `STORAGE_API_KEY` below. Add Reel Studio's domain to
the bucket's CORS rule in that repo's `infra/r2-cors.json` once you know it.

### 2. MongoDB Atlas

Use an M0 (free) cluster, in a different Atlas project from the storage service's, so
each gets its own free 512 MB. Create a database user, allow access from anywhere
(`0.0.0.0/0`; Vercel has no fixed IPs), and copy the connection string. Collections and
indexes are created on first use.

### 3. Clerk

Create an application, copy the two keys, sign in to the deployed app once, then copy
your user ID (`user_…`) from Clerk → Users into `OWNER_USER_ID`. Any other account is
refused even if it signs in. In Clerk, also set the sign-up mode to Restricted so nobody else can make an account.

### 4. Vercel

1. Push this repo to GitHub and import it in Vercel with **Root Directory** set to `web`.
2. Add every variable from `web/.env.example`, including `STORAGE_API_URL` and
   `STORAGE_API_KEY`. Generate the two tokens with `openssl rand -hex 32`. Get
   `GEMINI_API_KEY` from Google AI Studio.
3. Deploy, then add the deployed domain to the R2 bucket's CORS rule (r2-storage repo).
4. Run `npm run check:storage` locally with the same two storage values in `.env.local`.

## Local development

```bash
cd web
cp .env.example .env.local   # fill it in
npm install
npm run dev                  # http://localhost:3000
```

Checks:

```bash
npm run typecheck
npm run lint
npm test                     # formatter, caption engine (stub model), hashing, resume, storage client
npm run check:storage        # the storage service is reachable and works with your key
```

For local work you can run the storage service on your machine with no database
(`npm run start:memory` in the r2-storage repo) and point `STORAGE_API_URL` at
`http://localhost:8787`.

## API

| Route | Who | What |
| --- | --- | --- |
| `POST /api/media/uploads` | you, Shortcut, agent | Start an upload, resume one, or report a duplicate |
| `GET /api/media/uploads/{id}` | you, Shortcut, agent | Resume state of an unfinished upload |
| `POST /api/media/uploads/{id}/parts` | you, Shortcut, agent | Signed URLs for multipart parts |
| `POST /api/media/uploads/{id}/complete` | you, Shortcut, agent | Finish and verify |
| `DELETE /api/media/uploads/{id}` | you, Shortcut, agent | Cancel an unfinished upload |
| `GET /api/media/assets` | you | Library page, filters, storage used |
| `GET` / `DELETE /api/media/assets/{id}` | you (GET also agent) | One item; delete removes it from storage |
| `GET /api/media/assets/{id}/download` | you | Download the original |
| `GET` / `PUT /api/settings` | you | Library source, caption instructions, goal, hashtag placement |
| `GET` / `POST /api/finals` | you (POST also Shortcut) | List final cuts; register an uploaded one and start the engine |
| `GET` / `PATCH` / `DELETE /api/finals/{id}` | you | One final cut; rename, save notes or selected caption; delete |
| `POST /api/finals/{id}/run` | you | Retry from the failed step, or `{"from":"captions","direction":"…"}` for a new round |
| `DELETE /api/finals/{id}/video` | you | Delete the video, keep the text |
| `POST /api/agent/heartbeat` | agent | Mac check-in; returns whether to sync |
| `GET /api/agent/status` | you | Mac status for Settings |

"You" means your Clerk session. The Shortcut and the agent send their token in the
`X-Reel-Token` header (not `Authorization`, which Clerk reserves for its own sessions).

## Storage budget

R2's free tier is 10 GB, and iPhone 4K video is roughly 300–400 MB a minute. For now
the Library shows how much you've used. The next phase adds the pipeline host, which
turns each video into a 1080p SDR proxy and can drop the original, so the free tier
holds far more. Until then, upload the clips you'd actually use.

## Next

Full plan with what's done: `docs/IMPLEMENTATION_PLAN.md`. How storage was split out:
`docs/SPLIT_GUIDE.md`.

1. Deploy both projects and run the checks in `docs/SPLIT_GUIDE.md` §3.
2. Pipeline host on the free Oracle VM: proxies, thumbnails, AI tagging and search.
3. Share-a-reel Shortcut (uses `SHORTCUT_TOKEN`) and the reel analysis.
4. Live pipeline view for the full reel plan; the Captions screen's step strip is its
   first, simpler version.
5. Mac mini agent, once the Mac arrives.
