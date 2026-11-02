# Mac mini agent: contract

The web app already supports the Mac mini as a library source. What's left for after
the Mac arrives is the agent itself: a small Python service on the Mac that reads the
iCloud Photos library with [osxphotos](https://github.com/RhetTbull/osxphotos) and
pushes new items through the same upload API the phone uses.

Nothing else changes when you switch. Phone uploads and Mac-synced items live in the
same library and the same R2 bucket, and everything after the library (analysis,
matching, plans) reads from there.

Two rules make sure switching never stores a photo twice:

- Identical files are caught by their content hash (SHA-256), whichever device sent them.
- The same shot as a different file (iOS often uploads a converted copy; the Mac
  exports the original) is caught by asking Reel Studio before uploading (step 2 below).

Content hashes and resuming are live now. The match call (step 2) arrives with the Mac
work (implementation plan phase 12); until then, skip it and go straight to step 3.

## Setup on the Mac

- Photos → Settings → iCloud → **Download Originals to this Mac**, so files are on disk.
- Grant the agent's Python **Full Disk Access** (System Settings → Privacy & Security).
- Put `AGENT_TOKEN` and the app URL in the agent's config.
- Run it as a `launchd` service so it starts on boot.

## Calls the agent makes

All requests send `X-Reel-Token: <AGENT_TOKEN>` and JSON bodies.

### Every 5 minutes: heartbeat

```
POST /api/agent/heartbeat
{ "machine": "mac-mini", "version": "0.1.0", "photosCount": 18234, "lastSyncAt": "2026-12-02T09:00:00Z" }
→ { "syncEnabled": true }
```

Only sync while `syncEnabled` is true. It is true only when Settings → Library source
is **Sync from the Mac mini**, which is how you choose between the two.

### For each new Photos item: upload

1. Export the item with osxphotos. For video, transcode to 1080p H.264 SDR first
   (iPhone clips are HDR; Instagram and most editors want SDR) to save R2 space.
   Compute the SHA-256 of the file you will upload (`hashlib`, read in chunks).
2. *(phase 12)* Ask whether Reel Studio already has it. Send the capture time
   with sub-seconds, size after rotation, duration, and perceptual hashes (Python
   `imagehash`: one for a photo, frames at 10%, 50% and 90% for a video):

   ```
   POST /api/agent/match
   { "externalId": "<Photos UUID>", "contentHash": "<sha256 hex>", "kind": "video",
     "capture": { "at": "2026-11-29T18:02:11.482+00:00" }, "width": 1080, "height": 1920,
     "durationS": 14.53, "phash": ["c3a1…", "c39e…", "d1a0…"] }
   → { "action": "skip", "reason": "already-synced" | "same-bytes" | "same-shot" | "final-cut", "itemId": "…" }
   → { "action": "upload" }
   ```

   On `skip`, move on; for `same-bytes` and `same-shot`, Reel Studio has already
   attached the Photos UUID to its item. `upload` means no match, a better file than
   the one Reel Studio has (it will merge them while indexing), or only a possible match.
3. Start the upload, passing the Photos UUID so re-runs never duplicate, and the hash
   (required):

   ```
   POST /api/media/uploads
   { "filename": "IMG_4821.mov", "contentType": "video/quicktime", "size": 48211934,
     "takenAt": "2026-11-29T18:02:11+00:00", "externalId": "<Photos UUID>",
     "contentHash": "<sha256 hex>" }
   ```

   The response is one of:
   - `{ "mode": "duplicate" }` — already stored; skip.
   - `{ "mode": "single", "url", "headers" }` — PUT the file to `url` with `headers`.
   - `{ "mode": "multipart", "partSize", "partCount" }` — get part URLs from
     `POST /api/media/uploads/{assetId}/parts` with `{ "partNumbers": [1, 2, …] }`
     (up to 100 per call), PUT each slice, keep each response's `ETag`.
   - `{ "mode": "resume", "partSize", "partCount", "uploadedParts" }`
     — an earlier attempt got part-way. Check each listed part's size, keep its `ETag`,
     and send only the missing parts.
4. Finish:

   ```
   POST /api/media/uploads/{assetId}/complete
   { "parts": [{ "partNumber": 1, "etag": "\"…\"" }, …] }   // omit "parts" for single uploads
   ```

   The server checks R2 has the full file before marking it uploaded.
5. On a failure, keep the asset ID and retry later: `GET /api/media/uploads/{assetId}`
   returns the resume state (or `duplicate` if it finished), so nothing is sent twice.
   Delete an upload only when you mean to give up on that file.

## What to skip

Screenshots, screen recordings, documents and receipts: osxphotos exposes Apple's own
labels and media subtypes, so filter these out before uploading.
