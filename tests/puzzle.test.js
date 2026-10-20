import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PuzzleSession, HINT_AFTER } from "../js/puzzle.js";

// Real puzzle 4VfTC from the Lichess database (mate in 2, player is White).
const BACK_RANK = {
  id: "4VfTC",
  fen: "1k3Q2/pppr3p/3b4/1q6/3P4/5NP1/PPP3PP/R3R1K1 b - - 0 22",
  moves: ["d6f8", "e1e8", "d7d8", "e8d8"],
  rating: 602,
  themes: ["backRankMate", "mateIn2"],
};

// Two different mates in one (Ra8# and Re8#); only Ra8 is stored.
const TWO_MATES = {
  id: "twoMates",
  fen: "6k1/5ppp/8/8/8/8/8/R3R1K1 b - - 0 1",
  moves: ["g8h8", "a1a8"],
  rating: 600,
  themes: ["mateIn1"],
};

// White must promote to a queen (a knight is wrong).
const PROMOTION = {
  id: "promo",
  fen: "7k/P7/8/8/8/8/8/K6r b - - 0 1",
  moves: ["h1h2", "a7a8q", "h8g7", "a8b7"],
  rating: 900,
  themes: ["promotion"],
};

test("start() plays the opponent's first move and the player is the other side", () => {
  const s = new PuzzleSession(BACK_RANK);
  assert.equal(s.playerColor, "white"); // FEN has Black to move first
  const { move, fen } = s.start();
  assert.equal(move, "d6f8");
  assert.equal(fen.split(" ")[1], "w");
  assert.equal(s.lastMove, "d6f8");
});

test("player plays Black when the FEN has White to move", () => {
  const s = new PuzzleSession({ ...BACK_RANK, fen: "2K5/1P4p1/2k4p/4r3/7P/8/8/8 w - - 0 45" });
  assert.equal(s.playerColor, "black");
});

test("no moves are allowed before the opponent's first move is played", () => {
  const s = new PuzzleSession(BACK_RANK);
  assert.deepEqual(s.legalMovesFrom("e1"), []);
  assert.equal(s.tryMove("e1e8").correct, false);
});

test("correct move is accepted and the opponent's reply is played automatically", () => {
  const s = new PuzzleSession(BACK_RANK);
  s.start();
  const r = s.tryMove("e1e8");
  assert.equal(r.correct, true);
  assert.equal(r.solved, false);
  assert.equal(r.reply.move, "d7d8");
  assert.equal(s.fen, r.reply.fen);
  assert.equal(s.lastMove, "d7d8");
  assert.equal(s.fen.split(" ")[1], "w"); // player's turn again
});

test("wrong move is undone so the position returns to before the move", () => {
  const s = new PuzzleSession(BACK_RANK);
  s.start();
  const before = s.fen;
  const r = s.tryMove("a2a3");
  assert.equal(r.correct, false);
  assert.notEqual(r.fenAfter, before); // the attempted position, for display
  assert.equal(s.fen, before);
  assert.equal(s.lastMove, "d6f8");
  // ...and the player can try again.
  assert.equal(s.tryMove("e1e8").correct, true);
});

test("illegal move is rejected without changing the position", () => {
  const s = new PuzzleSession(BACK_RANK);
  s.start();
  const before = s.fen;
  const r = s.tryMove("e1d2"); // rooks cannot move diagonally
  assert.deepEqual(r, { correct: false, illegal: true });
  assert.equal(s.fen, before);
});

test("solving the final move marks the puzzle solved", () => {
  const s = new PuzzleSession(BACK_RANK);
  s.start();
  s.tryMove("e1e8");
  const r = s.tryMove("e8d8");
  assert.deepEqual(r.correct && r.solved, true);
  assert.equal(r.reply, undefined);
  assert.equal(s.solved, true);
  assert.deepEqual(s.legalMovesFrom("d8"), []); // board is locked
});

test("a checkmate counts as correct even if it differs from the solution", () => {
  const s = new PuzzleSession(TWO_MATES);
  s.start();
  const r = s.tryMove("e1e8");
  assert.equal(r.correct, true);
  assert.equal(r.solved, true);
});

