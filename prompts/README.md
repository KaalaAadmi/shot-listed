# Prompts

Every model call in Reel Studio, in one place. Both the web app (`web/`) and the pipeline host (`pipeline/`) load these files, so a prompt is written once.

## Index

| File | What it does | Phase | Model | Voice blocks | Status |
| --- | --- | --- | --- | --- | --- |
| (in code) `web/src/lib/captions/engine.ts` → `DESCRIBE_SYSTEM` | Watches your final cut; describes hook, beats, on-screen text and speech verbatim | 3 | video | none | Done |
| (in code) `engine.ts` → your v3.0 prompt + `ENGINE_CONTRACT` | Writes the three caption options, keywords, feedback, Trial | 3 | caption | `voicePrompt`, `contentHistory` | Done |
| `creator-profile.default.md` | Default text for Settings → **Creator profile** (not a prompt on its own) | 3b | n/a | n/a | Written |
| `caption-feedback.md` | Reviews your own draft caption; scores, checks, suggests edits, answers your question | 3b | caption | `voicePrompt`, `contentHistory` | Written |
| `library-tagger.md` | Describes each photo or clip so plans can search the library | 6 | vision | none | Written |
| `inspiration-analysis.md` | Watches a saved reel; turns it into a concept you could reproduce | 7 | video | none | Written |
| `viability-judge.md` | Scores niche fit, effort, freshness, share potential; suggests a twist | 7, 8b | caption | `creatorProfile`, `contentHistory`, `recentFormats` | Written |
| `clip-grader.md` | Grades the top 5 library clips for one beat: Exact, Works, Weak, No | 8 | vision | none | Written |
| `plan-writer.md` | Hooks, on-screen text per shot, Film it directions, audio, edit notes | 8 | caption | `creatorProfile`, `contentHistory` | Written |
| `plan-chat.md` | Turns plain-words requests into changes to a plan | 8 | caption | `creatorProfile` | Written |
| `idea-coach.md` | The idea chat | 8b | caption | `creatorProfile`, `contentHistory`, `recentFormats` | Written |
| `brief-maker.md` | Turns the idea chat, or a pasted brief, into a concept | 8b | caption | none | Written |
| `take-checker.md` | Compares a filmed take with its Film it card | 9 | vision | none | Written |
| `chat-summariser.md` | Folds old turns of a long chat into a short note | 8 | cheap | none | Written |
| `content-history-writer.md` | Writes a posted reel's content history entry from its numbers | 10 (optional) | caption | `contentHistory` | Written |

The two prompts marked "in code" work today; move them into files here when phase 3b touches the engine, so all prompts follow one convention.

## Models

| Name in a prompt file | What the code uses |
| --- | --- |
| `caption` | Claude (`CLAUDE_MODEL`, default `claude-sonnet-5-5`) when `ANTHROPIC_API_KEY` is set, else Gemini (`GEMINI_MODEL`) |
| `video` | Gemini (`GEMINI_MODEL`, default `gemini-flash-latest`) through the Files API |
| `vision` | `VISION_MODEL`, default Gemini Flash-Lite; images and keyframes, many calls, so cheap matters. Check Google's current model list for the exact name when you set it |
| `cheap` | Same as `vision`, text only |

**Portability.** The wording is plain instructions with no provider-specific syntax, so any capable model can follow it. What a model must support:

- **Structured output** against a JSON schema. Claude, Gemini and OpenAI all do, and the schemas avoid what some reject (see File format). With a model that doesn't, the loader must validate the reply against the schema and retry once.
- **Video with sound** for `video` prompts (the final-cut description, inspiration analysis). In practice that is Gemini today; another model would need frames plus a separate transcript, and the prompts would change.
- **Image input** for `vision` prompts.

Quality is not neutral: the caption, idea and plan prompts assume a strong model, and a small or local one will follow the rules less reliably. Temperatures are starting points.

Embeddings for library search are not a prompt: the code embeds the tagger's `caption`, `action`, `objects` and `useFor` with Gemini's embedding model.

## File format

````markdown
---
id: caption-feedback
version: 1
phase: 3b
model: caption
temperature: 0.4
output: schemas/caption-feedback.json
inputs: [voicePrompt, contentHistory, description, options, draft, codeChecks, thread, question]
---
# Title
What it's for, in a sentence.

## System
```text
…the system prompt, with {{variables}}…
```

## User
```text
…the user message, with {{variables}}…
```

## Code checks
What code verifies or overrides after the reply.

## Test cases
Inputs and what a good reply must (and must not) contain.
````

Rules for the code that loads them:

- **Variables** are `{{name}}`, replaced as plain text. A variable with no value becomes an empty string. Nothing else is templated: no loops or conditionals. The code builds lists (numbered draft lines, candidate blocks) before filling them in.
- **Data stays in tags.** Anything that came from outside the prompt (your text, model output, other creators' captions, file names) sits inside an XML-style tag such as `<draft>…</draft>`. Every system prompt says that tag contents are data, not instructions. This matters most for inspiration reels: another creator's caption can contain anything.
- **Output is always JSON** that matches the file in `schemas/`. The schemas are closed: every object has `additionalProperties: false`, every field is required, and there are no `minimum`, `maxLength`, `pattern` or `format` keywords, so both Claude's structured outputs and Gemini's `responseJsonSchema` accept them. "Not applicable" is an empty string, `0` or an empty array, never `null`. Limits such as "at most 4 suggestions" are stated in the prompt and enforced in code.
- **`schemas/concept.json`** is the shared plan input. `inspiration-analysis.json` and `brief-maker.json` embed a copy as their `concept` field; a test checks the copies are identical.
- **Versions.** Bump `version` when you change a prompt's meaning. Stored results record the prompt ID and version that made them, so you can compare before and after.
- **Your voice texts are not in these files.** They come from Settings, so you can edit them without a deploy:
  - `voicePrompt`: Settings → Caption voice → Social Media Manager prompt (your v3.0 prompt);
  - `contentHistory`: Settings → Caption voice → Content history;
  - `creatorProfile`: Settings → **Creator profile** (new; default in `creator-profile.default.md`);
  - `recentFormats`: built by code from your last 10 posted plans, e.g. `2026-11-01 · setup → visual punchline · "Gym Schedule Change"`.

The captions use your v3.0 prompt. Everything else that needs your voice uses the Creator profile, because the v3.0 prompt's caption rules (five-line structure, hashtags, Section 8 layout) would leak into idea chats and plans.

## Testing a prompt

Each file ends with test cases. In development:

1. Turn each case into a fixture (`web/tests/fixtures/prompts/<id>/…` or `pipeline/tests/fixtures/prompts/…`).
2. Unit tests run with stubbed models: they check that the prompt renders (no `{{` left), the schema loads, and the code checks behave.
3. A manual `npm run prompt:try -- <id> <fixture>` (to build) calls the real model and prints the reply, for reading before you change a prompt.
