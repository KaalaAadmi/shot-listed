// Pure rules for Reel Plans (docs/TRD.md §3.7, prompts/clip-grader.md, plan-writer.md and plan-chat.md "Code checks").
// No server imports, so the tests run them directly.
import { z } from "zod";
import type { Concept } from "./inspiration-rules.ts";

// ---------- Shape of a plan ----------

export type Fit = "exact" | "works" | "weak";

/** A library clip that could play a shot. Weak ones are shown but never placed. */
export type Alternate = { libraryItemId: string; label: string; fit: Fit; why: string; in: number; out: number };

export type FilmIt = {
  shot: string;
  where: string;
  framing: string;
  lens: string;
  movement: string;
  textSpace: string;
  lightSound: string;
  recordSeconds: number;
  takes: number;
  /** A frame from the shared reel; set by a later phase. */
  referenceFrameAssetId: string | null;
};

/** A video you filmed for a Film it card. It is a library item, so it is indexed and previewed like any clip. */
export type Take = {
  libraryItemId: string;
  /** "checking" until the host has looked; "failed" if it never could (Use anyway still works). */
  verdict: "checking" | "pass" | "usable" | "reshoot" | "failed";
  notes: string;
  /** What to change on the next take (usable and reshoot). */
  fix?: string;
  useFrom?: number;
  useTo?: number;
  /** You pressed Use anyway. */
  overridden?: boolean;
  checkedAt: string;
};

export type PlanShot = {
  /** Stays with the shot through reorders, so a slow search lands on the right one. */
  id: string;
  n: number;
  seconds: number;
  /** What this beat shows, from the concept. */
  beat: string;
  onScreenText: string;
  textPosition: "top" | "middle" | "bottom" | "none";
  source: "library" | "stock" | "film_it";
  libraryItemId?: string;
  /** The clip's caption, for display and for the writer. */
  label?: string;
  in?: number;
  out?: number;
  fit?: "exact" | "works";
  why?: string;
  alternates: Alternate[];
  stock?: { pexelsId: number; url: string; credit: string };
  filmIt?: FilmIt;
  takes: Take[];
  status: "open" | "filled";
  note?: string;
  /** Set while a `find_clip` search for this shot is running on the host. */
  searching?: boolean;
};

export type PlanStatus = "planned" | "filming" | "editing" | "ready" | "posted" | "skipped";

export type Version = { version: number; shots: PlanShot[]; at: string; reason: string };
export type ChatTurn = { at: string; role: "you" | "model"; text: string; operations?: Op[]; version?: number };

export type PlanDoc = {
  _id: string;
  source: { kind: "inspiration" | "idea"; id: string };
  /** Snapshot of the concept the plan was made from. */
  concept: Concept;
  title: string;
  format: string;
  status: PlanStatus;
  /** "building" while the plan is being made; "failed" shows Retry. */
  build: "building" | "ready" | "failed";
  error?: string;
  shootDay: boolean;
  hooks: { text: string; style: string }[];
  shots: PlanShot[];
  audio: { inspiration: { title: string; url: string }; searchTerms: string[]; vibe: string; useInspirationSound: boolean; note: string };
  editNotes: string[];
  clipPack: { status: "none" | "building" | "ready" | "failed"; storageAssetId?: string };
  finalId?: string;
  postedAt?: Date;
  postedNumbers?: Numbers;
  runId: string;
  version: number;
  /** The last 10 earlier shot lists, newest last, for Undo. */
  history: Version[];
  chat: ChatTurn[];
  /** What the model remembers of the first `folded` chat turns. All turns stay saved for you to scroll. */
  summary?: string;
  folded?: number;
  /** Prompts that wrote this plan, e.g. { writer: "plan-writer@1", grader: "clip-grader@1" }. */
  prompts?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
};

const HISTORY = 10;
const MIN_SECONDS = 6;
const MAX_SECONDS = 30;

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const totalSeconds = (shots: PlanShot[]) => round1(shots.reduce((a, s) => a + s.seconds, 0));

/** More than half the shots need filming. */
export const isShootDay = (shots: PlanShot[]) => shots.filter((s) => s.source === "film_it").length * 2 > shots.length;

export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
/** On-screen text over 8 words is kept but flagged. */
export const isLongText = (t: string) => wordCount(t) > 8;

export const emptyFilmIt = (shot: string): FilmIt => ({
  shot,
  where: "",
  framing: "",
  lens: "n/a",
  movement: "",
  textSpace: "",
  lightSound: "",
  recordSeconds: 0,
  takes: 0,
  referenceFrameAssetId: null,
});

