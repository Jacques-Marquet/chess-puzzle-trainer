// Wires the screens together: loads the puzzle data, handles the menu and
// level select, and runs the puzzle screen by connecting the Board (what you
// see) to PuzzleSession (the rules of the puzzle), Streak (the score),
// SolvedPuzzles (which puzzles you've already done) and AttemptLog (stats).

import { Board, wait } from "./board.js";
import { PuzzleSession } from "./puzzle.js";
import { Streak } from "./streak.js";
import { SolvedPuzzles } from "./progress.js";
import { Sounds } from "./sound.js";
import { AttemptLog, summarize, accuracyByTheme, accuracyByRating, weakestTheme, MIN_ATTEMPTS_FOR_WEAKEST } from "./stats.js";
import { filterPuzzles, PuzzleDeck, THEMES, themeLabel, MIN_RATING, MAX_RATING } from "./filter.js";

const SHOW_THEMES_KEY = "chess-trainer:showThemes";
const LEVEL_RANGE_KEY = "chess-trainer:levelRange";
const OPENING_DELAY_MS = 500;  // pause before the opponent's first move
const REPLY_DELAY_MS = 400;    // pause before the opponent's reply
const WRONG_MOVE_MS = 700;     // how long a wrong move stays on the board
const MIN_GAP = 100;           // smallest allowed rating range

const $ = (id) => document.getElementById(id);

let allPuzzles = [];
let deck = null;
let session = null;
let loadToken = 0; // bumps on every new puzzle so stale async steps stop
let turnStartedAt = null; // when the player could first move, for timing
let recorded = false;     // whether this puzzle's attempt has been logged
const streak = new Streak();
const solved = new SolvedPuzzles();
const attempts = new AttemptLog();
const sounds = new Sounds();

const board = new Board($("board"), {
  getLegalMoves: (square) => session?.legalMovesFrom(square) ?? [],
  onMove: (uci) => handlePlayerMove(uci),
});

// ---------- screens ----------

function showScreen(id) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function goToMenu() {
  loadToken++; // cancel any puzzle animation in progress
  setPlayerTurn(false);
  $("menu-count").textContent = allPuzzles.length.toLocaleString();
  $("menu-best").textContent = streak.best;
  $("menu-solved").textContent = solved.size.toLocaleString();
  disarmReset();
  $("menu-status").hidden = true;
  showScreen("menu");
}

for (const btn of document.querySelectorAll('[data-action="menu"]')) {
  btn.addEventListener("click", goToMenu);
}

// ---------- menu ----------

// Decorative board on the menu: a knight fork, the classic tactic.
const menuBoard = new Board($("menu-board"), { getLegalMoves: () => [], onMove: () => {} });
menuBoard.setPosition("r3k2r/ppN2ppp/2n5/8/8/8/PPP2PPP/R3K2R b KQkq - 0 1", {
  lastMove: "d5c7",
  check: "e8",
});
menuBoard.setArrows([["c7", "e8"], ["c7", "a8"]]);

$("play-btn").addEventListener("click", () => {
  startTraining(allPuzzles, "Play · All puzzles");
});
$("levels-btn").addEventListener("click", () => {
  updateRange();
  showScreen("levels");
});
$("stats-btn").addEventListener("click", showStats);

// "Reset progress" asks for a second click instead of a pop-up dialog.
const RESET_CONFIRM_MS = 4000;
let resetTimer = null;

$("reset-btn").addEventListener("click", () => {
  if (!$("reset-btn").classList.contains("armed")) {
    $("reset-btn").classList.add("armed");
    $("reset-btn").textContent = "Click again to clear solved puzzles, stats and best streak";
    resetTimer = setTimeout(disarmReset, RESET_CONFIRM_MS);
    return;
  }
  solved.clear();
  attempts.clear();
  streak.reset();
  updateStreak();
  goToMenu();
  $("reset-btn").textContent = "Progress reset ✓";
});

function disarmReset() {
  clearTimeout(resetTimer);
  $("reset-btn").classList.remove("armed");
  $("reset-btn").textContent = "Reset progress";
}

// ---------- level select ----------

const rangeMin = $("range-min");
const rangeMax = $("range-max");
rangeMin.min = rangeMax.min = MIN_RATING;
rangeMin.max = rangeMax.max = MAX_RATING;

