// Remembers which puzzles you have solved, across visits, so a new session
// can serve puzzles you haven't seen yet. Storage is passed in so tests can
// use a fake, like Streak.

export const SOLVED_KEY = "chess-trainer:solved";

export class SolvedPuzzles {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.ids = this.load();
  }

  get size() {
    return this.ids.size;
  }

  has(id) {
    return this.ids.has(id);
  }

  add(id) {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.save();
  }

  clear() {
    this.ids.clear();
    try {
      this.storage?.removeItem(SOLVED_KEY);
    } catch {
      // Not fatal: the list just won't be cleared on disk.
    }
  }

  load() {
    try {
      const list = JSON.parse(this.storage?.getItem(SOLVED_KEY) ?? "[]");
      return new Set(Array.isArray(list) ? list.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set(); // blocked storage or corrupted data: start fresh
    }
  }

  save() {
    try {
      this.storage?.setItem(SOLVED_KEY, JSON.stringify([...this.ids]));
    } catch {
      // Not fatal: progress just won't persist.
    }
  }
}