const openShot = (n: number, seconds: number, beat: string, text = ""): PlanShot => ({
  id: globalThis.crypto.randomUUID(),
  n,
  seconds,
  beat,
  onScreenText: text,
  textPosition: "bottom",
  source: "film_it",
  filmIt: emptyFilmIt(beat),
  alternates: [],
  takes: [],
  status: "open",
});

/** One open shot per beat; clips are matched next. */
export const shotsFromConcept = (c: Concept): PlanShot[] => c.beats.map((b, i) => openShot(i + 1, b.seconds, b.shows));

// ---------- Placing clips ----------

/** Drops everything a shot says about what fills it. */
const cleared = (s: PlanShot): PlanShot => ({
  ...s,
  libraryItemId: undefined,
  label: undefined,
  in: undefined,
  out: undefined,
  fit: undefined,
  why: undefined,
  stock: undefined,
  filmIt: undefined,
  note: undefined,
  searching: undefined,
});

export function placeClip(shot: PlanShot, a: Alternate): PlanShot {
  const length = a.out - a.in;
  return {
    ...cleared(shot),
    source: "library",
    libraryItemId: a.libraryItemId,
    label: a.label,
    in: a.in,
    out: a.out,
    fit: a.fit === "exact" ? "exact" : "works",
    why: a.why,
    status: "filled",
    note: length > 0 && length + 0.05 < shot.seconds ? `The clip is ${round1(length)} s; the shot needs ${shot.seconds} s.` : undefined,
  };
}

export const placeStock = (shot: PlanShot, stock: NonNullable<PlanShot["stock"]>): PlanShot => ({ ...cleared(shot), source: "stock", stock, status: "filled" });

/** Turns a shot into a Film it card; a clip that was on it stays as an alternate. */
export function toFilmIt(shot: PlanShot): PlanShot {
  const kept: Alternate[] =
    shot.source === "library" && shot.libraryItemId
      ? [{ libraryItemId: shot.libraryItemId, label: shot.label ?? "", fit: shot.fit ?? "works", why: shot.why ?? "", in: shot.in ?? 0, out: shot.out ?? 0 }]
      : [];
  return { ...cleared(shot), source: "film_it", status: "open", filmIt: shot.filmIt ?? emptyFilmIt(shot.beat), alternates: [...kept, ...shot.alternates] };
}

/** The best clip goes on the shot, the rest become alternates; no good clip makes it a Film it card. */
export function withClips(shot: PlanShot, alternates: Alternate[], best: number): PlanShot {
  const rest = alternates.filter((_, i) => i !== best);
  return best < 0 ? toFilmIt({ ...shot, alternates: rest }) : placeClip({ ...shot, alternates: rest }, alternates[best]);
}

// ---------- Stock footage ----------

/**
 * Stock suits scenery and objects, not you or other people. Conservative on purpose: when a beat mentions a person,
 * a face or a performance, it's yours to film.
 */
// ponytail: a word list stands in for a model call; swap for one if it misjudges real beats.
const PERSON = /\b(me|my|myself|i|we|you|your|face|faces|selfie|mirror|friend|friends|person|people|man|men|woman|women|guy|guys|girl|girls|boy|he|she|they|him|her|creator|host|actor|reaction|lip.?sync|dance|dancing|talking|speaking|screen)\b/i;
export const isStockAppropriate = (beat: string) => !PERSON.test(beat);

/** The words of a beat that make a good stock search. */
export const stockQuery = (beat: string) => beat.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 8).join(" ");

// ---------- Grading ----------

export const gradeSchema = z.object({
  grades: z.array(
    z.object({
      candidate: z.number(),
      grade: z.enum(["exact", "works", "weak", "no"]),
      why: z.string(),
      useFromSeconds: z.number(),
      useToSeconds: z.number(),
    }),
  ),
  best: z.number(),
});

export type Candidate = { id: string; label: string; kind: "photo" | "video"; durationS: number };

const RANK: Record<Fit, number> = { exact: 0, works: 1, weak: 2 };

/**
 * Turns the grader's answer into alternates, best first. Grades for candidates that weren't sent are
 * dropped, missing ones count as "no", and the clip to place is only ever an exact or works one.
 * `best` is an index into `alternates`, or -1 when nothing qualifies.
 */
