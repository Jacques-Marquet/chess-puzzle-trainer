import { test } from "node:test";
import assert from "node:assert/strict";
import { Streak, BEST_STREAK_KEY } from "../js/streak.js";

// Minimal stand-in for window.localStorage.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

test("counts correct moves and resets to 0 on a wrong move", () => {
  const s = new Streak(fakeStorage());
  s.correct(); s.correct(); s.correct();
  assert.equal(s.current, 3);
  s.wrong();
  assert.equal(s.current, 0);
  s.correct();
  assert.equal(s.current, 1);
});

test("best streak only goes up and is saved", () => {
  const storage = fakeStorage();
  const s = new Streak(storage);
  s.correct(); s.correct();
  s.wrong();
  s.correct();
  assert.equal(s.best, 2);
  assert.equal(storage.data[BEST_STREAK_KEY], "2");
});

test("best streak persists between visits", () => {
  const storage = fakeStorage({ [BEST_STREAK_KEY]: "7" });
  const s = new Streak(storage);
  assert.equal(s.best, 7);
  assert.equal(s.current, 0);
});

test("blocked storage does not crash", () => {
  const broken = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  const s = new Streak(broken);
  s.correct();
  assert.equal(s.best, 1);
});

test("reset() clears the current and the saved best streak", () => {
  const storage = fakeStorage();
  const s = new Streak(storage);
  s.correct(); s.correct();
  s.reset();
  assert.equal(s.current, 0);
  assert.equal(s.best, 0);
  assert.equal(new Streak(storage).best, 0);
});
