// A self-contained chessboard UI: draws a position from a FEN string and lets
// the user move pieces by dragging or by clicking. It knows nothing about chess
// rules - it asks its owner which moves are legal (getLegalMoves) and reports
// the chosen move (onMove). That keeps rules in chess.js and logic in puzzle.js.

const FILES = "abcdefgh";
const PROMOTION_PIECES = ["q", "n", "r", "b"];
const ANIMATION_MS = 250;
const SVG_NS = "http://www.w3.org/2000/svg";

export class Board {
  /**
   * @param {HTMLElement} container
   * @param {object} opts
   * @param {(square: string) => {to: string, promotion?: string}[]} opts.getLegalMoves
   * @param {(uci: string) => void} opts.onMove  called with e.g. "e2e4" or "e7e8q"
   */
  constructor(container, { getLegalMoves, onMove }) {
    this.getLegalMoves = getLegalMoves;
    this.onMove = onMove;
    this.orientation = "white";
    this.interactive = false;
    this.pieces = new Map(); // square -> piece <div>
    this.selected = null;    // square the user picked up / clicked
    this.drag = null;        // state of an in-progress pointer drag
    this.arrows = new Map(); // "e2e4" -> {from, to}: right-click arrows
    this.marks = new Set();  // squares marked with a right-click
    this.arrowDraw = null;   // right-button drag in progress: {from, to}

    this.el = document.createElement("div");
    this.el.className = "board";
    this.squaresLayer = layer("squares");
    this.highlightLayer = layer("highlights");
    this.piecesLayer = layer("pieces");
    this.arrowLayer = document.createElementNS(SVG_NS, "svg");
    this.arrowLayer.setAttribute("class", "layer arrows");
    this.arrowLayer.setAttribute("viewBox", "0 0 8 8"); // 1 unit = 1 square
    this.overlayLayer = layer("overlay");
    this.el.append(this.squaresLayer, this.highlightLayer, this.piecesLayer, this.arrowLayer, this.overlayLayer);
    container.append(this.el);

    this.el.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.el.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.el.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.el.addEventListener("pointercancel", () => {
      this.cancelDrag();
      this.arrowDraw = null;
      this.drawArrows();
    });
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());