export function checkGrades(raw: unknown, candidates: Candidate[], shotSeconds: number): { alternates: Alternate[]; best: number } {
  const { grades, best } = gradeSchema.parse(raw);
  const byNumber = new Map(grades.map((g) => [g.candidate, g]));
  const rows = candidates.flatMap((c, i) => {
    const g = byNumber.get(i + 1);
    if (!g || g.grade === "no") return [];
    let from = 0;
    let to = 0;
    if (c.kind === "video") {
      from = clamp(g.useFromSeconds, 0, c.durationS);
      to = clamp(g.useToSeconds, 0, c.durationS);
      if (to <= from) [from, to] = [0, Math.min(c.durationS, shotSeconds)];
    }
    const alt: Alternate = { libraryItemId: c.id, label: c.label, fit: g.grade, why: g.why, in: round1(from), out: round1(to) };
    return [{ alt, candidate: i + 1 }];
  });
  rows.sort((a, b) => RANK[a.alt.fit] - RANK[b.alt.fit]); // stable: ties keep the search order
  const alternates = rows.map((r) => r.alt);
  const picked = rows.findIndex((r) => r.candidate === best && r.alt.fit !== "weak");
  return { alternates, best: picked >= 0 ? picked : alternates.findIndex((a) => a.fit !== "weak") };
}

export type Graded = { alternates: Alternate[]; best: number };

/**
 * Places each beat's best clip, but never the same clip twice in one reel: a beat whose best was already used takes its
 * next-best Exact or Works clip, else becomes a Film it card.
 */
export function placeAll(shots: PlanShot[], graded: Graded[]): PlanShot[] {
  const used = new Set<string>();
  return shots.map((shot, i) => {
    const { alternates, best } = graded[i] ?? { alternates: [], best: -1 };
    const order = [best, ...alternates.keys()].filter((k, j, all) => k >= 0 && all.indexOf(k) === j);
    const pick = order.find((k) => alternates[k].fit !== "weak" && !used.has(alternates[k].libraryItemId)) ?? -1;
    if (pick >= 0) used.add(alternates[pick].libraryItemId);
    return withClips(shot, alternates, pick);
  });
}

// ---------- Plan writer ----------

export const writerSchema = z.object({
  hooks: z.array(z.object({ text: z.string(), style: z.string() })),
  shots: z.array(
    z.object({
      n: z.number(),
      onScreenText: z.string(),
      textPosition: z.enum(["top", "middle", "bottom", "none"]),
      filmIt: z.object({
        needed: z.boolean(),
        shot: z.string(),
        where: z.string(),
        framing: z.string(),
        lens: z.string(),
        movement: z.string(),
        textSpace: z.string(),
        lightSound: z.string(),
        recordSeconds: z.number(),
        takes: z.number(),
      }),
    }),
  ),
  audio: z.object({ vibe: z.string(), searchTerms: z.array(z.string()), useInspirationSound: z.boolean(), note: z.string() }),
  editNotes: z.array(z.string()),
});
export type Writing = z.infer<typeof writerSchema>;

/**
 * Merges the writer's words into the shots, matched by `n` (extra ones dropped, missing ones get empty text).
 * Film it directions are kept only for shots that really are Film it. With `onlyFilmIt`, text is left alone and
 * only cards without directions are filled.
 */
export function applyWriting(shots: PlanShot[], w: Writing, onlyFilmIt = false): PlanShot[] {
  const byN = new Map(w.shots.map((s) => [s.n, s]));
  return shots.map((s) => {
    const m = byN.get(s.n);
    const next = { ...s };
    if (!onlyFilmIt) {
      next.onScreenText = m?.onScreenText.trim() ?? "";
      next.textPosition = m?.textPosition ?? "bottom";
    }
    const wants = s.source === "film_it" && (!onlyFilmIt || (s.filmIt?.recordSeconds ?? 0) === 0);
    if (m?.filmIt.needed && wants) {
      const f = m.filmIt;
      next.filmIt = {
        shot: f.shot, where: f.where, framing: f.framing, lens: f.lens, movement: f.movement,
        textSpace: f.textSpace, lightSound: f.lightSound, recordSeconds: f.recordSeconds, takes: f.takes,
        referenceFrameAssetId: s.filmIt?.referenceFrameAssetId ?? null,
      };
    }
    return next;
  });
}

