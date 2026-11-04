# ShotListed — Database Schema

MongoDB Atlas (M0, its own Atlas project), database `reel_studio`. Media files and their records are not stored here: they live in R2 behind the `r2-storage` service, which keeps its records in its own MongoDB database (see that repo's `docs/DATABASE_SCHEMA.md`).

Status legend: **Done** (exists in code), **Changes in the split**, **Planned**.

| Collection | Holds | Status |
| --- | --- | --- |
| `assets` | Uploaded files and their R2 keys | **Moved** to the storage service's database in the split |
| `settings` | Library source, caption voice, hashtag preferences | Done |
| `agents` | Mac mini check-ins | Done |
| `finals` | Final cuts: steps, description, caption rounds, your pick | Done |
| `library_items` | What ShotListed knows about each storage asset: tags, embedding, capture data, perceptual hashes | Done |
| `duplicates` | Pairs of items that show the same shot, and what you decided | Done |
| `inspirations` | Shared or synced reels, their analysis and verdict | Done |
| `ideas` | Your own ideas: the idea chat and the brief it ends in | Done |
| `plans` | Reel Plans: hooks, shots, Film it cards, takes, clip pack, plan chat and versions | Done |
| `stock` | Cached Pexels searches | Done |
| `jobs` | Work queue for the pipeline host | Done |
| `runs` | Step events behind the live pipeline view | Done |

IDs are UUID strings (`crypto.randomUUID()`), except `settings` (`"app"`) and `agents` (machine name). Dates are BSON dates; the API serialises them as ISO strings.

Every stored model result (descriptions, caption rounds, feedback turns, tags, analyses, grades, plans, take checks) carries `promptId` and `promptVersion` from the prompt file that produced it (see `prompts/README.md`). Results from before this rule (the existing caption engine) don't have them.

---

## `assets` — Moved to the storage service

Before the split, ShotListed kept one `assets` document per uploaded file here. That collection now lives in the `r2-storage` service's own database (`r2_storage`, in its own Atlas project), with the same fields plus `app`, `collection` (was `purpose`: `library`, `finals`) and `metadata.origin` (was `origin`). See that repo's `docs/DATABASE_SCHEMA.md`.

ShotListed no longer reads or writes it; it asks the storage API. Asset IDs are the same strings everywhere: `finals.assetId` and, from phase 6, `library_items._id` are storage asset IDs. Nothing was uploaded to production before the split; if a development database still has an `assets` collection, it is unused and can be dropped.

## `settings` — Done

One document, `_id: "app"`. Unset fields fall back to defaults in code.

| Field | Type | Default |
| --- | --- | --- |
| `ingestMode` | `"phone-upload" \| "mac-photos"` | `"phone-upload"` |
| `captionSystemPrompt` | string? | Your v3.0 prompt (`captions/default-voice.ts`) |
| `captionContentHistory` | string? | Your content history reference |
| `hashtagPlacement` | `"caption" \| "first-comment"` | `"caption"` |
| `blankLineBeforeHashtags` | boolean | `false` |
| `creatorProfile` | string?  | `prompts/creator-profile.default.md` |
| `checkDescriptionFirst` | boolean  | `true` |
| `updatedAt` | Date | |

Setting a prompt field to `null` through the API removes it, which restores the default. Older documents may still carry `captionInstructions` or `captionGoal` from the first captions build; they are ignored.

## `agents` — Done

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | Machine name, e.g. `mac-mini` |
| `version` | string | Agent version |
| `photosCount` | number? | Items in the Photos library |
| `lastSyncAt` | Date? | |
| `lastSeenAt` | Date | Online if within 15 minutes |

## `finals` — Done

Defined as `FinalDoc` in `web/src/lib/types.ts`.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | UUID |
| `assetId` | string \| null | The final cut's storage asset; `null` after **Delete video** |
| `title`, `titleIsDefault` | string, boolean? | The model's title replaces the file name until you rename it |
| `notes` | string | Your context for the caption writer |
| `steps` | `{ watch, describe, captions }`; `review` between `describe` and `captions` | Each `{ status: "waiting" \| "running" \| "done" \| "failed", startedAt?, finishedAt?, error? }`; `review` also uses `needs_you` and `skipped` |
| `modelFile` | `{ name, uri, mimeType }`? | The Gemini file between watch and describe; removed after |
| `description` | object? | See below |
| `captions` | object? | See below |
| `selected` | `{ captionId, text, hashtags[] }`? | Your pick and edits; `captionId: "draft"` when it came from your draft |
| `descriptionEdited` | boolean? | You corrected the description at the review step |
| `draft` | `{ lines: string[], hashtags: string[], updatedAt }`? | Your own caption built from parts of the options |
| `feedback` | object[]? | The feedback thread, up to 30 turns. Each `{ at, question?, draft: { lines, hashtags }, reply: { verdict, score, checks, suggestions[], answer }, writtenBy }` |
| `createdAt`, `updatedAt` | Date | |

`description`:

- `title`, `summary`, `hook`;
- `beats[]`, each `{ start, end, visual, onScreenText, audio }`;
- `spokenWords`, `onScreenText[]`, `audio`, `setting`, `mood`, `callToAction`;
- `durationSeconds`, `plainDescription`.

`captions` (from the v3.0 prompt):

- `options[]`, each `{ id, angle, text, hashtags[], keywords[], recommended }`, where `text` holds the hook, context lines and question, one per line;
- `recommendedWhy`;
- `keywordsWoven[]`, each `{ phrase, where }`;
- `feedback`: `{ rating, mostSimilarReel, lesson, improvement }`;
- `trial`: `{ recommended, reason }`;
- `writtenBy`.

Rounds written before the v3.0 change have one shared `hashtags[]` and no feedback; `normaliseCaptions()` in `finals.ts` fills the gaps when reading.

Indexes: `{ createdAt: -1 }`, `{ assetId: 1 }`.

Also: `planId` (the plan it came from; its hooks and intent go to the caption writer), `descriptionPrompt`, `captionsPrompt`, `FeedbackTurn.prompt` (prompt stamps, `id@version`).

---

## `library_items` — Done

One per storage asset ShotListed cares about, created when indexing arrives in phase 6 (until then the Library lists straight from storage). `_id` equals the storage asset ID, so no mapping table is needed.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | Storage asset ID |
| `purpose` | `"library" \| "final-cut" \| "take"` | Takes are library items tied to a Film it card |
| `origin` | `"phone-upload" \| "mac-photos" \| "shortcut"` | |
| `kind`, `filename`, `contentType`, `size`, `takenAt` | | Copied from storage for listing without a round trip |
| `durationS`, `width`, `height` | number? | From ffprobe or exiftool during indexing; width and height after rotation |
| `contentHash` | string | SHA-256 of the stored original; same as storage's, re-checked during indexing |
| `externalId` | string? | Photos library UUID, once the Mac has seen this item |
| `capture` | `{ at: Date, subsec?: number, tz?: string, camera?: string }`? | From the file's metadata |
| `phash` | string[]? | 64-bit perceptual hashes as hex: one for a photo, three for a video (10%, 50%, 90%) |
| `hiddenAsDuplicateOf` | string? | Set while a **Same** match waits out its 7-day undo window |
| `variants` | `{ proxy: boolean, thumb: boolean }` | Which derived files exist in storage |
| `index` | `{ status: "pending" \| "processing" \| "indexed" \| "failed", error?, at }` | |
| `tags` | object? | `caption`, `setting`, `shotType`, `orientation`, `mood`, `quality`, `peopleCount`, `place` |
| `embedding` | number[]? | Embedding of `tags.caption`; about 6 KB at 768 dimensions |
| `excluded` | boolean | Never offered in plans |
| `filmIt` | `{ planId, shot }`? | For takes |
| `createdAt`, `updatedAt` | Date | |

Indexes: `{ purpose: 1, createdAt: -1 }`, `{ "index.status": 1 }`, `{ kind: 1, createdAt: -1 }`, `{ "filmIt.planId": 1 }`, `{ kind: 1, "capture.at": 1 }` (duplicate candidates), `{ contentHash: 1 }`, `{ externalId: 1 }` (unique, partial: strings only).

Size check: 5,000 items × ~15 KB ≈ 75 MB, well inside 512 MB.

## `duplicates` — Done

One document per pair. Rules in TRD §4.1.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | `<older item ID>:<newer item ID>`, so a pair is recorded once |
| `keepId`, `otherId` | string | The older item keeps its ID |
| `verdict` | `"same" \| "possible" \| "final-cut"` | |
| `evidence` | object | `{ secondsApart, subsecMatch, hashDistance, durationDiff, sameBytes }` |
| `betterFile` | `"keep" \| "other"` | Which original survives a merge |
| `status` | `"waiting" \| "open" \| "merged" \| "kept-both" \| "undone"` | `waiting` = **Same**, in its undo window; `open` = needs you |
| `mergeAfter` | Date? | For `waiting`: creation + 7 days |
| `createdAt`, `resolvedAt` | Date | |

Indexes: `{ status: 1, mergeAfter: 1 }` (the daily merge job), `{ keepId: 1 }`, `{ otherId: 1 }`. `kept-both` pairs are kept forever so they are never suggested again.

## `inspirations` — Done

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | UUID |
| `url`, `shortcode` | string | `shortcode` unique |
| `source` | `"share" \| "sync" \| "upload"` | |
| `note` | string | Your note from the share sheet |
| `status` | `"queued" \| "downloading" \| "analysing" \| "scored" \| "planned" \| "skipped" \| "failed"` | |
| `storageAssetId` | string? | The downloaded reel (storage collection `inspirations`) |
| `meta` | object | `creator`, `caption`, `views`, `likes`, `comments`, `audio: { title, id, url, isOriginal }` |
| `analysis` | object? | `hook`, `beats[]`, `onScreenText[]`, `spokenWords`, `format`, `emotion`, `cta`, `whyItWorks` |
| `concept` | object? | The analysis in the shared plan-input shape (same as `ideas.brief`) |
| `viability` | object? | `score` (0–100), `verdict` (`"make" \| "twist" \| "skip"`), `reason`, `factors: { nicheFit, clipCoverage, effort, formatFreshness, sharePotential }`, `vetoedBy`? |
| `planId` | string? | |
| `runId` | string? | |
| `createdAt`, `updatedAt` | Date | |

Indexes: `{ shortcode: 1 }` (unique), `{ status: 1, createdAt: -1 }`.

## `ideas` — Done

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | UUID |
| `title` | string | From the first message until the brief names it |
| `status` | `"chatting" \| "briefed" \| "planned" \| "dropped"` | |
| `messages` | object[] | `{ at, role: "you" \| "model", text }`, up to 60; older turns folded into `summary` |
| `summary` | string? | What the model remembers of trimmed turns |
| `brief` | object? | The concept: `title`, `format`, `hook`, `lengthSeconds`, `why`, `beats[] { n, seconds, shows, onScreenText, spoken, sound? }`, `onScreenText[]`, `audio { idea, url?, searchTerms[] }` |
| `briefSource` | `"chat" \| "pasted"`? | |
| `viability` | object? | Same shape as `inspirations.viability`; shown, never blocks |
| `planId` | string? | |
| `createdAt`, `updatedAt` | Date | |

Index: `{ status: 1, updatedAt: -1 }`.

## `plans` — Done

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | UUID |
| `source` | `{ kind: "inspiration" \| "idea", id }` | Where the plan came from |
| `concept` | object | Snapshot of the concept it was planned from (see `ideas.brief`; inspirations produce the same shape) |
| `title`, `format` | string | `format` feeds freshness checks |
| `status` | `"planned" \| "filming" \| "editing" \| "ready" \| "posted" \| "skipped"` | Board columns |
| `shootDay` | boolean | More than half the shots need filming |
| `hooks` | string[] | 3 variants |
| `shots` | object[] | See below |
| `audio` | `{ inspiration: { title, url }, searchTerms[] }` | |
| `clipPack` | `{ status, storageAssetId?, album? }` | Zip now, Photos album with the Mac |
| `finalId` | string? | Linked final cut |
| `postedAt` | Date? | |
| `runId` | string? | |
| `createdAt`, `updatedAt` | Date | |

Each shot:

- `n`, `seconds`, `beat` (what the inspiration does here), `onScreenText`;
- `source`: `"library" | "stock" | "film_it"`;
- for library shots: `libraryItemId`, `in`, `out`, `fit` (`"exact" | "works"`), `why`;
- `alternates[]`, each `{ libraryItemId, fit, why }`, including Weak ones, which are shown but never placed;
- for stock shots: `stock: { pexelsId, url, credit }`;
- for Film it shots: `filmIt: { shot, where, framing, lens, movement, textSpace, lightSound, recordSeconds, takes[], referenceFrameAssetId }`;
- `takes[]`, each `{ libraryItemId, verdict: "pass" | "usable" | "reshoot", notes, checkedAt }`;
- `status`: `"open" | "filled"`.

Also: `version` (number, starts at 1), `history[]` (the last 10 shot lists, each `{ version, shots, at, reason }`, for Undo), `chat[]` (plan chat turns `{ at, role, text, operations?, version? }`, up to 60).

Indexes: `{ status: 1, updatedAt: -1 }`, `{ "source.kind": 1, "source.id": 1 }`, `{ postedAt: -1 }`.

## `stock` — Done

`_id` = `query|orientation`; `results[]` of `{ pexelsId, url, credit, duration, width, height }`; `fetchedAt` with a TTL index of 30 days.

## `jobs` — Done

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | UUID |
| `type` | `"index-asset" \| "merge-duplicates" \| "ingest-inspiration" \| "analyse-inspiration" \| "plan" \| "plan-edit" \| "clip-pack" \| "check-take" \| "sync-collection"` | |
| `payload` | object | Job-specific |
| `status` | `"queued" \| "running" \| "done" \| "failed"` | |
| `attempts` | number | Up to 3 |
| `leaseUntil` | Date? | Expired leases are re-queued |
| `runId` | string? | |
| `error` | string? | |
| `createdAt`, `updatedAt` | Date | |

Indexes: `{ status: 1, createdAt: 1 }` for claiming; TTL on `updatedAt` for `done` jobs after 30 days (partial filter).

## `runs` — Done

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | string | UUID |
| `kind` | `"inspiration" \| "idea" \| "plan" \| "final"` | |
| `subjectId` | string | |
| `steps` | object[] | `{ name, status: "waiting" \| "running" \| "done" \| "needs_you" \| "skipped" \| "failed", startedAt?, finishedAt?, summary?, error?, outputRef? }` |
| `createdAt`, `updatedAt` | Date | |

Index: `{ subjectId: 1, createdAt: -1 }`. TTL 30 days after the run finishes.

Finals keep their own `steps` (above) and can move to `runs` later; not required.

## Added during the build

- `inspirations`: `analysisPrompt`, `viabilityPrompt`, `overridden`, `source: "upload"`, `planId`.
- `runs`: `finishedAt`.
- `ideas`: `assumptions`, `questions`, `readiness`, `folded`, `prompts`.
- `plans`: shot `id`, `searching`, `note`; take `verdict` (including `checking` and `failed`), `fix`, `useFrom`, `useTo`, `overridden`; plan `build`, `error`, `folded`, `summary`, `prompts`, `postedAt`, `postedNumbers` (`views`, `reach`, `likes`, `shares`, `saves`, `comments`, all optional). `packUrl` is added to the view only.
- `jobs`: types do not include `merge-duplicates`; merging runs in the web app (`mergeDueSoon`). `plan` and `plan-edit` are unused: plans are built in the web app (`after()`). `check-take` and `clip-pack` run on the host.
