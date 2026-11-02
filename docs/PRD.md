# Reel Studio — Product Requirements

**Owner:** Arnav · **Last updated:** 2 November 2026

Status legend used in every Reel Studio doc:

- **Done**: built, typechecked and covered by automated tests. Not yet deployed or run against live accounts.
- **Partly done**: some of it exists; the gap is named.
- **Planned**: not started.

---

## 1. Problem

You save Instagram reels as inspiration, then have to work out by hand whether each idea suits your account, which of your own clips could recreate it, what to film, what text to put on screen, which audio to use, and finally what caption to write. Each step means switching between Instagram, Photos, Edits and a chat window, and pasting context back in every time.

## 2. Goal

One tap on a saved reel, or a short chat about an idea of your own, produces a ready-to-edit plan, using your own footage wherever it genuinely fits. You still assemble and post in Edits and Instagram yourself; the system removes everything around that.

Manual steps that remain, by design:

1. Share a reel to Reel Studio, or talk an idea through in **Ideas**.
2. Film anything the plan says you don't have.
3. Assemble the reel in Edits.
4. Add the audio in Edits or Instagram.
5. Upload the export to Reel Studio, pick a caption, copy it, post.

## 3. User

One person: you. An Indian professional in Dublin posting Reels every 2–3 days about expat life, gym and anime, aimed at 25–30 year-old expats, students, anime fans and gym-goers. Share rate is the main success metric.

## 4. Non-goals

- **No auto-posting.** Nothing is published to Instagram by the system.
- **No editing.** Edits is the editor; the system hands it clips and text.
- **No Notion.** The web app is the only control centre.
- **No paid infrastructure** beyond iCloud+ later and AI API usage.
- **No forcing footage.** If nothing in the library fits a shot, the plan says how to film it instead.

## 5. Features

### Scope

Everything below is being built unless marked otherwise. **Committed** = part of the product; **Optional** = built only if you decide it's worth it; **Later** = waits on something you don't have yet.

| Feature | Scope |
| --- | --- |
| 5.1–5.4 Library, source switch, captions, caption voice | Committed (built) |
| 5.5 Caption drafts and feedback | Committed |
| 5.6–5.7 Library understanding, one copy of each shot | Committed |
| 5.8–5.9 Share a reel, analysis and verdict | Committed |
| 5.10 Your own ideas | Committed |
| 5.11–5.15 Reel Plan and plan chat, Film it, clip pack, live view, Board | Committed |
| 5.16 Collection backlog sync | Optional (the share sheet covers the need; this adds the burner-account risk) |
| 5.17 Preview cut | Optional |
| Mac mini agent (in 5.2 and 5.7) | Later: after you buy the Mac |
| Personal storage app features (storage repo, S9) | Later: a separate product |

### 5.1 Media library — Done (files in the storage service)

- Upload photos and videos from the phone straight to R2; videos over 64 MB upload in parts with retries.
- The same file is never stored twice: the phone hashes each file (SHA-256) before sending, and identical files are skipped whichever device sends them.
- An upload that stopped part-way picks up where it left off when you tap Retry or pick the file again, without storing a second copy.
- Grid with previews, filters (photos, videos), download and delete; usage against the 10 GB R2 free tier.
- Files and their records live in the separate `r2-storage` service (R2 for the files, its own MongoDB database for the details). Reel Studio reaches it only through its connector; from phase 6 it also keeps what it knows about each item (tags, embeddings).

### 5.2 Library source switch — Done

- Settings → Library source: **Upload from my phone** (now) or **Sync from the Mac mini** (after Cyber Monday).
- Server side of the Mac option is built: the agent checks in, and only syncs while the Mac is selected.
- The Mac agent itself is **Planned**.

### 5.3 Captions from the final cut — Done

- Upload the reel exported from Edits.
- Gemini watches it with sound and writes a description: hook, beats, every on-screen text overlay and any speech, verbatim.
- Your **Social Media Manager prompt (v3.0)** and **Content history** write, per Section 3 of your prompt:
  - three caption options in your 5-line structure, each with 3–5 hashtags;
  - one recommended option, with the reason;
  - 4–6 keywords woven in, with where each sits;
  - honest content feedback compared with past reels;
  - Trial recommendation.
