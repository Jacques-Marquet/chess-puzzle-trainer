// Wires the screens together: loads the puzzle data, handles the menu and
// level select, and runs the puzzle screen by connecting the Board (what you
// see) to PuzzleSession (the rules of the puzzle) and Streak (the score).

import { Board, wait } from "./board.js";
import { PuzzleSession } from "./puzzle.js";
import { Streak } from "./streak.js";
import { filterPuzzles, PuzzleDeck, THEMES, themeLabel, MIN_RATING, MAX_RATING } from "./filter.js";

const SHOW_THEMES_KEY = "chess-trainer:showThemes";
const OPENING_DELAY_MS = 500;  // pause before the opponent's first move
const REPLY_DELAY_MS = 400;    // pause before the opponent's reply
const WRONG_MOVE_MS = 700;     // how long a wrong move stays on the board
const MIN_GAP = 100;           // smallest allowed rating range

const $ = (id) => document.getElementById(id);

let allPuzzles = [];
let deck = null;
let session = null;
let loadToken = 0; // bumps on every new puzzle so stale async steps stop
const streak = new Streak();

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
  board.setInteractive(false);
  $("menu-status").textContent = `${allPuzzles.length.toLocaleString()} puzzles · Best streak ${streak.best}`;
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
    btn.addEventListener("click", () => {
      const lo = Number(rangeMin.value), hi = Number(rangeMax.value);
      const list = filterPuzzles(allPuzzles, { minRating: lo, maxRating: hi, theme: tag || null });
      startTraining(list, `${label} · ${lo}–${hi}`);
    });
    $("theme-grid").append(btn);
  }
}

// ---------- puzzle screen ----------

function startTraining(puzzles, label, first = null) {
  deck = new PuzzleDeck(puzzles);
  $("mode-label").textContent = label;
  showScreen("puzzle");
  loadNextPuzzle(first ?? deck.next());
}

async function loadNextPuzzle(puzzle = deck.next()) {
  const token = ++loadToken;
  if (!puzzle) return;
  session = new PuzzleSession(puzzle);

  // Show the starting position from the player's side, before the opponent moves.
  board.setInteractive(false);
  board.clearBadge();
  board.clearAnnotations();
  board.setOrientation(session.playerColor);
  board.setPosition(puzzle.fen);
  showPuzzleInfo(puzzle);
  setSolved(false);
  setStatus("Watch the opponent's move…");

  await wait(OPENING_DELAY_MS);
  if (token !== loadToken) return;
  const { move, fen } = session.start();
  await board.animateMove(move, fen, { lastMove: move, check: session.checkSquare() });
  if (token !== loadToken) return;

  setStatus(`Find the best move for ${capitalize(session.playerColor)}.`);
  board.setInteractive(true);
}

async function handlePlayerMove(uci) {
  const token = loadToken;
  board.setInteractive(false);
  const result = session.tryMove(uci);
  const to = uci.slice(2, 4);

  if (result.illegal) {
    board.setPosition(session.fen, { lastMove: session.lastMove, hint: session.hintSquare() });
    board.setInteractive(true);
    return;
  }

  if (!result.correct) {
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
    board.setInteractive(true);
    return;
  }

  streak.correct();
  updateStreak();
  board.setPosition(result.fen, { lastMove: uci, check: result.solved ? session.checkSquare() : null });
  board.showBadge(to, "correct");

  if (result.solved) {
    setStatus("Puzzle solved! 🎉", "solved");
    setSolved(true);
    return;
  }

  setStatus("Correct! Keep going…", "correct");
  await wait(REPLY_DELAY_MS);
  if (token !== loadToken) return;
  const { move, fen } = result.reply;
  await board.animateMove(move, fen, { lastMove: move, check: session.checkSquare() });
  if (token !== loadToken) return;
  board.clearBadge();
  setStatus(`Your move again – find the best continuation.`);
  board.setInteractive(true);
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

function setSolved(solved) {
  $("next-btn").hidden = !solved;
  $("skip-btn").hidden = solved;
  $("lichess-link").hidden = !solved;
  if (solved) $("next-btn").focus();
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
$("skip-btn").addEventListener("click", () => loadNextPuzzle());

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
  updateStreak();
  buildThemeButtons();
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

  // Deep link to one puzzle, e.g. index.html#puzzle=4VfTC
  const linkedId = new URLSearchParams(location.hash.slice(1)).get("puzzle");
  const linked = allPuzzles.find((p) => p.id === linkedId);
  if (linked) startTraining(allPuzzles, "Play · All puzzles", linked);
  else goToMenu();
}

init();