function updateRange(changed) {
  let lo = Number(rangeMin.value), hi = Number(rangeMax.value);
  // Keep the two handles from crossing: the one being dragged stops short.
  if (hi - lo < MIN_GAP) {
    if (changed === rangeMax) hi = rangeMax.value = lo + MIN_GAP;
    else lo = rangeMin.value = hi - MIN_GAP;
  }
  $("range-min-out").textContent = lo;
  $("range-max-out").textContent = hi;
  const pct = (v) => ((v - MIN_RATING) / (MAX_RATING - MIN_RATING)) * 100;
  $("range-fill").style.left = `${pct(lo)}%`;
  $("range-fill").style.right = `${100 - pct(hi)}%`;
  try { localStorage.setItem(LEVEL_RANGE_KEY, JSON.stringify([lo, hi])); } catch { /* ignore */ }
  // Show how many puzzles each theme button would give.
  for (const btn of $("theme-grid").children) {
    const n = filterPuzzles(allPuzzles, { minRating: lo, maxRating: hi, theme: btn.dataset.theme || null }).length;
    btn.querySelector(".count").textContent = `${n} puzzles`;
    btn.disabled = n === 0;
  }
}

rangeMin.addEventListener("input", () => updateRange(rangeMin));
rangeMax.addEventListener("input", () => updateRange(rangeMax));

function buildThemeButtons() {
  const options = [...THEMES, { tag: "", label: "Random" }];
  for (const { tag, label } of options) {
    const btn = document.createElement("button");
    btn.className = `btn theme-btn${tag ? "" : " theme-random"}`;
    btn.dataset.theme = tag;
    btn.innerHTML = `<span class="theme-name"></span><span class="count"></span>`;
    btn.querySelector(".theme-name").textContent = label;
    btn.addEventListener("click", () => startThemeTraining(tag || null));
    $("theme-grid").append(btn);
  }
}

/** Puzzles for a theme (null = any) within the Level Select rating range. */
function levelSelection(theme) {
  const lo = Number(rangeMin.value), hi = Number(rangeMax.value);
  const label = theme ? themeLabel(theme) : "Random";
  return {
    puzzles: filterPuzzles(allPuzzles, { minRating: lo, maxRating: hi, theme }),
    label: `${label} · ${lo}–${hi}`,
  };
}

function startThemeTraining(theme) {
  const { puzzles, label } = levelSelection(theme);
  if (puzzles.length > 0) startTraining(puzzles, label);
}

/** Restore the last rating range chosen on Level Select. */
function loadRange() {
  try {
    const [lo, hi] = JSON.parse(localStorage.getItem(LEVEL_RANGE_KEY));
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      rangeMin.value = lo;
      rangeMax.value = hi;
    }
  } catch { /* nothing saved yet */ }
  updateRange();
}

// ---------- stats ----------

function showStats() {
  const list = attempts.attempts;
  const summary = summarize(list);
  $("stats-attempted").textContent = summary.attempted.toLocaleString();
  $("stats-rate").textContent = percent(summary.rate);
  $("stats-time").textContent = summary.avgMs === null ? "–" : `${Math.round(summary.avgMs / 1000)}s`;
  $("stats-empty").hidden = list.length > 0;

  $("theme-stats").replaceChildren(...accuracyByTheme(list).map((r) => statBar(themeLabel(r.theme), r)));
  $("rating-stats").replaceChildren(...accuracyByRating(list).map((r) => statBar(`${r.min}–${r.max}`, r)));

  // Practise button: weakest theme within the Level Select rating range.
  const weakest = weakestTheme(list);
  const btn = $("practise-btn");
  if (!weakest) {
    btn.disabled = true;
    btn.textContent = "Practise weakest theme";
    $("practise-note").textContent =
      `Attempt at least ${MIN_ATTEMPTS_FOR_WEAKEST} puzzles in a theme to find your weakest one.`;
  } else {
    const { puzzles, label } = levelSelection(weakest);
    btn.disabled = puzzles.length === 0;
    btn.textContent = `Practise ${themeLabel(weakest)}`;
    btn.dataset.theme = weakest;
    $("practise-note").textContent = puzzles.length
      ? `${label}, your Level Select rating range (${puzzles.length} puzzles).`
      : `No ${themeLabel(weakest)} puzzles in your Level Select range (${label}). Widen it on Level Select.`;
  }
  showScreen("stats");
}

$("practise-btn").addEventListener("click", () => startThemeTraining($("practise-btn").dataset.theme));

/** One row of a bar chart: label, bar filled to the first-try rate, value. */
function statBar(label, { attempted, firstTry, rate }) {
  const row = document.createElement("div");
  row.className = "bar-row";
  const level = rate === null ? "none" : rate < 0.5 ? "low" : rate < 0.75 ? "mid" : "high";
  row.innerHTML = `<span class="bar-label"></span>
    <span class="bar"><span class="bar-fill bar-${level}"></span></span>
    <span class="bar-value"></span>`;
  row.querySelector(".bar-label").textContent = label;
  row.querySelector(".bar-fill").style.width = `${(rate ?? 0) * 100}%`;
  row.querySelector(".bar-value").textContent =
    attempted ? `${percent(rate)} (${firstTry}/${attempted})` : "no data";
  return row;
}

const percent = (rate) => (rate === null ? "–" : `${Math.round(rate * 100)}%`);

