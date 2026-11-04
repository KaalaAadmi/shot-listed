// Plan rules: grading checks, edit operations, versions (prompts/clip-grader.md, plan-chat.md "Code checks").
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  addTake,
  applyOperations,
  applyTakeResult,
  appendHistory,
  applyWriting,
  formatsText,
  numbersText,
  checkGrades,
  commit,
  isShootDay,
  isStockAppropriate,
  placeAll,
  placeClip,
  repoint,
  shotsFromConcept,
  stockQuery,
  undo,
  overrideTake,
  withClips,
  type Alternate,
  type Candidate,
  type Op,
  type PlanShot,
  type Writing,
} from "../src/lib/plan-rules.ts";
import type { Concept } from "../src/lib/inspiration-rules.ts";

const concept: Concept = {
  title: "t",
  format: "skit",
  hook: "h",
  lengthSeconds: 9,
  why: "w",
  beats: [1, 2, 3].map((n) => ({ n, seconds: 3, shows: `beat ${n}`, onScreenText: "", spoken: "", sound: "" })),
  onScreenText: [],
  audio: { idea: "", searchTerms: [] },
};

const alt = (id: string, fit: Alternate["fit"]): Alternate => ({ libraryItemId: id, label: id, fit, why: "", in: 0, out: 3 });
const op = (o: Partial<Op> & Pick<Op, "op">): Op => ({ shot: 0, toPosition: 0, seconds: 0, text: "", alternate: 0, description: "", ...o });

/** Three shots: a clip on 1, Film it on 2 and 3 (shot 2 has a works alternate and a weak one). */
function plan(): PlanShot[] {
  const s = shotsFromConcept(concept);
  s[0] = placeClip(s[0], alt("a", "exact"));
  s[1] = { ...s[1], alternates: [alt("b", "works"), alt("c", "weak")] };
  return s;
}

const cands: Candidate[] = [1, 2, 3].map((n) => ({ id: `c${n}`, label: `clip ${n}`, kind: "video", durationS: 10 }));
const grade = (candidate: number, g: string, from = 0, to = 0) => ({ candidate, grade: g, why: "", useFromSeconds: from, useToSeconds: to });

describe("checkGrades", () => {
  test("orders exact before works, drops 'no' and unsent candidates, keeps weak but never places it", () => {
    const r = checkGrades({ grades: [grade(1, "weak"), grade(2, "works", 2, 5), grade(3, "no"), grade(9, "exact")], best: 1 }, cands, 3);
    assert.deepEqual(r.alternates.map((a) => [a.libraryItemId, a.fit]), [["c2", "works"], ["c1", "weak"]]);
    assert.equal(r.best, 0); // the model pointed at a weak one; the works clip is placed instead
  });
  test("nothing qualifying means no clip is placed", () => {
    const r = checkGrades({ grades: [grade(1, "weak"), grade(2, "no")], best: 0 }, cands, 3);
    assert.equal(r.best, -1);
  });
  test("the range is clamped to the clip, and a bad range falls back to the shot length", () => {
    const r = checkGrades({ grades: [grade(1, "exact", 12, 20), grade(2, "exact", 2, 5)], best: 2 }, cands, 3);
    const [one, two] = r.alternates; // equal grades keep the search order
    assert.deepEqual([one.in, one.out], [0, 3]);
    assert.deepEqual([two.in, two.out], [2, 5]);
    assert.equal(r.alternates[r.best].libraryItemId, "c2");
  });
  test("photos use 0 to 0", () => {
    const r = checkGrades({ grades: [grade(1, "exact", 4, 8)], best: 1 }, [{ id: "p", label: "p", kind: "photo", durationS: 0 }], 3);
    assert.deepEqual([r.alternates[0].in, r.alternates[0].out], [0, 0]);
  });
});

