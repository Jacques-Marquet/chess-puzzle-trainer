// Your puzzle history and the numbers worked out from it. AttemptLog saves one
// record per finished puzzle; the functions below are pure calculations over
// that list, so they are easy to unit-test.
//
// An attempt looks like:
//   { id, rating, themes, outcome: "solved" | "revealed" | "skipped",
//     firstTry, wrongMoves, ms, at }
// firstTry is true only when the puzzle was solved with no wrong moves and no hint.

import { THEMES, MIN_RATING, MAX_RATING } from "./filter.js";

export const ATTEMPTS_KEY = "chess-trainer:attempts";
export const MAX_ATTEMPTS = 5000;      // oldest attempts are dropped beyond this
export const BAND_SIZE = 200;          // rating bands: 600-800, 800-1000, ...
export const MIN_ATTEMPTS_FOR_WEAKEST = 3;

export class AttemptLog {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.attempts = this.load();
  }

  record(attempt) {
    this.attempts.push(attempt);
    if (this.attempts.length > MAX_ATTEMPTS) {
      this.attempts.splice(0, this.attempts.length - MAX_ATTEMPTS);
    }
    this.save();
  }

  clear() {
    this.attempts = [];
    try {
      this.storage?.removeItem(ATTEMPTS_KEY);
    } catch {
      // Not fatal.
    }
  }

  load() {
    try {
      const list = JSON.parse(this.storage?.getItem(ATTEMPTS_KEY) ?? "[]");
      return Array.isArray(list) ? list.filter(isAttempt) : [];
    } catch {
      return []; // blocked storage or corrupted data: start fresh
    }
  }

  save() {
    try {
      this.storage?.setItem(ATTEMPTS_KEY, JSON.stringify(this.attempts));
    } catch {
      // Not fatal: stats just won't persist.
    }
  }
}

const isAttempt = (a) =>
  a && typeof a.id === "string" && typeof a.rating === "number" && Array.isArray(a.themes);

/** First-try count and rate for a group of attempts. rate is null when empty. */
function tally(attempts) {
  const attempted = attempts.length;
  const firstTry = attempts.filter((a) => a.firstTry).length;
  return { attempted, firstTry, rate: attempted ? firstTry / attempted : null };
}

/** Totals over every attempt, plus the average time per puzzle in ms. */
export function summarize(attempts) {
  const timed = attempts.filter((a) => a.ms > 0);
  const avgMs = timed.length ? timed.reduce((sum, a) => sum + a.ms, 0) / timed.length : null;
  return { ...tally(attempts), avgMs };
}

/**
 * First-try accuracy for each trained theme, weakest first. Themes you
 * haven't tried yet come last, in their usual order.
 */
export function accuracyByTheme(attempts, themes = THEMES.map((t) => t.tag)) {
  const rows = themes.map((theme) => ({
    theme,
    ...tally(attempts.filter((a) => a.themes.includes(theme))),
  }));
  const tried = rows.filter((r) => r.attempted > 0);
  const untried = rows.filter((r) => r.attempted === 0);
  // Lowest rate first; among equal rates, the theme with more attempts first.
  tried.sort((a, b) => a.rate - b.rate || b.attempted - a.attempted);
  return [...tried, ...untried];
}

/**
 * First-try accuracy in rating bands of `size` points between min and max.
 * A band includes its lower bound: 800 is in 800-1000, not 600-800.
 */
export function accuracyByRating(attempts, { min = MIN_RATING, max = MAX_RATING, size = BAND_SIZE } = {}) {
  const count = Math.ceil((max - min) / size);
  const bands = Array.from({ length: count }, (_, i) => ({
    min: min + i * size,
    max: Math.min(min + (i + 1) * size, max),
    attempts: [],
  }));
  for (const a of attempts) {
    // Ratings just outside the range go into the first or last band.
    const i = Math.min(count - 1, Math.max(0, Math.floor((a.rating - min) / size)));
    bands[i].attempts.push(a);
  }
  return bands.map(({ min, max, attempts }) => ({ min, max, ...tally(attempts) }));
}

/**
 * The theme with the lowest first-try rate, ignoring themes with fewer than
 * `minAttempts` attempts (one unlucky miss shouldn't decide it). null if none.
 */
export function weakestTheme(attempts, { themes, minAttempts = MIN_ATTEMPTS_FOR_WEAKEST } = {}) {
  const row = accuracyByTheme(attempts, themes).find((r) => r.attempted >= minAttempts);
  return row ? row.theme : null;
}