/** The shot list as the writer and the chat read it. */
export function shotsText(shots: PlanShot[]): string {
  return shots
    .map((s) => {
      const uses = s.source === "library" ? `library clip "${s.label}" (${s.fit})` : s.source === "stock" ? "stock footage (Pexels)" : "film_it";
      const alts = s.alternates.map((a, i) => `alt ${i + 1}: ${a.fit} · "${a.label}"`).join("; ");
      return [`Shot ${s.n} · ${s.seconds} s · beat: ${s.beat} · uses: ${uses}`, s.onScreenText && `text: "${s.onScreenText}"`, alts]
        .filter(Boolean)
        .join(" · ");
    })
    .join("\n");
}

// ---------- Plan chat: operations ----------

export const opSchema = z.object({
  op: z.enum(["reorder", "set_length", "change_text", "use_alternate", "make_film_it", "remove_shot", "add_shot", "find_clip"]),
  shot: z.number().int(),
  toPosition: z.number().int(),
  seconds: z.number(),
  text: z.string(),
  alternate: z.number().int(),
  description: z.string(),
});
export type Op = z.infer<typeof opSchema>;

export const chatSchema = z.object({ reply: z.string(), operations: z.array(opSchema), needsConfirmation: z.boolean() });

class EditError extends Error {}

export type Edit = { ok: true; shots: PlanShot[]; finds: { shot: number; description: string }[] } | { ok: false; error: string };

/**
 * Applies the operations in order to a copy. If any fails, none apply and the error says why.
 * `find_clip` needs a search, so it comes back in `finds` (with the shot's final number) for the caller to run.
 */
export function applyOperations(input: PlanShot[], ops: Op[]): Edit {
  const shots = structuredClone(input);
  const finds: { shot: PlanShot; description: string }[] = [];
  const at = (n: number) => {
    const s = shots[n - 1];
    if (!s) throw new EditError(`There is no shot ${n}.`);
    return s;
  };
  const before = totalSeconds(shots);
  try {
    for (const o of ops) {
      switch (o.op) {
        case "reorder": {
          const s = at(o.shot);
          if (o.toPosition < 1 || o.toPosition > shots.length) throw new EditError(`There is no position ${o.toPosition}.`);
          shots.splice(o.shot - 1, 1);
          shots.splice(o.toPosition - 1, 0, s);
          break;
        }
        case "set_length": {
          if (o.seconds <= 0) throw new EditError("A length has to be more than 0 seconds.");
          if (o.shot === 0) {
            const k = o.seconds / (totalSeconds(shots) || 1);
            for (const s of shots) s.seconds = round1(s.seconds * k);
          } else at(o.shot).seconds = round1(o.seconds);
          break;
        }
        case "change_text":
          at(o.shot).onScreenText = o.text.trim();
          break;
        case "use_alternate": {
          const s = at(o.shot);
          const alt = s.alternates[o.alternate - 1];
          if (!alt) throw new EditError(`Shot ${o.shot} has no alternate ${o.alternate}.`);
          if (alt.fit === "weak") throw new EditError(`Alternate ${o.alternate} for shot ${o.shot} was graded weak, so it would hurt the shot.`);
          // The clip being replaced stays on as an alternate.
          const old = s.source === "library" ? toFilmIt({ ...s, alternates: [] }).alternates : [];
          const rest = s.alternates.filter((_, i) => i !== o.alternate - 1);
          shots[o.shot - 1] = placeClip({ ...s, alternates: [...old, ...rest] }, alt);
          break;
        }
        case "make_film_it":
          shots[o.shot - 1] = toFilmIt(at(o.shot));
          break;
        case "remove_shot": {
          at(o.shot);
          if (shots.length === 1) throw new EditError("A reel needs at least one shot.");
          shots.splice(o.shot - 1, 1);
          break;
        }
        case "add_shot": {
          if (o.seconds <= 0 || !o.description.trim()) throw new EditError("A new shot needs a length and a description.");
          shots.splice(clamp(o.toPosition, 0, shots.length), 0, openShot(0, round1(o.seconds), o.description.trim(), o.text.trim()));
          break;
        }
        case "find_clip": {
          if (!o.description.trim()) throw new EditError("Say what the shot should show.");
          finds.push({ shot: at(o.shot), description: o.description.trim() });
          break;
        }
      }
      shots.forEach((s, i) => (s.n = i + 1));
    }
  } catch (err) {
    if (err instanceof EditError) return { ok: false, error: err.message };
    throw err;
  }
  const after = totalSeconds(shots);
  if (after !== before && (after < MIN_SECONDS || after > MAX_SECONDS)) {
    return { ok: false, error: `That would make the reel ${after} s. It has to stay between ${MIN_SECONDS} and ${MAX_SECONDS} s.` };
  }
  return { ok: true, shots, finds: finds.flatMap((f) => (shots.includes(f.shot) ? [{ shot: f.shot.n, description: f.description }] : [])) };
}

