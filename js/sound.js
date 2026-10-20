// Short sound effects (Kenney's Impact Sounds, CC0) with a mute switch that is
// remembered between visits. Browser-only: it uses the Audio element.

export const MUTED_KEY = "chess-trainer:muted";
const NAMES = ["move", "capture", "wrong", "solved"];

export class Sounds {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.muted = this.load();
    this.audio = new Map(NAMES.map((name) => {
      const audio = new Audio(`assets/sounds/${name}.ogg`);
      audio.preload = "auto";
      return [name, audio];
    }));
  }

  play(name) {
    if (this.muted) return;
    const audio = this.audio.get(name);
    if (!audio) return;
    audio.currentTime = 0; // restart if it's still playing
    // Browsers refuse to play sound before the first click; that's fine.
    audio.play().catch(() => {});
  }

  /** The sound for a piece landing: a heavier knock for a capture. */
  move(capture) {
    this.play(capture ? "capture" : "move");
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      this.storage?.setItem(MUTED_KEY, muted ? "1" : "0");
    } catch {
      // Not fatal: the setting just won't persist.
    }
  }

  load() {
    try {
      return this.storage?.getItem(MUTED_KEY) === "1";
    } catch {
      return false;
    }
  }
}