test("the stored mate is also accepted", () => {
  const s = new PuzzleSession(TWO_MATES);
  s.start();
  assert.equal(s.tryMove("a1a8").solved, true);
});

test("promotion: legal moves report it, and the promotion piece must match", () => {
  const s = new PuzzleSession(PROMOTION);
  s.start();
  const toA8 = s.legalMovesFrom("a7").filter((m) => m.to === "a8");
  assert.deepEqual(toA8.map((m) => m.promotion).sort(), ["b", "n", "q", "r"]);
  assert.equal(s.tryMove("a7a8n").correct, false);
  assert.equal(s.tryMove("a7a8").correct, false); // no piece chosen = illegal
  const r = s.tryMove("a7a8q");
  assert.equal(r.correct, true);
  assert.equal(r.reply.move, "h8g7");
});

test("checkSquare() finds the king in check", () => {
  const s = new PuzzleSession(PROMOTION);
  s.start();
  s.tryMove("a7a8q"); // reply h8g7 escapes the check
  assert.equal(s.checkSquare(), null);
  const t = new PuzzleSession(TWO_MATES);
  t.start();
  t.tryMove("a1a8");
  assert.equal(t.checkSquare(), "h8");
});

test("hint: the piece to move is revealed after three wrong tries", () => {
  const s = new PuzzleSession(BACK_RANK);
  s.start();
  assert.equal(HINT_AFTER, 3);
  s.tryMove("a2a3");
  s.tryMove("a2a4");
  assert.equal(s.hintSquare(), null); // only two wrong tries so far
  s.tryMove("e1d2");                  // illegal moves don't count
  assert.equal(s.hintSquare(), null);
  s.tryMove("b2b3");
  assert.equal(s.hintSquare(), "e1"); // the rook on e1 should move
});

test("hint resets once the move is found", () => {
  const s = new PuzzleSession(BACK_RANK);
  s.start();
  for (const m of ["a2a3", "a2a4", "b2b3"]) s.tryMove(m);
  assert.equal(s.tryMove("e1e8").correct, true);
  assert.equal(s.wrongAttempts, 0);
  assert.equal(s.hintSquare(), null); // next move needs three new wrong tries
});

test("revealSolution() plays out every remaining move and ends the puzzle", () => {
  const s = new PuzzleSession(BACK_RANK);
  s.start();
  const steps = s.revealSolution();
  assert.deepEqual(steps.map((x) => x.move), ["e1e8", "d7d8", "e8d8"]);
  assert.deepEqual(steps.map((x) => x.check), ["b8", null, "b8"]); // Re8+, Rd8, Rxd8#
  assert.equal(s.fen, steps[2].fen);
  assert.equal(s.lastMove, "e8d8");
  assert.equal(s.gaveUp, true);
  assert.equal(s.solved, false); // giving up is not solving
  assert.equal(s.finished, true);
  assert.deepEqual(s.legalMovesFrom("d8"), []);
  assert.equal(s.tryMove("a2a3").correct, false);
});

test("revealSolution() continues from where the player got to", () => {
  const s = new PuzzleSession(BACK_RANK);
  s.start();
  s.tryMove("e1e8"); // correct; the reply d7d8 is played
  assert.deepEqual(s.revealSolution().map((x) => x.move), ["e8d8"]);
});

test("revealSolution() does nothing before the start or after solving", () => {
  const s = new PuzzleSession(TWO_MATES);
  assert.deepEqual(s.revealSolution(), []);
  s.start();
  s.tryMove("a1a8");
  assert.deepEqual(s.revealSolution(), []);
  assert.equal(s.gaveUp, false);
});

test("every puzzle in data/puzzles.json is legal from start to finish", () => {
  const puzzles = JSON.parse(readFileSync(new URL("../data/puzzles.json", import.meta.url)));
  assert.ok(puzzles.length >= 4000);
  for (const p of puzzles) {
    const s = new PuzzleSession(p);
    s.start();
    while (!s.solved) {
      const r = s.tryMove(p.moves[s.ply]);
      assert.equal(r.correct, true, `puzzle ${p.id} failed at ply ${s.ply}`);
    }
  }
});