describe("withClips", () => {
  test("never places a weak clip: the beat becomes a Film it card and keeps it as an alternate", () => {
    const shot = withClips(shotsFromConcept(concept)[0], [alt("w", "weak")], -1);
    assert.equal(shot.source, "film_it");
    assert.equal(shot.alternates[0].libraryItemId, "w");
  });
  test("a note says when the clip is shorter than the shot", () => {
    const shot = placeClip(shotsFromConcept(concept)[0], { ...alt("a", "exact"), out: 1.5 });
    assert.match(shot.note ?? "", /1\.5 s/);
  });
});

describe("applyOperations", () => {
  test("swap shots 2 and 3", () => {
    const r = applyOperations(plan(), [op({ op: "reorder", shot: 2, toPosition: 3 })]);
    assert.ok(r.ok);
    assert.deepEqual(r.shots.map((s) => s.beat), ["beat 1", "beat 3", "beat 2"]);
    assert.deepEqual(r.shots.map((s) => s.n), [1, 2, 3]);
  });
  test("make it 12 seconds scales every shot", () => {
    const r = applyOperations(plan(), [op({ op: "set_length", shot: 0, seconds: 12 })]);
    assert.ok(r.ok);
    assert.deepEqual(r.shots.map((s) => s.seconds), [4, 4, 4]);
  });
  test("a reel outside 6–30 seconds is refused", () => {
    const r = applyOperations(plan(), [op({ op: "set_length", shot: 0, seconds: 40 })]);
    assert.ok(!r.ok);
  });
  test("a works alternate is used and the replaced clip stays as an alternate", () => {
    const r = applyOperations(plan(), [op({ op: "use_alternate", shot: 2, alternate: 1 })]);
    assert.ok(r.ok);
    assert.equal(r.shots[1].libraryItemId, "b");
    assert.equal(r.shots[1].source, "library");
    assert.deepEqual(r.shots[1].alternates.map((a) => a.libraryItemId), ["c"]);
    // Swapping a clip for another keeps the first as an alternate.
    const swap = applyOperations(r.shots.map((x, i) => (i === 0 ? { ...x, alternates: [alt("d", "works")] } : x)), [op({ op: "use_alternate", shot: 1, alternate: 1 })]);
    assert.ok(swap.ok);
    assert.deepEqual(swap.shots[0].alternates.map((a) => a.libraryItemId), ["a"]);
  });
  test("a weak alternate is refused", () => {
    const r = applyOperations(plan(), [op({ op: "use_alternate", shot: 2, alternate: 2 })]);
    assert.ok(!r.ok);
    assert.match(r.error, /weak/);
  });
  test("one bad operation applies none of them", () => {
    const r = applyOperations(plan(), [op({ op: "change_text", shot: 1, text: "hi" }), op({ op: "remove_shot", shot: 9 })]);
    assert.ok(!r.ok);
  });
  test("make_film_it keeps the clip as an alternate; shoot day follows", () => {
    const r = applyOperations(plan(), [op({ op: "make_film_it", shot: 1 })]);
    assert.ok(r.ok);
    assert.equal(r.shots[0].source, "film_it");
    assert.equal(r.shots[0].alternates[0].libraryItemId, "a");
    assert.ok(isShootDay(r.shots));
  });
  test("find_clip comes back for the caller, with the shot's final number", () => {
    const r = applyOperations(plan(), [op({ op: "find_clip", shot: 3, description: "gym mirror" }), op({ op: "reorder", shot: 3, toPosition: 1 })]);
    assert.ok(r.ok);
    assert.deepEqual(r.finds, [{ shot: 1, description: "gym mirror" }]);
  });
  test("add_shot inserts after a position and renumbers", () => {
    const r = applyOperations(plan(), [op({ op: "add_shot", toPosition: 1, seconds: 2, description: "a dog", text: "wait" })]);
    assert.ok(r.ok);
    assert.deepEqual(r.shots.map((s) => s.beat), ["beat 1", "a dog", "beat 2", "beat 3"]);
    assert.equal(r.shots[1].n, 2);
  });
  test("the input is not changed", () => {
    const input = plan();
    const copy = structuredClone(input);
    applyOperations(input, [op({ op: "remove_shot", shot: 1 })]);
    assert.deepEqual(input, copy);
  });
});

