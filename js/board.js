// A self-contained chessboard UI: draws a position from a FEN string and lets
// the user move pieces by dragging or by clicking. It knows nothing about chess
// rules - it asks its owner which moves are legal (getLegalMoves) and reports
// the chosen move (onMove). That keeps rules in chess.js and logic in puzzle.js.

const FILES = "abcdefgh";
const PROMOTION_PIECES = ["q", "n", "r", "b"];
const ANIMATION_MS = 250;

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

    this.el = document.createElement("div");
    this.el.className = "board";
    this.squaresLayer = layer("squares");
    this.highlightLayer = layer("highlights");
    this.piecesLayer = layer("pieces");
    this.overlayLayer = layer("overlay");
    this.el.append(this.squaresLayer, this.highlightLayer, this.piecesLayer, this.overlayLayer);
    container.append(this.el);

    this.el.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.el.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.el.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.el.addEventListener("pointercancel", () => this.cancelDrag());
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());

    this.drawSquares();
  }

  // ---------- public API ----------

  setOrientation(color) {
    this.orientation = color;
    this.drawSquares();
    this.render();
  }

  /** Show a position. lastMove ("e2e4") and check (a square) are highlighted. */
  setPosition(fen, { lastMove = null, check = null } = {}) {
    this.fen = fen;
    this.lastMove = lastMove;
    this.check = check;
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
    badge.textContent = kind === "correct" ? "✓" : "✗";
    this.placeAt(badge, square);
    this.overlayLayer.append(badge);
    this.badge = badge;
  }

  clearBadge() {
    this.badge?.remove();
    this.badge = null;
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
    if (this.selected) {
      add(this.selected, "selected");
      for (const m of this.legalFromSelected()) {
        add(m.to, this.pieces.has(m.to) ? "capture-hint" : "move-hint");
      }
    }
  }

  // ---------- input: click-to-move and drag-and-drop ----------

  onPointerDown(e) {
    if (!this.interactive || e.button !== 0 || this.promoting) return;
    const square = this.squareFromEvent(e);
    if (!square) return;

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
      this.placeAt(piece, to);
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
