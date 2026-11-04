# ShotListed — Implementation Plan

`[x]` = done (built, typechecked, tested; not yet deployed). `[ ]` = to do. Each phase ends with **Done when**: the check that proves it works.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: app, auth, database | Done |
| 2 | Media library on R2 | Done (moved to `r2-storage` in phase 4) |
| 3 | Captions from the final cut, on your v3.0 prompt | Done |
| 3b | Caption drafts and feedback; check the description | Done (doesn't need the pipeline host; can ship before or with phase 5) |
| 4 | Split storage into `r2-storage` | Done in code; deploy with phase 5 |
| 5 | **Deploy and first live run** | In progress: deployed; Clerk check, Gemini key and the first real run remain |
| 6 | Pipeline host and library indexing | Done in code, not tested live; VM not set up; one optional item open |
| 7 | Share a reel, analysis, verdict, Inbox | Done in code, not tested live |
| 8 | Reel Plan, plan chat and the live pipeline view | Done in code, not tested live; reference frame open |
| 8b | Your own ideas: idea chat and brief | Done in code, not tested live |
| 9 | Film it takes, clip pack, Shoot list | Done in code, not tested live; two items open |
| 10 | Board and closing the loop | Done in code, not tested live |
| 11 | Collection backlog sync | To do, optional |
| 12 | Mac mini | After Cyber Monday |
| 13 | HyperFrames preview cut | Optional |

---

## Phase 1 — Foundation (Done)

- [x] Next.js 16 app in `web/`, Tailwind 4, local Geist fonts, Cache Components off
- [x] Clerk (Core 3) sign-in; single owner via `OWNER_USER_ID`; `Show` for signed-in UI
- [x] `X-Reel-Token` callers: Shortcut and Mac agent, compared in constant time
- [x] MongoDB Atlas client with a small pool and indexes created on first use
- [x] JSON error handling that hides server details
- [x] `npm run typecheck`, `lint`, `test`, `build`

## Phase 2 — Media library (Done)

- [x] Presigned single PUT (≤ 64 MB) and multipart uploads (8 MiB parts) straight to R2
- [x] Size checked against R2 on completion; stale uploads cleaned after 24 h without activity
- [x] Duplicates by content hash: SHA-256 in the browser (**Checking** state), Photos UUID first, then the hash per purpose; the Mac's Photos UUID adopted onto an item the phone uploaded first
- [x] Resuming: a stopped upload carries on (Retry or pick again) with the parts R2 has; idempotent complete; `GET /api/media/uploads/{id}` for the Mac agent
- [x] Library screen: uploader with progress, retries, cancel, wake lock; grid; filters; preview; download; delete; usage bar
- [x] Settings: library source switch; Mac agent heartbeat and status
- [x] `docs/mac-agent.md` contract
- [x] Tests: policy, keys, S3 round trips and `listParts` against moto, hash and duplicate/resume rules

## Phase 3 — Captions (Done)

- [x] Final-cut uploads (`purpose: "final-cut"`, video only, < 500 MB), with the same hashing and resuming
- [x] Background run with three steps (watch, describe, captions), live strip, retry, stale-run detection
- [x] Gemini watches with sound and returns a structured description
- [x] Your v3.0 prompt and content history as the caption system prompt; three options with per-option hashtags, keywords woven, review, Trial
- [x] Claude writes captions when `ANTHROPIC_API_KEY` is set; Gemini otherwise
- [x] Editor for text and hashtags, Instagram preview, counts and warnings, Copy caption / hashtags / first comment
- [x] Settings → Caption voice with Restore default; hashtag placement; optional blank line
- [x] Delete video keeps the text
- [x] Tests: engine with stubbed models, schema compatible with Claude, Instagram formatting

## Phase 3b — Caption drafts and feedback

Design: TRD §3.3a; flow: APP_FLOW §3.3a.

- [x] Prompt loader (`web/src/lib/prompts.ts`, bundled by `npm run prompts`): fills `{{variables}}`, returns the prompt ID and version; `describe-reel` and `write-captions` moved into `prompts/`
- [x] Settings → **Creator profile** (default from `prompts/creator-profile.default.md`)
- [x] `review` step between `describe` and `captions`; editable description; **Write captions** saves edits (`descriptionEdited`) and continues
- [x] Settings → Captions → **Check the description first** (default on)
- [x] `finals.draft`: **Add to draft** per line, **Use these hashtags** per option, free editing and reordering, preview and counts
- [x] `POST /api/finals/{id}/feedback` with `prompts/caption-feedback.md`: closed reply schema (verdict, score, checks, suggestions, answer), last 10 turns as context, Claude or Gemini
- [x] Code checks override model claims for counts, hashtags and blank lines
- [x] **Apply** per suggestion; thread saved (30 turns); **Clear**
- [x] **Use this** sets the draft as the selected caption
- [x] Tests: schema accepted by both models (stubbed), code checks win, suggestions apply (`tests/feedback.test.mts`). Review pause/resume is untested: it lives in `finals.ts`, which needs Mongo.

**Done when:** on a real final cut, correcting one misread overlay changes the captions that follow, and a draft built from lines of two options gets feedback with at least one applicable suggestion in under 20 seconds.

## Phase 4 — Split storage into `r2-storage` (Done in code)

Done before the first deploy, so there is no data to migrate. Details: `SPLIT_GUIDE.md`.

- [x] Build `r2-storage` (its plan, steps S1–S7): Hono on Vercel, its own MongoDB database, everything tested with moto and an in-memory store
- [x] `web/src/lib/storage/client.ts`, `connector.ts`, `types.ts`
- [x] `/api/media/uploads/**` and `/api/media/assets/**` are proxies; URLs and request shapes unchanged
- [x] Library lists from storage (`library_items` waits for phase 6, when it has something to hold)
- [x] `finals.ts` reads, downloads and deletes through the connector
- [x] `R2_*` env vars, the AWS SDK, the R2 helpers, the `assets` collection and `tests/r2.test.mts` removed
- [x] `npm run check:storage`; storage client tests
- [x] Both repos' checks pass; the storage smoke test and `check:storage` pass against a local storage server
- [ ] Run the storage repo's store tests against MongoDB once (`MONGODB_TEST_URI`)
- [x] Deploy `r2-storage` and create ShotListed's key (storage plan S7)

**Done when:** `check:storage` passes against the deployed service, and the phone checklist in `SPLIT_GUIDE.md` §3 passes: the same photo twice is **Already in library**, and a large video cut off with Airplane mode resumes and shows as one copy.

## Phase 5 — Deploy and first live run

- [x] Deploy `r2-storage` first (its plan, step S7): R2 bucket and rules, its own Atlas project, Vercel project, `npm run smoke`
- [x] ShotListed's own Atlas project and M0 cluster, user, network access `0.0.0.0/0`
- [ ] Clerk app, sign-up mode Restricted, `OWNER_USER_ID`
- [x] Vercel project, root `web`, all env vars including `STORAGE_API_URL` and `STORAGE_API_KEY`, deploy
- [x] Add ShotListed's Vercel domain to the bucket's CORS rule; `npm run check:storage`
- [ ] Gemini key (paid tier recommended); Anthropic key if Claude writes captions
- [ ] Upload 20 real clips; caption one real final cut

**Done when:** a real final cut goes from upload to copied caption on your phone in under 2 minutes, and the pasted caption keeps its line breaks in Instagram.

## Phase 6 — Pipeline host and library indexing

- [ ] Oracle Always Free Arm VM (2 OCPU, 12 GB): create it and install ffmpeg, exiftool, Python 3.12, `uv`; systemd service (the unit file and steps are in `pipeline/README.md`; the VM itself isn't set up)
- [x] `pipeline/` package: config, ShotListed API client, storage client (its own `pipeline-host` key), job loop with lease heartbeat, prompt loader for `prompts/` (same rules as the web one); `VISION_MODEL`
- [x] Web: `HOST_TOKEN`, `/api/host/jobs/claim|heartbeat|complete|fail`, `jobs` collection
- [x] `library_items` collection; the Library lists from it and gets links with storage's `POST /v1/assets/urls`
- [x] Job `index-asset`: proxy (1080p H.264 SDR) and thumbnail as storage variants, tags (`prompts/library-tagger.md`), embedding → `library_items`
- [x] Enqueue `index-asset` on every library upload; backfill existing items
- [x] Library: search in plain words, tag chips you can correct, exclude toggle, thumbnails from variants
- [ ] Optional storage saving: drop originals once the proxy exists
- [x] Indexing also: recompute SHA-256 (fix storage if different), read capture data (exiftool first, then Pillow or ffprobe), perceptual hashes (`imagehash`; three frames per video)
- [x] Same-shot matching and verdicts (TRD §4.1); `duplicates` collection
- [x] Library: **Possible duplicates** review, **Merged** list with Undo for 7 days, **Possible: final cut** flag
- [x] Merging (no host job): the web app merges pairs after the 7-day undo window (`mergeDueSoon`, at most hourly): storage merge, plan, alternate and take references moved to the kept item, re-index if the original changed
- [x] Light indexing for final cuts (hash, duration, frame hashes)

**Not tested live:** the whole phase has only run against generated files and stubs. **Done when:** a new upload is tagged within 2 minutes; searching "gym mirror selfie" finds the right clips; the usage bar shows the space saved by proxies; uploading the same photo once as HEIC and once as JPEG ends as one item keeping the HEIC, while a 10-shot burst stays 10 items.

## Phase 7 — Share a reel, analysis, verdict

- [x] `inspirations` collection; `POST /api/inspirations` (owner or Shortcut)
- [x] iOS Shortcut: share sheet → link and note → ShotListed; setup steps in the README
- [x] Job `ingest-inspiration`: yt-dlp with the burner's cookies; store the video; manual upload fallback
- [x] Job `analyse-inspiration`: Gemini watches with sound (`prompts/inspiration-analysis.md`); `prompts/viability-judge.md` scores it; code computes score and verdict, with format freshness from posted plans
- [x] `runs` collection and run events from the host
- [x] Inbox screen with progress bars, verdicts, Make anyway
- [x] Phone notification when the verdict is in (ntfy; Telegram not built)

**Done when:** sharing a reel from Instagram gives a verdict with a reason in under 3 minutes, without opening the app.

## Phase 8 — Reel Plan and live pipeline view

- [x] Shared `conceptSchema`; inspiration analysis writes `inspirations.concept`
- [x] Planning takes `{ source, concept }` and runs in the web app's background (`after()`), not as a host job: beat-to-clip matching (embedding search, then `prompts/clip-grader.md` grades the top 5 Exact/Works/Weak/No); never place Weak
- [x] Pexels search for stock-appropriate beats only; `stock` cache; credits
- [x] Film it cards for unfilled beats
- [ ] The inspiration's reference frame on Film it cards (the field `referenceFrameAssetId` exists and the take checker accepts it, but nothing saves a frame yet)
- [x] Hooks (3), on-screen text per shot, Film it directions, audio and edit notes (`prompts/plan-writer.md`); Shoot day label from code
- [x] Reel Plan screen: shots with alternates (tap to swap), copy buttons, re-run a single step
- [x] Live pipeline view (React Flow) driven by `runs`; tap a node for its output; Retry from here
- [x] Plan chat: `POST /api/plans/{id}/messages` with operations (`prompts/plan-chat.md`; long chats folded by `prompts/chat-summariser.md`); instant ones applied with a new version; `find_clip` searches in the web app (no host job); **Undo** (last 10 versions)

**Done when:** a Make verdict becomes a plan in under 5 minutes, with every shot either a graded clip, a credited stock clip or a Film it card; and "I don't have that shot" in the plan chat either finds a graded clip or turns the shot into a Film it card.

## Phase 8b — Your own ideas

Design: TRD §3.7; flow: APP_FLOW §3.6a. Needs phase 8 (planning) and phase 6 (an indexed library).

- [x] `ideas` collection; Ideas list and `/ideas/[id]`
- [x] Idea chat: `POST /api/ideas/{id}/messages` with `prompts/idea-coach.md` (Creator profile, content history, recent formats); older turns summarised past 60 (`prompts/chat-summariser.md`)
- [x] **Make the brief** and **Paste a brief** with `prompts/brief-maker.md`: structured concept (`prompts/schemas/concept.json`, shared with inspiration analysis); editable fields; assumptions and questions shown
- [x] Viability for ideas (`prompts/viability-judge.md`): shown, never blocks
- [x] **Make the plan** builds a plan with `source: { kind: "idea" }`
- [x] Tests: concept schema accepted by both models; a pasted brief round-trips; a plan from an idea matches one from an equivalent inspiration

**Done when:** a two-minute chat about an idea of yours ends in a brief, and **Make the plan** gives a shot list using your clips, with Film it cards only where nothing fits.

## Phase 9 — Film it takes, clip pack, Shoot list

- [x] Upload takes onto a card (ordinary library uploads, linked to the card)
- [ ] Offer recent library clips as takes (today a take can only be uploaded)
- [x] Job `check-take`: ffmpeg technical checks, then `prompts/take-checker.md` compares the take with the card and reference frame; Pass / Usable / Reshoot; Use anyway
- [x] Job `clip-pack`: trims with half-second handles, numbered names, zip in storage, link on the plan
- [x] Shoot list screen grouping open cards by location

**Done when:** a deliberately bad take (horizontal, too dark) gets Reshoot with a specific fix, and the clip pack opens in Edits in shot order.

## Phase 10 — Board and closing the loop

- [x] Board screen (Planned → Filming → Editing → Ready to post → Posted)
- [x] Link a final cut to its plan; captions see the plan's hooks and intent
- [x] Mark Posted; type the numbers; optional: `prompts/content-history-writer.md` drafts the entry, **Add to history** appends it to Settings → Content history
- [x] Format freshness reads posted plans

**Done when:** posting two similar formats in a row lowers the second one's viability score.

## Phase 11 — Collection backlog sync (optional)

- [ ] Burner account and persistent Playwright profile on a home machine
- [ ] Job `sync-collection`: one-off backfill, then a daily diff; at most 50 scrolls a day, random times
- [ ] New saves enqueue `ingest-inspiration`

**Done when:** saving a reel to the collection on your main account shows up in the Inbox the next day.

## Phase 12 — Mac mini (after Cyber Monday)

- [ ] `pipeline macsync` command: osxphotos reads the Photos library, skips screenshots and documents, uploads new items through ShotListed with `AGENT_TOKEN`, the Photos UUID and the content hash
- [ ] Web: `POST /api/agent/match` (skip / upload, attaching the Photos UUID to existing items); the agent computes capture data and perceptual hashes before asking
- [ ] Agent resumes interrupted uploads with `GET /api/media/uploads/{id}` instead of deleting them
- [ ] launchd service; heartbeat every 5 minutes
- [ ] Clip pack as a Photos album (osxphotos import) instead of a zip
- [ ] Optional: move the pipeline host from the VM to the Mac

**Done when:** a photo taken on your phone appears in the Library within 15 minutes with no upload by hand; after the first full sync, nothing you had uploaded from the phone exists twice (each such item has its Photos ID, and the better file); and the clip pack shows up as an album on your phone.

## Phase 13 — Preview cut (optional)

- [ ] HyperFrames template: shots in order, on-screen text burned in, at 1080×1920
- [ ] Job `preview-cut`; result linked from the plan

**Done when:** each plan can produce a rough preview with its text in under 2 minutes.
