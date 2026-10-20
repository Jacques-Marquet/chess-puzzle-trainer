// The rules of solving one puzzle, with no DOM code so it can be unit-tested.
//
// Lichess format reminder: `fen` is the position BEFORE the opponent's move,
// and moves[0] is that opponent move. The player then plays moves[1], the
// opponent replies with moves[2], and so on. Moves are in UCI notation
// ("e2e4", or "e7e8q" for a promotion).

import { Chess } from "../vendor/chess.js";

// After this many wrong tries on the same move, hintSquare() reveals the piece to move.
export const HINT_AFTER = 3;

export class PuzzleSession {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.chess = new Chess(puzzle.fen);
    this.ply = 0;           // index of the next move in puzzle.moves
    this.lastMove = null;
    this.solved = false;
    this.gaveUp = false;    // the player asked to see the solution
    this.wrongAttempts = 0; // wrong tries on the current move
    this.mistakes = 0;      // wrong tries over the whole puzzle
  }

  /** True once the puzzle is over: solved, or the solution was shown. */
  get finished() {
    return this.solved || this.gaveUp;
  }

  /** Solved without a single wrong move. */
  get firstTry() {
    return this.solved && this.mistakes === 0;
  }

  /** "white" or "black": the side the player solves for (moves after moves[0]). */
  get playerColor() {
    return this.puzzle.fen.split(" ")[1] === "w" ? "black" : "white";
  }

  get fen() {
    return this.chess.fen();
  }

  /** Play the opponent's opening move. Returns it so the UI can animate it. */
  start() {
    const move = this.puzzle.moves[0];
    this.play(move);
    this.ply = 1;
    return { move, fen: this.fen };
  }

  /** Legal destinations for the piece on `square`, if it is the player's turn. */
  legalMovesFrom(square) {
    if (this.finished || this.ply === 0) return [];
    return this.chess
      .moves({ square, verbose: true })
      .map((m) => ({ to: m.to, promotion: m.promotion }));
  }

  /** The square of the piece that should move, once the player has earned a hint. */
  hintSquare() {
    if (this.finished || this.ply === 0 || this.wrongAttempts < HINT_AFTER) return null;
    return this.puzzle.moves[this.ply].slice(0, 2);
  }

  /** Square of the king in check, or null. Used for the red check highlight. */
  checkSquare() {
    if (!this.chess.inCheck()) return null;
    const turn = this.chess.turn();
    for (const row of this.chess.board()) {
      for (const p of row) {
        if (p && p.type === "k" && p.color === turn) return p.square;
      }
    }
    return null;
  }

  /**
   * Check the player's move against the solution.
   *
   * Wrong:   the move is undone and { correct: false, fenAfter } is returned,
   *          where fenAfter is the position the wrong move WOULD have reached
   *          (so the UI can show it briefly before snapping back).
   * Correct: the opponent's reply from the solution is played automatically
   *          and returned as `reply`. A checkmating move always counts as
   *          correct, even if the stored solution is a different move.
   */
  tryMove(uci) {
    if (this.finished || this.ply === 0) return { correct: false, illegal: true };

    const previousLastMove = this.lastMove;
    if (!this.play(uci)) return { correct: false, illegal: true };
    const fenAfter = this.fen;

    const expected = this.puzzle.moves[this.ply];
    const correct = uci === expected || this.chess.isCheckmate();
    if (!correct) {
      this.chess.undo();
      this.lastMove = previousLastMove;
      this.wrongAttempts++;
      this.mistakes++;
      return { correct: false, fenAfter };
    }

    this.ply++;
    this.wrongAttempts = 0;
    if (this.chess.isCheckmate() || this.ply >= this.puzzle.moves.length) {
      this.solved = true;
      return { correct: true, solved: true, fen: fenAfter };
    }

    const replyMove = this.puzzle.moves[this.ply];
    this.play(replyMove);
    this.ply++;
    this.solved = this.ply >= this.puzzle.moves.length;
    return {
      correct: true,
      solved: this.solved,
      fen: fenAfter,
      reply: { move: replyMove, fen: this.fen },
    };
  }

  /**
   * Give up: play out the rest of the solution, both sides' moves. Returns
   * them in order as [{ move, fen, check }] so the UI can animate each one
   * (check is the square of a king in check after that move, or null).
   */
  revealSolution() {
    if (this.finished || this.ply === 0) return [];
    const steps = [];
    while (this.ply < this.puzzle.moves.length) {
      const move = this.puzzle.moves[this.ply];
      this.play(move);
      this.ply++;
      steps.push({ move, fen: this.fen, check: this.checkSquare() });
    }
    this.gaveUp = true;
    return steps;
  }

  /** Play a UCI move on the internal board; returns false if it is illegal. */
  play(uci) {
    try {
      this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return false; // chess.js throws on illegal moves
    }
    this.lastMove = uci;
    return true;
  }
}
