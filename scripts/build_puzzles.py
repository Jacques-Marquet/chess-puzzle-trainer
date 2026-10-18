"""Build data/puzzles.json from the Lichess open puzzle database.

Usage:
    python scripts/build_puzzles.py                # download (if needed) and build
    python scripts/build_puzzles.py --count 3000   # smaller set
    python scripts/build_puzzles.py --input some.csv

Pipeline:
    1. Download lichess_db_puzzle.csv.zst into raw/ (skipped if already there).
    2. Stream-decompress it and read the CSV one row at a time, so the
       multi-gigabyte CSV never has to exist on disk or in memory.
    3. Drop low-quality puzzles (uncertain rating, unpopular, rarely played).
    4. Put each remaining puzzle into a (rating bucket, theme) "cell" and keep a
       random sample of each cell using reservoir sampling with a fixed seed,
       so the output is spread evenly and is identical on every run.
    5. Write a compact JSON file that the web app loads.
"""

import argparse
import csv
import io
import json
import random
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "raw" / "lichess_db_puzzle.csv.zst"
DEFAULT_OUTPUT = ROOT / "data" / "puzzles.json"
DOWNLOAD_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"

# The themes offered in the app, ordered rarest first. A puzzle tagged with
# several of these is assigned to the rarest one, so rare themes are not
# crowded out by common ones like "endgame" or "fork".
TARGET_THEMES = [
    "skewer",
    "backRankMate",
    "discoveredAttack",
    "mateIn1",
    "pin",
    "mateIn2",
    "sacrifice",
    "fork",
    "endgame",
]

# Quality thresholds.
MAX_RATING_DEVIATION = 90  # rating is well established
MIN_POPULARITY = 80        # players liked it (scale is -100..100)
MIN_PLAYS = 500            # enough attempts for the rating to be meaningful


def download(url, dest):
    """Download url to dest, printing progress. Writes to a temp file first."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"Downloading {url} ...")
    with urllib.request.urlopen(url) as resp, open(tmp, "wb") as out:
        total = int(resp.headers.get("Content-Length", 0))
        done = 0
        while chunk := resp.read(1 << 20):
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {done / total:6.1%}", end="", flush=True)
    print()
    tmp.replace(dest)


def open_rows(path):
    """Yield CSV rows as dicts from a .csv or .csv.zst file, streaming."""
    path = Path(path)
    if path.suffix == ".zst":
        import zstandard  # only needed for the real database

        raw = open(path, "rb")
        stream = zstandard.ZstdDecompressor().stream_reader(raw)
        text = io.TextIOWrapper(stream, encoding="utf-8", newline="")
    else:
        text = open(path, encoding="utf-8", newline="")
    with text:
        yield from csv.DictReader(text)


def passes_quality(row):
    return (
        int(row["RatingDeviation"]) < MAX_RATING_DEVIATION
        and int(row["Popularity"]) >= MIN_POPULARITY
        and int(row["NbPlays"]) >= MIN_PLAYS
    )


def assign_theme(themes):
    """Return the rarest target theme in `themes`, or None if it has none."""
    for theme in TARGET_THEMES:
        if theme in themes:
            return theme
    return None


def rating_bucket(rating, min_rating, max_rating, step):
    """Index of the rating bucket, or None if outside [min_rating, max_rating]."""
    if rating < min_rating or rating > max_rating:
        return None
    n_buckets = -(-(max_rating - min_rating) // step)  # ceiling division
    return min((rating - min_rating) // step, n_buckets - 1)


def to_record(row):
    return {
        "id": row["PuzzleId"],
        "fen": row["FEN"],
        "moves": row["Moves"].split(),
        "rating": int(row["Rating"]),
        "themes": row["Themes"].split(),
    }


def sample_puzzles(rows, count, min_rating, max_rating, seed, step=200):
    """Pick about `count` puzzles spread evenly over rating buckets and themes.

    Returns (puzzles, coverage) where coverage maps (bucket, theme) -> number
    of puzzles taken from that cell.
    """
    rng = random.Random(seed)
    n_buckets = -(-(max_rating - min_rating) // step)
    cells = [(b, t) for b in range(n_buckets) for t in TARGET_THEMES]
    quota = count // len(cells)
    # Keep twice the quota per cell so cells with spare puzzles can top up
    # the cells that come up short.
    capacity = quota * 2

    reservoirs = {cell: [] for cell in cells}
    seen = {cell: 0 for cell in cells}

    for row in rows:
        if not passes_quality(row):
            continue
        bucket = rating_bucket(int(row["Rating"]), min_rating, max_rating, step)
        theme = assign_theme(row["Themes"].split())
        if bucket is None or theme is None:
            continue
        cell = (bucket, theme)
        seen[cell] += 1
        # Reservoir sampling: every row seen so far has an equal chance of
        # being in the reservoir, without knowing the total in advance.
        res = reservoirs[cell]
        if len(res) < capacity:
            res.append(to_record(row))
        else:
            j = rng.randrange(seen[cell])
            if j < capacity:
                res[j] = to_record(row)

    # First pass: up to `quota` from every cell.
    for res in reservoirs.values():
        rng.shuffle(res)
    taken = {cell: min(quota, len(reservoirs[cell])) for cell in cells}

    # Second pass: hand leftover slots, one at a time, to cells with spares.
    remaining = count - sum(taken.values())
    while remaining > 0:
        spare = [c for c in cells if taken[c] < len(reservoirs[c])]
        if not spare:
            break
        for cell in spare:
            if remaining == 0:
                break
            taken[cell] += 1
            remaining -= 1

    puzzles = [p for cell in cells for p in reservoirs[cell][: taken[cell]]]
    puzzles.sort(key=lambda p: (p["rating"], p["id"]))
    return puzzles, taken


def print_coverage(coverage, min_rating, step):
    buckets = sorted({b for b, _ in coverage})
    header = "rating     " + " ".join(f"{t[:8]:>8}" for t in TARGET_THEMES)
    print(header)
    for b in buckets:
        lo = min_rating + b * step
        cols = " ".join(f"{coverage[(b, t)]:>8}" for t in TARGET_THEMES)
        print(f"{lo:>4}-{lo + step:<5} {cols}")
    print(f"total: {sum(coverage.values())}")


def write_json(puzzles, path):
    """One puzzle per line: compact, but still readable in git diffs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(p, separators=(",", ":")) for p in puzzles]
    path.write_text("[\n" + ",\n".join(lines) + "\n]\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--count", type=int, default=5000)
    parser.add_argument("--min-rating", type=int, default=600)
    parser.add_argument("--max-rating", type=int, default=2400)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)

    if not args.input.exists():
        if args.input != DEFAULT_INPUT:
            sys.exit(f"Input file not found: {args.input}")
        download(DOWNLOAD_URL, args.input)

    print(f"Reading {args.input} ...")
    puzzles, coverage = sample_puzzles(
        open_rows(args.input), args.count, args.min_rating, args.max_rating, args.seed
    )
    print_coverage(coverage, args.min_rating, 200)
    write_json(puzzles, args.output)
    print(f"Wrote {len(puzzles)} puzzles to {args.output}")


if __name__ == "__main__":
    main()