describe("versions", () => {
  const base = { version: 1, shots: plan(), history: [] as ReturnType<typeof commit>["history"] };
  test("commit raises the version and keeps the old shots; undo brings them back", () => {
    const next = commit(base, base.shots.slice(0, 2), "removed a shot");
    assert.equal(next.version, 2);
    assert.equal(next.history.length, 1);
    const back = undo(next);
    assert.ok(back);
    assert.equal(back.version, 1);
    assert.equal(back.shots.length, 3);
    assert.equal(undo(back), null);
  });
  test("only the last 10 versions are kept", () => {
    let p: typeof base = base;
    for (let i = 0; i < 15; i++) p = { ...p, ...commit(p, p.shots, `edit ${i}`) };
    assert.equal(p.history.length, 10);
    assert.equal(p.version, 16);
  });
});

describe("applyWriting", () => {
  const writing = (needed: boolean): Writing => ({
    hooks: [],
    shots: [1, 2, 3, 7].map((n) => ({
      n,
      onScreenText: ` text ${n} `,
      textPosition: "top" as const,
      filmIt: { needed, shot: "s", where: "gym", framing: "f", lens: "1x", movement: "m", textSpace: "t", lightSound: "l", recordSeconds: 8, takes: 2 },
    })),
    audio: { vibe: "", searchTerms: [], useInspirationSound: false, note: "" },
    editNotes: [],
  });
  test("text is matched by number; directions only land on Film it shots", () => {
    const out = applyWriting(plan(), writing(true));
    assert.equal(out[0].onScreenText, "text 1");
    assert.equal(out[0].filmIt, undefined); // shot 1 has a clip
    assert.equal(out[1].filmIt?.where, "gym");
    assert.equal(out.length, 3);
  });
  test("a shot the writer skipped gets empty text", () => {
    const w = writing(false);
    w.shots = w.shots.filter((s) => s.n !== 2);
    assert.equal(applyWriting(plan(), w)[1].onScreenText, "");
  });
  test("onlyFilmIt leaves your text alone", () => {
    const base = plan();
    base[1].onScreenText = "mine";
    assert.equal(applyWriting(base, writing(true), true)[1].onScreenText, "mine");
  });
});

describe("placeAll", () => {
  test("a clip is never used twice: the second beat takes its next best, or becomes Film it", () => {
    const shots = shotsFromConcept(concept);
    const a = alt("a", "exact");
    const b = alt("b", "works");
    const out = placeAll(shots, [
      { alternates: [a], best: 0 },
      { alternates: [a, b], best: 0 },
      { alternates: [a], best: 0 },
    ]);
    assert.deepEqual(out.map((s) => s.libraryItemId), ["a", "b", undefined]);
    assert.equal(out[2].source, "film_it");
  });
  test("every shot gets its own id", () => {
    assert.equal(new Set(shotsFromConcept(concept).map((s) => s.id)).size, 3);
  });
});

describe("stock", () => {
  test("beats with people or screens are not sent to stock", () => {
    assert.equal(isStockAppropriate("Me walking into frame"), false);
    assert.equal(isStockAppropriate("Waves rolling onto a beach"), true);
  });
  test("the query is the first eight plain words", () => {
    assert.equal(stockQuery("A very, very long beat: with many words in it that go on"), "A very very long beat with many words");
  });
});

