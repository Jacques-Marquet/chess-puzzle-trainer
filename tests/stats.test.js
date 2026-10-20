import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AttemptLog, ATTEMPTS_KEY, MAX_ATTEMPTS,
  summarize, accuracyByTheme, accuracyByRating, weakestTheme,
} from "../js/stats.js";
import { fakeStorage, brokenStorage } from "./fake-storage.js";

let n = 0;
const attempt = (rating, themes, firstTry, ms = 10000) =>
  ({ id: `p${n++}`, rating, themes, outcome: firstTry ? "solved" : "skipped", firstTry, wrongMoves: firstTry ? 0 : 1, ms, at: 0 });

const HISTORY = [
  attempt(650, ["fork"], true, 4000),
  attempt(700, ["fork", "short"], true, 8000),
  attempt(1250, ["pin"], false, 12000),
  attempt(1300, ["pin", "fork"], false, 0), // skipped before moving: no time
  attempt(1500, ["pin"], true, 6000),
  attempt(2300, ["mateIn2"], true, 10000),
];

test("summarize: attempts, first-try rate and average time", () => {
  const s = summarize(HISTORY);
  assert.equal(s.attempted, 6);
  assert.equal(s.firstTry, 4);
  assert.equal(s.rate, 4 / 6);
  assert.equal(s.avgMs, 8000); // the attempt with ms = 0 is left out
});

test("summarize: empty history has no rate or time", () => {
  assert.deepEqual(summarize([]), { attempted: 0, firstTry: 0, rate: null, avgMs: null });
});

test("accuracy by theme is sorted weakest first, untried themes last", () => {
  const rows = accuracyByTheme(HISTORY, ["fork", "pin", "skewer", "mateIn2"]);
  assert.deepEqual(rows.map((r) => r.theme), ["pin", "fork", "mateIn2", "skewer"]);
  // A puzzle counts towards every theme it has: fork has 3 attempts, 2 first try.
  assert.deepEqual(rows[1], { theme: "fork", attempted: 3, firstTry: 2, rate: 2 / 3 });
  assert.deepEqual(rows[3], { theme: "skewer", attempted: 0, firstTry: 0, rate: null });
});

test("accuracy by theme breaks ties by number of attempts", () => {
  const rows = accuracyByTheme([
    attempt(1000, ["pin"], false),
    attempt(1000, ["fork"], false),
    attempt(1000, ["fork"], false),
  ], ["pin", "fork"]);
  assert.deepEqual(rows.map((r) => r.theme), ["fork", "pin"]);
});

test("accuracy by rating uses 200-point bands that include their lower bound", () => {
  const bands = accuracyByRating([
    attempt(600, [], true),
    attempt(799, [], false),
    attempt(800, [], true),
    attempt(2400, [], true),  // top edge goes in the last band
    attempt(550, [], false),  // below the range goes in the first band
  ]);
  assert.equal(bands.length, 9);
  assert.deepEqual(bands[0], { min: 600, max: 800, attempted: 3, firstTry: 1, rate: 1 / 3 });
  assert.deepEqual(bands[1], { min: 800, max: 1000, attempted: 1, firstTry: 1, rate: 1 });
  assert.deepEqual(bands[8], { min: 2200, max: 2400, attempted: 1, firstTry: 1, rate: 1 });
  assert.equal(bands[4].rate, null);
});

test("weakest theme needs a minimum number of attempts", () => {
  const themes = ["fork", "pin", "skewer"];
  assert.equal(weakestTheme(HISTORY, { themes }), "pin"); // 1/3
  // With only two attempts, nothing qualifies at the default of three.
  assert.equal(weakestTheme(HISTORY.slice(0, 2), { themes }), null);
  assert.equal(weakestTheme(HISTORY.slice(0, 2), { themes, minAttempts: 2 }), "fork");
  assert.equal(weakestTheme([], { themes }), null);
});

test("weakest theme defaults to the Level Select themes only", () => {
  const history = [1, 2, 3].map(() => attempt(1000, ["short", "endgame"], false));
  assert.equal(weakestTheme(history), "endgame"); // "short" isn't a trained theme
});

test("attempt log saves, reloads and clears", () => {
  const storage = fakeStorage();
  const log = new AttemptLog(storage);
  log.record(HISTORY[0]);
  log.record(HISTORY[1]);
  assert.deepEqual(new AttemptLog(storage).attempts, [HISTORY[0], HISTORY[1]]);
  log.clear();
  assert.deepEqual(log.attempts, []);
  assert.equal(storage.data[ATTEMPTS_KEY], undefined);
});

test("attempt log keeps only the most recent attempts", () => {
  const storage = fakeStorage();
  const log = new AttemptLog(storage);
  for (let i = 0; i < MAX_ATTEMPTS + 5; i++) log.attempts.push(attempt(1000, [], true));
  log.record(attempt(1000, [], false));
  assert.equal(log.attempts.length, MAX_ATTEMPTS);
  assert.equal(log.attempts.at(-1).firstTry, false);
});

test("attempt log copes with corrupted or blocked storage", () => {
  assert.deepEqual(new AttemptLog(fakeStorage({ [ATTEMPTS_KEY]: "{oops" })).attempts, []);
  const mixed = JSON.stringify([HISTORY[0], { junk: true }, null]);
  assert.deepEqual(new AttemptLog(fakeStorage({ [ATTEMPTS_KEY]: mixed })).attempts, [HISTORY[0]]);
  const log = new AttemptLog(brokenStorage);
  assert.doesNotThrow(() => { log.record(HISTORY[0]); log.clear(); });
});