// ---------- puzzle screen ----------

function startTraining(puzzles, label, first = null) {
  // Puzzles solved on earlier visits are only served once the rest run out.
  deck = new PuzzleDeck(puzzles, { isSeen: (p) => solved.has(p.id) });
  $("mode-label").textContent = label;
  showScreen("puzzle");
  loadNextPuzzle(first ?? deck.next());
}

async function loadNextPuzzle(puzzle = deck.next()) {
  const token = ++loadToken;
  if (!puzzle) return;
  session = new PuzzleSession(puzzle);
  turnStartedAt = null;
  recorded = false;

  // Show the starting position from the player's side, before the opponent moves.
  setPlayerTurn(false);
  board.clearBadge();
  board.clearAnnotations();
  board.setOrientation(session.playerColor);
  board.setPosition(puzzle.fen);
  showPuzzleInfo(puzzle);
  setFinished(false);
  setStatus("Watch the opponent's move…");

  await wait(OPENING_DELAY_MS);
  if (token !== loadToken) return;
  const { move, fen, capture } = session.start();
  await board.animateMove(move, fen, { lastMove: move, check: session.checkSquare() });
  if (token !== loadToken) return;
  sounds.move(capture);

  setStatus(`Find the best move for ${capitalize(session.playerColor)}.`);
  turnStartedAt = performance.now();
  setPlayerTurn(true);
}

async function handlePlayerMove(uci) {
  const token = loadToken;
  setPlayerTurn(false);
  const result = session.tryMove(uci);
  const to = uci.slice(2, 4);

  if (result.illegal) {
    board.setPosition(session.fen, { lastMove: session.lastMove, hint: session.hintSquare() });
    setPlayerTurn(true);
    return;
  }

  if (!result.correct) {
    sounds.play("wrong");
    streak.wrong();
    updateStreak();
    // Briefly show the wrong move with a red cross, then take it back.
    board.setPosition(result.fenAfter, { lastMove: uci });
    board.showBadge(to, "wrong");
    setStatus("Not quite – try again.", "wrong");
    await wait(WRONG_MOVE_MS);
    if (token !== loadToken) return;
    board.clearBadge();
    const hint = session.hintSquare(); // set after HINT_AFTER wrong tries
    board.setPosition(session.fen, { lastMove: session.lastMove, check: session.checkSquare(), hint });
    if (hint) setStatus("Hint: the highlighted piece is the one to move.", "hint");
    setPlayerTurn(true);
    return;
  }

  streak.correct();
  updateStreak();
  board.setPosition(result.fen, { lastMove: uci, check: result.solved ? session.checkSquare() : null });
  board.showBadge(to, "correct");
  sounds.move(result.capture);

  if (result.solved) {
    sounds.play("solved");
    solved.add(session.puzzle.id);
    recordAttempt("solved");
    setStatus("Puzzle solved! 🎉", "solved");
    setFinished(true);
    return;
  }

  setStatus("Correct! Keep going…", "correct");
  await wait(REPLY_DELAY_MS);
  if (token !== loadToken) return;
  const { move, fen, capture } = result.reply;
  await board.animateMove(move, fen, { lastMove: move, check: session.checkSquare() });
  if (token !== loadToken) return;
  sounds.move(capture);
  board.clearBadge();
  setStatus(`Your move again – find the best continuation.`);
  setPlayerTurn(true);
}

function showPuzzleInfo(puzzle) {
  const color = session.playerColor;
  $("turn-dot").className = `turn-dot ${color}`;
  $("turn-text").textContent = `You play ${capitalize(color)}`;
  $("rating").textContent = puzzle.rating;
  const themes = $("themes");
  themes.replaceChildren(...puzzle.themes.map((t) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = themeLabel(t);
    return chip;
  }));
  $("lichess-link").href = `https://lichess.org/training/${puzzle.id}`;
}

/** Give up: animate the rest of the solution. Counts as a failed puzzle. */
async function showSolution() {
  if (!session || session.finished || !board.interactive) return;
  const token = loadToken;
  setPlayerTurn(false);
  board.clearBadge();
  board.clearAnnotations();
  streak.wrong();
  updateStreak();
  setStatus("Here's the solution…", "reveal");
  const steps = session.revealSolution();
  recordAttempt("revealed");
  for (const { move, fen, check, capture } of steps) {
    await wait(REPLY_DELAY_MS);
    if (token !== loadToken) return;
    await board.animateMove(move, fen, { lastMove: move, check });
    if (token !== loadToken) return;
    sounds.move(capture);
  }
  setStatus("Solution shown – that one counts as a miss.", "reveal");
  setFinished(true);
}