// ---------- Takes (prompts/take-checker.md "Code checks") ----------

/** What the host reports for a take: the verdict (from code's hard checks or the model) and where to cut it. */
export const takeResultSchema = z.object({
  shotId: z.string(),
  assetId: z.string(),
  verdict: z.enum(["pass", "usable", "reshoot"]),
  notes: z.string().max(1000),
  fix: z.string().max(1000),
  useFromSeconds: z.number(),
  useToSeconds: z.number(),
});
export type TakeResult = z.infer<typeof takeResultSchema>;

/** The Film it card as the take checker reads it. */
export function cardText(s: PlanShot): string {
  const f = s.filmIt;
  if (!f) return `Shot: ${s.beat}`;
  return [`Shot: ${f.shot || s.beat}`, `Where: ${f.where}`, `Framing: ${f.framing}`, `Lens: ${f.lens}`, `Movement: ${f.movement}`, `Text space: ${f.textSpace}`, `Light and sound: ${f.lightSound}`, `Record: ${f.recordSeconds} s`].join("\n");
}

/** The take fills the shot (the card stays on it, so a reshoot can reopen it). */
export function slotTake(shot: PlanShot, take: Take): PlanShot {
  const from = Math.max(0, take.useFrom ?? 0);
  const to = take.useTo !== undefined && take.useTo > from ? take.useTo : from + shot.seconds;
  return {
    ...shot,
    source: "library",
    libraryItemId: take.libraryItemId,
    label: "Your take",
    in: from,
    out: round1(to),
    fit: "exact",
    why: take.verdict === "usable" ? (take.fix ?? "") : "",
    status: "filled",
    note: take.verdict === "usable" && take.fix ? `Usable: ${take.fix}` : undefined,
    stock: undefined,
    searching: undefined,
  };
}

const withTake = (shot: PlanShot, take: Take): Take[] => [...shot.takes.filter((t) => t.libraryItemId !== take.libraryItemId), take];

/** A new take waiting for its check. */
export const addTake = (shot: PlanShot, assetId: string, now = new Date()): PlanShot => ({
  ...shot,
  takes: withTake(shot, { libraryItemId: assetId, verdict: "checking", notes: "", checkedAt: now.toISOString() }),
});

/** Pass and Usable fill the shot; Reshoot leaves the card open with the fix on it. */
export function applyTakeResult(shot: PlanShot, r: TakeResult, now = new Date()): PlanShot {
  const take: Take = { libraryItemId: r.assetId, verdict: r.verdict, notes: r.notes, fix: r.fix || undefined, useFrom: r.useFromSeconds, useTo: r.useToSeconds, checkedAt: now.toISOString() };
  const next = { ...shot, takes: withTake(shot, take) };
  return r.verdict === "reshoot" ? { ...next, note: r.fix ? `Reshoot: ${r.fix}` : "Reshoot this one." } : slotTake(next, take);
}

/** The take could not be checked at all. */
export const failTake = (shot: PlanShot, assetId: string, error: string, now = new Date()): PlanShot => ({
  ...shot,
  takes: withTake(shot, { libraryItemId: assetId, verdict: "failed", notes: error.slice(0, 300), checkedAt: now.toISOString() }),
});

/** Use anyway: whatever the verdict, the take goes in and the override is recorded. */
export function overrideTake(shot: PlanShot, assetId: string): PlanShot | null {
  const t = shot.takes.find((x) => x.libraryItemId === assetId);
  return t ? slotTake({ ...shot, takes: withTake(shot, { ...t, overridden: true }) }, { ...t, verdict: t.verdict === "usable" ? "usable" : "pass", fix: t.verdict === "usable" ? t.fix : undefined }) : null;
}

// ---------- Versions ----------

/** A new version; the shot list it replaces goes into history (last 10). */
export function commit(plan: Pick<PlanDoc, "version" | "shots" | "history">, shots: PlanShot[], reason: string, now = new Date()) {
  return {
    version: plan.version + 1,
    shots,
    shootDay: isShootDay(shots),
    history: [...plan.history, { version: plan.version, shots: plan.shots, at: now.toISOString(), reason }].slice(-HISTORY),
  };
}

