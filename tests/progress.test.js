import { test } from "node:test";
import assert from "node:assert/strict";
import { SolvedPuzzles, SOLVED_KEY } from "../js/progress.js";
import { fakeStorage, brokenStorage } from "./fake-storage.js";

test("solved puzzle IDs are saved and survive a reload", () => {
  const storage = fakeStorage();
  const solved = new SolvedPuzzles(storage);
  solved.add("abc");
  solved.add("xyz");
  solved.add("abc"); // no duplicates
  assert.equal(solved.size, 2);
  assert.deepEqual(JSON.parse(storage.data[SOLVED_KEY]), ["abc", "xyz"]);

  const reloaded = new SolvedPuzzles(storage);
  assert.equal(reloaded.has("abc"), true);
  assert.equal(reloaded.has("nope"), false);
});

test("clear() forgets everything, including in storage", () => {
  const storage = fakeStorage();
  const solved = new SolvedPuzzles(storage);
  solved.add("abc");
  solved.clear();
  assert.equal(solved.size, 0);
  assert.equal(new SolvedPuzzles(storage).size, 0);
});

test("corrupted or blocked storage starts with an empty list", () => {
  assert.equal(new SolvedPuzzles(fakeStorage({ [SOLVED_KEY]: "not json" })).size, 0);
  assert.equal(new SolvedPuzzles(fakeStorage({ [SOLVED_KEY]: '{"a":1}' })).size, 0);
  const solved = new SolvedPuzzles(brokenStorage);
  assert.doesNotThrow(() => { solved.add("abc"); solved.clear(); });
});
