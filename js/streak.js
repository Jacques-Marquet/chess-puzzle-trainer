// Counts correct moves in a row. The best streak is saved in browser storage
// so it survives page reloads. Storage is passed in so tests can use a fake.

export const BEST_STREAK_KEY = "chess-trainer:bestStreak";

export class Streak {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.current = 0;
    this.best = this.load();
  }

  correct() {
    this.current++;
    if (this.current > this.best) {
      this.best = this.current;
      this.save();
    }
  }

  wrong() {
    this.current = 0;
  }

  load() {
    try {
      return Number(this.storage?.getItem(BEST_STREAK_KEY)) || 0;
    } catch {
      return 0; // storage can be blocked (e.g. some private windows)
    }
  }

  save() {
    try {
      this.storage?.setItem(BEST_STREAK_KEY, String(this.best));
    } catch {
      // Not fatal: the best streak just won't persist.
    }
  }
}