/** Highlight the piece to move now (H key or the Hint button). */
function showHint() {
  if (!session || session.finished || !board.interactive) return;
  const hint = session.requestHint();
  if (!hint) return;
  board.setPosition(session.fen, { lastMove: session.lastMove, check: session.checkSquare(), hint });
  setStatus("Hint: the highlighted piece is the one to move.", "hint");
}

/** Skipping counts as a miss, so it can't be used to protect a streak. */
function skipPuzzle() {
  if (session && !session.finished) recordAttempt("skipped");
  streak.wrong();
  updateStreak();
  loadNextPuzzle();
}

/** Log this puzzle for the stats page (once per puzzle). */
function recordAttempt(outcome) {
  if (recorded) return;
  recorded = true;
  const { id, rating, themes } = session.puzzle;
  attempts.record({
    id, rating, themes, outcome,
    firstTry: session.firstTry,
    wrongMoves: session.mistakes,
    ms: turnStartedAt === null ? 0 : Math.round(performance.now() - turnStartedAt),
    at: Date.now(),
  });
}

/** Only the player's turn allows moving pieces or asking for help. */
function setPlayerTurn(on) {
  board.setInteractive(on);
  $("hint-btn").disabled = !on;
  $("solution-btn").disabled = !on;
}

/** Puzzle over (solved or solution shown): offer Next instead of Skip. */
function setFinished(finished) {
  $("next-btn").hidden = !finished;
  $("help-row").hidden = finished;
  $("skip-btn").hidden = finished;
  $("skip-note").hidden = finished;
  $("lichess-link").hidden = !finished;
  if (finished) $("next-btn").focus();
}

function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.className = `status ${kind}`;
}

function updateStreak() {
  $("streak").textContent = streak.current;
  $("best").textContent = streak.best;
  $("streak").parentElement.classList.toggle("hot", streak.current >= 5);
}

$("next-btn").addEventListener("click", () => loadNextPuzzle());
$("skip-btn").addEventListener("click", skipPuzzle);
$("solution-btn").addEventListener("click", showSolution);
$("hint-btn").addEventListener("click", showHint);

// Mute toggle, remembered between visits.
function updateMuteButton() {
  $("mute-btn").textContent = sounds.muted ? "🔇" : "🔊";
  $("mute-btn").setAttribute("aria-pressed", String(sounds.muted));
  $("mute-btn").setAttribute("aria-label", sounds.muted ? "Unmute sounds" : "Mute sounds");
}
$("mute-btn").addEventListener("click", () => {
  sounds.setMuted(!sounds.muted);
  updateMuteButton();
});

// ---------- keyboard shortcuts ----------
// N or Enter: next puzzle (once finished) · H: hint · S: show solution · Esc: menu

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const screen = document.querySelector(".screen:not([hidden])")?.id;
  if (e.key === "Escape") {
    if (screen && screen !== "menu" && allPuzzles.length) goToMenu();
    return;
  }
  if (screen !== "puzzle" || !session) return;
  // A focused button already handles Enter itself (e.g. Next puzzle).
  const onControl = e.target instanceof Element && e.target.closest("button, a, input");
  const key = e.key.toLowerCase();
  if (key === "n" || (key === "enter" && !onControl)) {
    if (session.finished) {
      e.preventDefault();
      loadNextPuzzle();
    }
  } else if (key === "h") {
    showHint();
  } else if (key === "s") {
    showSolution();
  }
});

// Theme visibility toggle, remembered between visits.
function setThemesVisible(show) {
  $("themes").hidden = !show;
  $("themes-hidden").hidden = show;
  $("themes-toggle").textContent = show ? "Hide" : "Show";
  $("themes-toggle").setAttribute("aria-pressed", String(show));
  try { localStorage.setItem(SHOW_THEMES_KEY, show ? "1" : "0"); } catch { /* ignore */ }
}
$("themes-toggle").addEventListener("click", () => setThemesVisible($("themes").hidden));

function loadThemesPreference() {
  try { return localStorage.getItem(SHOW_THEMES_KEY) === "1"; } catch { return false; }
}

const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

// ---------- start-up ----------

async function init() {
  setThemesVisible(loadThemesPreference());
  updateMuteButton();
  updateStreak();
  buildThemeButtons();
  loadRange();
  try {
    const res = await fetch("data/puzzles.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allPuzzles = await res.json();
  } catch (err) {
    $("menu-status").textContent = `Couldn't load puzzles (${err.message}). Serve the folder over HTTP – see README.`;
    return;
  }
  $("play-btn").disabled = false;
  $("levels-btn").disabled = false;
  $("stats-btn").disabled = false;

  // Deep link to one puzzle, e.g. index.html#puzzle=4VfTC
  const linkedId = new URLSearchParams(location.hash.slice(1)).get("puzzle");
  const linked = allPuzzles.find((p) => p.id === linkedId);
  if (linked) startTraining(allPuzzles, "Play · All puzzles", linked);
  else goToMenu();
}

init();