describe("takes", () => {
  const filmShot = () => ({ ...shotsFromConcept(concept)[0], note: "old" });
  const result = (verdict: "pass" | "usable" | "reshoot", over = {}) => ({ shotId: "x", assetId: "t1", verdict, notes: "", fix: "", useFromSeconds: 1, useToSeconds: 4, ...over });

  test("a new take waits for its check", () => {
    const s = addTake(filmShot(), "t1");
    assert.equal(s.takes[0].verdict, "checking");
    assert.equal(s.source, "film_it");
  });
  test("pass fills the shot with the take, cut to the model's range", () => {
    const s = applyTakeResult(addTake(filmShot(), "t1"), result("pass"));
    assert.deepEqual([s.source, s.libraryItemId, s.in, s.out, s.status, s.note], ["library", "t1", 1, 4, "filled", undefined]);
    assert.ok(s.filmIt, "the card stays, so a reshoot can reopen it");
  });
  test("usable fills the shot and says what to improve", () => {
    const s = applyTakeResult(addTake(filmShot(), "t1"), result("usable", { fix: "Step back." }));
    assert.equal(s.source, "library");
    assert.match(s.note ?? "", /Step back/);
  });
  test("reshoot keeps the card open with the fix", () => {
    const s = applyTakeResult(addTake(filmShot(), "t1"), result("reshoot", { fix: "Film it vertically." }));
    assert.equal(s.source, "film_it");
    assert.match(s.note ?? "", /vertically/);
    assert.equal(s.takes[0].verdict, "reshoot");
  });
  test("use anyway fills the shot from a reshoot and records the override", () => {
    const s = overrideTake(applyTakeResult(addTake(filmShot(), "t1"), result("reshoot", { fix: "x" })), "t1")!;
    assert.equal(s.source, "library");
    assert.equal(s.takes[0].overridden, true);
    assert.equal(overrideTake(s, "nope"), null);
  });
  test("a bad range falls back to the shot length", () => {
    const s = applyTakeResult(addTake(filmShot(), "t1"), result("pass", { useFromSeconds: 2, useToSeconds: 2 }));
    assert.deepEqual([s.in, s.out], [2, 5]);
  });
});

describe("posting", () => {
  const history = "== HISTORY ==\n\n--- REEL PERFORMANCE HISTORY ---\n1. A (May 3)\n   Concept: x\n2. B (May 5)\n   Concept: y\n\n--- WHAT TO REPLICATE ---\n- z\n";
  test("appendHistory adds the next number under the heading and keeps the rest", () => {
    const out = appendHistory(history, "C (May 9)\n   Concept: w");
    assert.match(out, /2\. B \(May 5\)\n {3}Concept: y\n3\. C \(May 9\)\n {3}Concept: w\n\n--- WHAT TO REPLICATE ---\n- z\n$/);
  });
  test("appendHistory starts a list when there is no heading, and drops a number the model added", () => {
    assert.match(appendHistory("notes", "7. First"), /--- REEL PERFORMANCE HISTORY ---\n1\. First\n$/);
  });
  test("numbersText says not entered for blanks", () => {
    assert.equal(numbersText({ views: 3120, shares: 22 }), "Views 3,120 · Reach not entered · Likes not entered · Shares 22 · Saves not entered · Comments not entered");
  });
  test("a posted format shows up for the freshness check", () => {
    const now = new Date("2026-06-10");
    assert.match(formatsText([{ format: "setup and punchline", title: "Dips", postedAt: new Date("2026-06-07") }], now), /setup and punchline: "Dips", 3 days ago/);
    assert.match(formatsText([]), /no posts recorded/);
  });
});

describe("merging duplicates", () => {
  test("repoint moves placed clips, alternates and takes to the kept item", () => {
    const base = shotsFromConcept({ title: "t", format: "f", lengthSeconds: 6, hook: "h", why: "w", beats: [{ n: 1, seconds: 6, shows: "x", onScreenText: "", spoken: "", sound: "" }] } as never)[0];
    const shot = { ...base, libraryItemId: "old", alternates: [{ libraryItemId: "old", label: "", fit: "works", why: "", in: 0, out: 1 } as Alternate], takes: [{ libraryItemId: "old", verdict: "pass" } as never] } as PlanShot;
    const [out] = repoint([shot], "old", "kept");
    assert.deepEqual([out.libraryItemId, out.alternates[0].libraryItemId, out.takes[0].libraryItemId], ["kept", "kept", "kept"]);
  });
});
