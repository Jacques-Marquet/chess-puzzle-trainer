// Choosing which puzzles to serve: filtering by rating/theme and dealing them
// in a random order without repeats.

// Theme buttons on the Level Select screen: Lichess tag -> button label.
export const THEMES = [
  { tag: "fork", label: "Fork" },
  { tag: "pin", label: "Pin" },
  { tag: "skewer", label: "Skewer" },
  { tag: "discoveredAttack", label: "Discovered Attack" },
  { tag: "mateIn1", label: "Mate in 1" },
  { tag: "mateIn2", label: "Mate in 2" },
  { tag: "backRankMate", label: "Back Rank Mate" },
  { tag: "sacrifice", label: "Sacrifice" },
  { tag: "endgame", label: "Endgame" },
];

export const MIN_RATING = 600;
export const MAX_RATING = 2400;

/**
 * Puzzles within [minRating, maxRating] that have `theme` among their tags.
 * theme = null means any theme (the "Random" button and Play mode).
 */
export function filterPuzzles(puzzles, { minRating = -Infinity, maxRating = Infinity, theme = null } = {}) {
  return puzzles.filter(
    (p) => p.rating >= minRating && p.rating <= maxRating && (!theme || p.themes.includes(theme))
  );
}

/**
 * Deals puzzles like a shuffled deck: every puzzle is served once before any
 * repeats, then the deck is reshuffled.
 */
export class PuzzleDeck {
  constructor(puzzles, random = Math.random) {
    this.puzzles = puzzles;
    this.random = random;
    this.order = [];
  }

  get size() {
    return this.puzzles.length;
  }

  next() {
    if (this.puzzles.length === 0) return null;
    if (this.order.length === 0) this.order = shuffle([...this.puzzles], this.random);
    return this.order.pop();
  }
}

/** Fisher-Yates shuffle (in place). */
export function shuffle(list, random = Math.random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** "discoveredAttack" -> "Discovered Attack", using button labels where we have them. */
export function themeLabel(tag) {
  const known = THEMES.find((t) => t.tag === tag);
  if (known) return known.label;
  const words = tag.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
