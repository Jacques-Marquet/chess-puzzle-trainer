import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterPuzzles, PuzzleDeck, THEMES, themeLabel } from "../js/filter.js";

const PUZZLES = [
  { id: "a", rating: 650, themes: ["fork", "short"] },
  { id: "b", rating: 1200, themes: ["pin", "middlegame"] },
  { id: "c", rating: 1500, themes: ["fork", "pin"] },
  { id: "d", rating: 2300, themes: ["mateIn2", "backRankMate"] },
];
const ids = (list) => list.map((p) => p.id);

test("filters by rating range (inclusive)", () => {
  assert.deepEqual(ids(filterPuzzles(PUZZLES, { minRating: 650, maxRating: 1500 })), ["a", "b", "c"]);
  assert.deepEqual(ids(filterPuzzles(PUZZLES, { minRating: 1000, maxRating: 2000 })), ["b", "c"]);
});

test("filters by theme", () => {
  assert.deepEqual(ids(filterPuzzles(PUZZLES, { theme: "fork" })), ["a", "c"]);
  assert.deepEqual(ids(filterPuzzles(PUZZLES, { theme: "skewer" })), []);
});

test("filters by rating and theme together", () => {
  assert.deepEqual(ids(filterPuzzles(PUZZLES, { minRating: 1000, maxRating: 2400, theme: "pin" })), ["b", "c"]);
  assert.deepEqual(ids(filterPuzzles(PUZZLES, { minRating: 1300, maxRating: 2400, theme: "pin" })), ["c"]);
});

test("theme null (Random) uses only the rating range", () => {
  assert.deepEqual(ids(filterPuzzles(PUZZLES, { minRating: 1400, maxRating: 2400, theme: null })), ["c", "d"]);
});

test("deck serves every puzzle once before repeating", () => {
  const deck = new PuzzleDeck(PUZZLES);
  const firstRound = [1, 2, 3, 4].map(() => deck.next().id).sort();
  assert.deepEqual(firstRound, ["a", "b", "c", "d"]);
  assert.ok(deck.next()); // reshuffles and keeps going
});

test("empty deck returns null", () => {
  assert.equal(new PuzzleDeck([]).next(), null);
});

test("theme labels", () => {
  assert.equal(themeLabel("discoveredAttack"), "Discovered Attack");
  assert.equal(themeLabel("mateIn2"), "Mate in 2");
  assert.equal(themeLabel("queenRookEndgame"), "Queen Rook Endgame");
});

test("bundled data has puzzles for every theme button across the rating range", () => {
  const puzzles = JSON.parse(readFileSync(new URL("../data/puzzles.json", import.meta.url)));
  for (const { tag } of THEMES) {
    for (let lo = 600; lo < 2400; lo += 200) {
      const n = filterPuzzles(puzzles, { minRating: lo, maxRating: lo + 199, theme: tag }).length;
      assert.ok(n >= 20, `${tag} ${lo}-${lo + 199}: only ${n} puzzles`);
    }
  }
});