    this.drawSquares();
  }

  // ---------- public API ----------

  setOrientation(color) {
    this.orientation = color;
    this.drawSquares();
    this.render();
  }

  /**
   * Show a position. lastMove ("e2e4"), check (the checked king's square) and
   * hint (the square of the piece that should move) are highlighted.
   */
  setPosition(fen, { lastMove = null, check = null, hint = null } = {}) {
    this.fen = fen;
    this.lastMove = lastMove;
    this.check = check;
    this.hint = hint;
    this.deselect();
    this.render();
  }

  setInteractive(on) {
    this.interactive = on;
    if (!on) {
      this.deselect();
      this.cancelDrag();
    }
  }

  /** Slide the piece on `from` to `to`, then show the resulting position. */
  async animateMove(uci, fenAfter, opts) {
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const piece = this.pieces.get(from);
    if (piece) {
      this.pieces.get(to)?.remove(); // captured piece disappears
      piece.style.transition = `transform ${ANIMATION_MS}ms ease`;
      this.placeAt(piece, to);
      await wait(ANIMATION_MS);
    }
    this.setPosition(fenAfter, opts);
  }

  /** Show a green tick or red cross badge on a square. */
  showBadge(square, kind) {
    this.clearBadge();
    const badge = document.createElement("div");
    badge.className = `badge badge-${kind}`;
    const icon = document.createElement("span");
    icon.textContent = kind === "correct" ? "✓" : "✗";
    badge.append(icon);
    this.placeAt(badge, square);
    this.overlayLayer.append(badge);
    this.badge = badge;
  }

  clearBadge() {
    this.badge?.remove();
    this.badge = null;
  }

  /** Replace the drawn arrows, e.g. [["c7", "e8"], ["c7", "a8"]]. */
  setArrows(list) {
    this.arrows = new Map(list.map(([from, to]) => [from + to, { from, to }]));
    this.drawArrows();
  }

  /** Remove all right-click arrows and square marks. */
  clearAnnotations() {
    if (this.arrows.size === 0 && this.marks.size === 0) return;
    this.arrows.clear();
    this.marks.clear();
    this.drawArrows();
    this.drawHighlights();
  }

  // ---------- drawing ----------

  drawSquares() {
    this.squaresLayer.replaceChildren();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = this.squareAt(col, row);
        const div = document.createElement("div");
        const light = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 1;
        div.className = `square ${light ? "light" : "dark"}`;
        // Coordinates along the bottom and left edges, like a real board.
        if (row === 7) div.append(label("file", sq[0]));
        if (col === 0) div.append(label("rank", sq[1]));
        this.squaresLayer.append(div);
      }
    }
  }

  render() {
    this.piecesLayer.replaceChildren();
    this.pieces.clear();
    if (!this.fen) return;
    for (const [square, piece] of parsePlacement(this.fen)) {
      const div = document.createElement("div");
      const color = piece === piece.toUpperCase() ? "w" : "b";
      div.className = "piece";
      div.style.backgroundImage = `url(assets/pieces/${color}${piece.toUpperCase()}.svg)`;
      this.placeAt(div, square);
      this.piecesLayer.append(div);
      this.pieces.set(square, div);
    }
    this.drawHighlights();
    this.drawArrows();
  }

  drawHighlights() {
    this.highlightLayer.replaceChildren();
    const add = (square, cls) => {
      const div = document.createElement("div");
      div.className = `hl ${cls}`;
      this.placeAt(div, square);
      this.highlightLayer.append(div);
    };
    if (this.lastMove) {
      add(this.lastMove.slice(0, 2), "last-move");
      add(this.lastMove.slice(2, 4), "last-move");
    }
    if (this.check) add(this.check, "check");
    for (const square of this.marks) add(square, "mark");
    if (this.hint) add(this.hint, "hint");
    if (this.selected) {
      add(this.selected, "selected");
      for (const m of this.legalFromSelected()) {
        add(m.to, this.pieces.has(m.to) ? "capture-hint" : "move-hint");
      }
    }
  }

  drawArrows() {
    this.arrowLayer.replaceChildren();
    const all = [...this.arrows.values()];
    const d = this.arrowDraw;
    if (d && d.to !== d.from && !this.arrows.has(d.from + d.to)) all.push(d);
    for (const { from, to } of all) this.arrowLayer.append(this.arrowShape(from, to));
  }

  /**
   * An SVG arrow between two squares, drawn in board units (1 = one square).
   * Knight moves get an L-shaped arrow, longer leg first, like chess.com.
   */
  arrowShape(from, to) {
    const a = this.coords(from), b = this.coords(to);
    const start = { x: a.col + 0.5, y: a.row + 0.5 };
    const end = { x: b.col + 0.5, y: b.row + 0.5 };
    const dx = Math.abs(b.col - a.col), dy = Math.abs(b.row - a.row);
    const points = [start];
    if (dx * dy === 2) {
      points.push(dy > dx ? { x: start.x, y: end.y } : { x: end.x, y: start.y });
    }
    // Stop the line where the arrowhead begins so the two don't overlap.
    const prev = points[points.length - 1];
    const len = Math.hypot(end.x - prev.x, end.y - prev.y);
    const ux = (end.x - prev.x) / len, uy = (end.y - prev.y) / len;
    const HEAD_LEN = 0.42, HEAD_HALF_WIDTH = 0.27;
    const base = { x: end.x - ux * HEAD_LEN, y: end.y - uy * HEAD_LEN };
    points.push(base);

    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "arrow");
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", points.map((p) => `${p.x},${p.y}`).join(" "));
    const head = document.createElementNS(SVG_NS, "polygon");
    const nx = -uy * HEAD_HALF_WIDTH, ny = ux * HEAD_HALF_WIDTH;
    head.setAttribute("points",
      `${end.x},${end.y} ${base.x + nx},${base.y + ny} ${base.x - nx},${base.y - ny}`);
    g.append(line, head);
    return g;
  }

  // ---------- input: click-to-move, drag-and-drop, right-click arrows ----------

  onPointerDown(e) {
    if (e.button === 2) {
      // Right button: start drawing an arrow (works even between moves).
      const square = this.squareFromEvent(e);
      if (!square || this.drag) return;
      this.arrowDraw = { from: square, to: square };
      this.el.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || this.promoting) return;
    const square = this.squareFromEvent(e);
    if (!square) return;
    // A left click on a square you can't move from clears the annotations.
    if (!this.selected && this.getLegalMoves(square).length === 0) this.clearAnnotations();
    if (!this.interactive) return;

    // Second click of click-to-move: a legal target of the selected piece.
    if (this.selected && this.isLegalTarget(square)) {
      this.tryMove(this.selected, square);
      return;
    }

    if (this.getLegalMoves(square).length === 0) {
      this.deselect();
      return;
    }

    const wasSelected = this.selected === square;
    this.select(square);
    this.drag = {
      square, wasSelected, moved: false,
      startX: e.clientX, startY: e.clientY,
      piece: this.pieces.get(square),
    };
    this.el.setPointerCapture(e.pointerId);
  }

  onPointerMove(e) {
    if (this.arrowDraw) {
      const square = this.squareFromEvent(e);
      if (square && square !== this.arrowDraw.to) {
        this.arrowDraw.to = square;
        this.drawArrows();
      }
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    d.moved = true;
    // The piece follows the pointer, centred under it.
    const rect = this.el.getBoundingClientRect();
    const size = rect.width / 8;
    d.piece.classList.add("dragging");
    d.piece.style.transition = "none";
    d.piece.style.transform =
      `translate(${e.clientX - rect.left - size / 2}px, ${e.clientY - rect.top - size / 2}px)`;
  }

  onPointerUp(e) {
    if (this.arrowDraw && e.button === 2) {
      const { from } = this.arrowDraw;
      const to = this.squareFromEvent(e);
      this.arrowDraw = null;
      if (to && to !== from) toggle(this.arrows, from + to, { from, to });
      else if (to) toggle(this.marks, from);
      this.drawArrows();
      this.drawHighlights();
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.moved) {
      const target = this.squareFromEvent(e);
      if (target && target !== d.square && this.isLegalTarget(target)) {
        this.tryMove(d.square, target);
      } else {
        this.snapBack(d);
      }
    } else if (d.wasSelected) {
      this.deselect(); // clicking a selected piece again puts it down
    }
  }

  cancelDrag() {
    if (this.drag) this.snapBack(this.drag);
    this.drag = null;
  }

  snapBack(d) {
    d.piece.classList.remove("dragging");
    d.piece.style.transition = "";
    this.placeAt(d.piece, d.square);
  }

  async tryMove(from, to) {
    const options = this.legalFromSelected().filter((m) => m.to === to);
    let promotion = "";
    if (options.some((m) => m.promotion)) {
      const piece = this.pieces.get(from);
      piece.classList.remove("dragging");
      this.placeAt(piece, to);
      this.deselect();
      promotion = await this.choosePromotion(to);
      if (!promotion) {
        // Cancelled: put the pawn back.
        this.render();
        return;
      }
    }
    // Show the piece on its new square straight away (the owner re-renders).
    const piece = this.pieces.get(from);
    if (piece) {
      piece.classList.remove("dragging");
      piece.style.transition = "none";
      this.pieces.get(to)?.remove();
      this.placeAt(piece, to);
    }
    this.deselect();
    this.clearAnnotations(); // arrows are planning aids: gone once a move is made
    this.onMove(from + to + promotion);
  }

  /** Overlay four pieces in the promotion file; resolves with "q"/"n"/"r"/"b" or null. */
  choosePromotion(square) {
    this.promoting = true;
    const color = square[1] === "8" ? "w" : "b";
    const picker = document.createElement("div");
    picker.className = "promotion";
    const { col, row } = this.coords(square);
    const step = row === 0 ? 1 : -1; // grow away from the edge
    return new Promise((resolve) => {
      const done = (choice) => {
        picker.remove();
        this.promoting = false;
        resolve(choice);
      };
      PROMOTION_PIECES.forEach((p, i) => {
        const btn = document.createElement("button");
        btn.className = "promotion-choice";
        btn.style.backgroundImage = `url(assets/pieces/${color}${p.toUpperCase()}.svg)`;
        btn.style.transform = `translate(${col * 100}%, ${(row + i * step) * 100}%)`;
        btn.setAttribute("aria-label", { q: "Queen", n: "Knight", r: "Rook", b: "Bishop" }[p]);
        btn.addEventListener("pointerdown", (e) => { e.stopPropagation(); done(p); });
        picker.append(btn);
      });
      picker.addEventListener("pointerdown", (e) => { e.stopPropagation(); done(null); });
      this.overlayLayer.append(picker);
    });
  }

  // ---------- helpers ----------

  select(square) {
    this.selected = square;
    this.drawHighlights();
  }

  deselect() {
    if (this.selected === null) return;
    this.selected = null;
    this.drawHighlights();
  }

  legalFromSelected() {
    return this.selected ? this.getLegalMoves(this.selected) : [];
  }

  isLegalTarget(square) {
    return this.legalFromSelected().some((m) => m.to === square);
  }

  /** Board column/row (0-7, top-left origin) of a square, given orientation. */
  coords(square) {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1]);
    return this.orientation === "white"
      ? { col: file, row: 8 - rank }
      : { col: 7 - file, row: rank - 1 };
  }

  squareAt(col, row) {
    return this.orientation === "white"
      ? FILES[col] + (8 - row)
      : FILES[7 - col] + (row + 1);
  }

  squareFromEvent(e) {
    const rect = this.el.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return this.squareAt(col, row);
  }

  /** Position an element (sized 1/8 of the board) on a square. */
  placeAt(el, square) {
    const { col, row } = this.coords(square);
    el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }
}

/** Turn the piece-placement part of a FEN into [square, pieceLetter] pairs. */
export function parsePlacement(fen) {
  const result = [];
  fen.split(" ")[0].split("/").forEach((rankText, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of rankText) {
      if (/\d/.test(ch)) file += Number(ch);
      else result.push([FILES[file++] + rank, ch]);
    }
  });
  return result;
}

/** Add `key` to a Map/Set if absent, remove it if present. */
function toggle(collection, key, value) {
  if (collection.has(key)) collection.delete(key);
  else if (collection instanceof Map) collection.set(key, value);
  else collection.add(key);
}

function layer(name) {
  const div = document.createElement("div");
  div.className = `layer ${name}`;
  return div;
}

function label(kind, text) {
  const span = document.createElement("span");
  span.className = `coord coord-${kind}`;
  span.textContent = text;
  return span;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