/** Restores the previous shot list; null when there is nothing to undo. */
export function undo(plan: Pick<PlanDoc, "history">) {
  const last = plan.history.at(-1);
  if (!last) return null;
  return { version: last.version, shots: last.shots, shootDay: isShootDay(last.shots), history: plan.history.slice(0, -1) };
}

// ---------- What the browser gets ----------

export type PlanView = Omit<PlanDoc, "history" | "createdAt" | "updatedAt" | "postedAt"> & {
  postedAt: string | null;
  canUndo: boolean;
  /** A signed download link once the clip pack is ready. */
  packUrl: string | null;
  steps: { name: string; status: "waiting" | "running" | "done" | "needs_you" | "skipped" | "failed"; summary: string | null; error: string | null }[];
  /** Signed links for every clip the plan mentions (placed or alternate). */
  clips: Record<string, { url: string | null; kind: "photo" | "video"; thumb: boolean }>;
  createdAt: string;
};

// ---------- Posting and closing the loop (phase 10) ----------

export const NUMBER_FIELDS = ["views", "reach", "likes", "shares", "saves", "comments"] as const;
export type Numbers = Partial<Record<(typeof NUMBER_FIELDS)[number], number>>;
export const numbersSchema = z.object(Object.fromEntries(NUMBER_FIELDS.map((k) => [k, z.number().int().min(0).max(1e9).optional()])) as Record<(typeof NUMBER_FIELDS)[number], z.ZodOptional<z.ZodNumber>>);

/** `Views 3,120 · Reach 1,940 …`, with "not entered" for the ones you left out (prompts/content-history-writer.md). */
export const numbersText = (n: Numbers): string =>
  NUMBER_FIELDS.map((k) => `${k[0].toUpperCase()}${k.slice(1)} ${n[k] == null ? "not entered" : n[k].toLocaleString("en")}`).join(" · ");

export const historyDraftSchema = z.object({ entry: z.string().min(1), tier: z.enum(["benchmark", "good", "weak", "none"]), lesson: z.string() });
export type HistoryDraft = z.infer<typeof historyDraftSchema>;

/** Adds the entry under "REEL PERFORMANCE HISTORY" with the next number. Nothing else in the text changes. */
export function appendHistory(history: string, entry: string): string {
  const body = entry.trim().replace(/^\d+\.\s*/, "");
  const lines = history.replace(/\s+$/, "").split("\n");
  let h = lines.findIndex((l) => /REEL PERFORMANCE HISTORY/i.test(l));
  if (h < 0) {
    lines.push("", "--- REEL PERFORMANCE HISTORY ---");
    h = lines.length - 1;
  }
  let end = lines.findIndex((l, i) => i > h && /^\s*---/.test(l));
  if (end < 0) end = lines.length;
  const numbers = lines.slice(h + 1, end).map((l) => /^(\d+)\./.exec(l)?.[1]).filter((x): x is string => !!x).map(Number);
  let at = end;
  while (at > h + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, `${Math.max(0, ...numbers) + 1}. ${body}`);
  return `${lines.join("\n")}\n`;
}

/** The posted reels' formats for the viability judge's freshness score, newest first. */
export function formatsText(posted: { format: string; title: string; postedAt: Date }[], now = new Date()): string {
  if (!posted.length) return "(no posts recorded in ShotListed yet)";
  return posted.map((p) => `- ${p.format}: "${p.title}", ${Math.floor((now.getTime() - p.postedAt.getTime()) / 86_400_000)} days ago`).join("\n");
}

/** What the caption writer is told about the plan the final cut came from. */
export const planDirection = (p: { hooks: { text: string; style: string }[]; concept: Concept }): string =>
  [`This reel was made from a plan. Intent: ${p.concept.why}`, `Format: ${p.concept.format}`, `Hook options planned: ${p.hooks.map((h) => `"${h.text}"`).join(" / ") || "none"}`].join("\n");

/** After two library items are merged, shots that used the removed one use the kept one. */
export function repoint(shots: PlanShot[], from: string, to: string): PlanShot[] {
  const swap = (id: string | null | undefined) => (id === from ? to : id);
  return shots.map((s) => ({
    ...s,
    libraryItemId: swap(s.libraryItemId) as PlanShot["libraryItemId"],
    alternates: s.alternates.map((a) => ({ ...a, libraryItemId: swap(a.libraryItemId) as string })),
    takes: s.takes.map((t) => ({ ...t, libraryItemId: swap(t.libraryItemId) as string })),
  }));
}