- Claude writes the captions if an Anthropic key is set; otherwise Gemini.
- Pick an option, edit text and hashtags, preview, and **Copy caption** with every line break included (you can't add line breaks while posting). Blank lines survive via an invisible character; Instagram's 5-hashtag and 2,200-character limits are checked.
- New round with direction; retry a failed step; delete the video but keep the text.
- Planned: **Check the description** before captions are written (5.5).


### 5.4 Caption voice — Done

Settings → Caption voice: your prompt and content history, editable, each with Restore default. Hashtag placement (caption or first comment) and an optional blank line before hashtags.

Planned (phase 3b): Settings → **Creator profile**: who you are, your audience, content pillars, tone, what works and what doesn't, practical limits. The idea coach, viability judge and plan writer use it instead of your caption prompt, so caption rules don't leak into ideas and plans. The default is drafted from your v3.0 prompt (`prompts/creator-profile.default.md`).

### 5.5 Caption drafts and feedback — Planned

The engine already shows all three options in full. This adds a way to build your own caption from them and get an honest second opinion:

- **Check the description first.** After the model watches the reel, the description (hook, beats, on-screen text, speech) is shown for you to correct before captions are written. A misread overlay would otherwise end up in every option. Optional: **Write captions** skips straight on.
- **Your draft.** A scratch caption under the options. Each line of each option has **Add to draft**; you can also type, paste, reorder and delete lines. Hashtags come from any option or your own.
- **Ask for feedback.** Sends the draft (and any question you type, such as "is the hook strong enough?") to the caption model with your v3.0 prompt and content history. The reply rates it against your rules: hook in the first line, structure, line length, keywords woven in, hashtag count and relevance, Instagram limits, and how it compares with your past reels. It suggests specific edits, each with **Apply**.
- **A conversation, not one shot.** Follow-up questions keep the context (description, the three options, the current draft). The thread is saved with the final cut.
- **Use this.** Makes the draft your selected caption, so **Copy caption** gives it with the right line breaks.

### 5.6 Library understanding — Planned

Every photo and clip gets a short AI description (setting, shot type, orientation, mood, quality, people count) and an embedding, so plans can search the library in plain words. Library screen gains search, tag fixing and "exclude this item".

### 5.7 One copy of each shot — Planned

- Identical files are never stored twice, from the phone, the Mac or both (storage checks content hashes).
- The same shot saved as two different files (iOS often hands over a converted copy, while the Mac exports the original) is recognised from its capture time and how it looks:
  - **Same**: merged automatically, keeping the better file; Undo for 7 days.
  - **Possible**: shown under **Possible duplicates** for you to merge or keep both; never merged without you.
- Burst photos, which share a second and look nearly alike, are never merged automatically.
- Final cuts that reach the library through the camera roll are flagged and kept out of plans.
- With the Mac: it skips anything Reel Studio already has in an equal or better copy, and attaches its Photos ID to the existing item.

### 5.8 Share a reel — Planned

An iOS Shortcut in the share sheet sends a reel link (and an optional note) to Reel Studio. Shared reels land in an **Inbox** with live status.

### 5.9 Inspiration analysis and verdict — Planned

The reel is downloaded and watched (Gemini, with sound). The analysis covers hook, beats, on-screen text, format, emotion, call to action and why it works. A **viability score** out of 100 gives Make now / Make with a twist / Skip, scored on niche fit, clip coverage, effort, format freshness (can veto) and share potential.

### 5.10 Your own ideas — Planned

For reels that start in your head rather than in someone else's video. Two chats, one after the other:

1. **Idea chat.** You describe the idea in your own words; the model (with your niche, audience and content history) asks questions, pushes back honestly (is it fresh, is it shareable, what's the hook), and suggests twists. When you're happy, **Make the brief** turns the conversation into a **Reel brief**: the hook, beats with what each shot shows and how long, on-screen text, spoken words if any, the sound you have in mind, length and format. You can edit the brief, or paste a brief you wrote elsewhere instead of chatting.
2. **Plan chat.** The brief goes through the same planning as a shared reel (5.11): which library clips fit each beat (Exact or Works only), Film it cards for the rest, the shot order to assemble, on-screen text per shot, audio suggestions and the clip pack. The plan page then has a chat for changes ("I don't have a gym mirror shot, what else works?", "swap shots 2 and 3", "make it 15 seconds"), which updates the plan.

Your own ideas get the same viability check, but it never blocks them: a low score shows the reasons and **Make anyway** is the default.

### 5.11 Reel Plan — Planned

For ideas worth making, from a shared reel or your own brief:

- 3 hook variants.
- A shot list where each shot uses a library clip graded **Exact** or **Works** (never Weak), a Pexels clip for generic shots only, or a **Film it** card.
- On-screen text per shot, ready to copy.
- Audio: the inspiration's sound with its link, plus search terms for Edits.
- Labelled **Shoot day** if more than half the shots need filming.
- **Plan chat** on every plan, for changes in plain words; each change updates the shot list and is kept as a new version you can go back to.

### 5.12 Film it and take checking — Planned

Film it cards say what to shoot: reference frame, framing and lens, movement, text space, light, length, two takes. The **Shoot list** groups open cards by location. Uploaded takes are checked:

- technically (orientation, resolution, length, exposure, shake);
- for content against the card.

Each take gets Pass, Usable or Reshoot with a specific fix. Use anyway overrides.

### 5.13 Clip pack — Planned

Picked clips trimmed with half-second handles and numbered in order. Delivered as a zip link now; as a Photos album once the Mac mini is in place.

### 5.14 Live pipeline view — Partly done

Captions already show a live 3-step strip with retry. Planned: a full diagram per plan run (every step Waiting, Running, Done, Needs you, Skipped or Failed), drill-down into each step's output, and phone notifications on Needs you or Failed.

### 5.15 Board — Planned

Planned → Filming → Editing → Ready to post → Posted, with dates. Posted plans feed format freshness. Linking a plan to its final cut carries the plan's context into the captions.

### 5.16 Collection backlog sync — Planned

A burner Instagram account, running in a real browser profile on a home connection, imports the saved collection once, then checks daily for new saves. Optional; the share sheet is the main input.

### 5.17 Preview cut — Planned, optional

A HyperFrames render of the plan with on-screen text burned in, to see the rhythm before editing.

## 6. Success measures

- From sharing a reel, or locking a brief, to a ready plan: under 5 minutes, unattended.
- From uploading a final cut to captions: under 2 minutes; feedback on a draft in under 20 seconds.
- Your hands-on time per reel outside filming and editing: under 5 minutes.
- Over time: higher share rate per reel; fewer back-to-back similar formats.

## 7. Constraints and risks

| Constraint | Effect |
| --- | --- |
| No Instagram API for saved collections or downloads | Downloads use yt-dlp with a burner account's cookies. Against Instagram's terms; the burner can be flagged. Fallback: upload the reel file by hand. |
| Instagram allows 5 hashtags per post (since December 2025) | Enforced in captions and the copy check. |
| Music can't be attached without connecting your main account to Meta | Plans give the sound's name, link and search terms; you add it in Edits or Instagram. |
| Free tiers | R2 10 GB; two Atlas free clusters (one each for Reel Studio and storage, 512 MB each, paused after 30 idle days); two Vercel Hobby projects (personal use, 300 s functions, daily cron); Oracle VM 2 Arm cores / 12 GB. |
| AI providers | Gemini's free tier may use your data for training; the paid tier does not. |

## 8. Related documents

- `TRD.md`: architecture and technical decisions
- `APP_FLOW.md`: screens and flows
- `DATABASE_SCHEMA.md`: collections and fields
- `IMPLEMENTATION_PLAN.md`: phases, with what's done
- `SPLIT_GUIDE.md`: how storage was split into its own repo, and how to check both work
- `../prompts/README.md`: every model prompt, with its output schema and test cases
