"""Tests for build_puzzles.py. Run with: python -m unittest discover scripts"""

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_puzzles as bp  # noqa: E402

FIELDS = ["PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation",
          "Popularity", "NbPlays", "Themes", "GameUrl", "OpeningTags"]
FEN = "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24"


def make_row(pid, rating, themes, rd=75, popularity=95, plays=1000):
    return {
        "PuzzleId": pid, "FEN": FEN, "Moves": "f2g3 e6e7 b2b1 b3c1",
        "Rating": str(rating), "RatingDeviation": str(rd),
        "Popularity": str(popularity), "NbPlays": str(plays),
        "Themes": themes, "GameUrl": "", "OpeningTags": "",
    }


def synthetic_rows(per_cell=20):
    """per_cell puzzles for every (rating bucket, theme) cell in 600-2400."""
    rows = []
    for rating in range(600, 2400, 200):
        for theme in bp.TARGET_THEMES:
            for i in range(per_cell):
                rows.append(make_row(f"{theme}{rating}_{i}", rating + i, f"{theme} short"))
    return rows


class FilterTests(unittest.TestCase):
    def test_quality_filter(self):
        self.assertTrue(bp.passes_quality(make_row("a", 1500, "fork")))
        self.assertFalse(bp.passes_quality(make_row("a", 1500, "fork", rd=120)))
        self.assertFalse(bp.passes_quality(make_row("a", 1500, "fork", popularity=50)))
        self.assertFalse(bp.passes_quality(make_row("a", 1500, "fork", plays=10)))

    def test_assign_theme_prefers_rarest(self):
        self.assertEqual(bp.assign_theme(["endgame", "fork", "skewer"]), "skewer")
        self.assertEqual(bp.assign_theme(["middlegame", "advantage"]), None)

    def test_rating_bucket(self):
        self.assertEqual(bp.rating_bucket(600, 600, 2400, 200), 0)
        self.assertEqual(bp.rating_bucket(799, 600, 2400, 200), 0)
        self.assertEqual(bp.rating_bucket(800, 600, 2400, 200), 1)
        self.assertEqual(bp.rating_bucket(2400, 600, 2400, 200), 8)  # top edge included
        self.assertIsNone(bp.rating_bucket(599, 600, 2400, 200))
        self.assertIsNone(bp.rating_bucket(2401, 600, 2400, 200))


class SamplingTests(unittest.TestCase):
    def test_spread_and_range(self):
        rows = synthetic_rows() + [
            make_row("tooEasy", 400, "fork"),
            make_row("tooHard", 2900, "fork"),
            make_row("noTheme", 1500, "middlegame"),
            make_row("bad", 1500, "fork", popularity=-20),
        ]
        puzzles, coverage = bp.sample_puzzles(rows, 810, 600, 2400, seed=1)
        self.assertEqual(len(puzzles), 810)
        self.assertTrue(all(count == 10 for count in coverage.values()))  # 81 cells x 10
        ids = {p["id"] for p in puzzles}
        self.assertEqual(len(ids), 810)  # no duplicates
        self.assertFalse(ids & {"tooEasy", "tooHard", "noTheme", "bad"})
        self.assertTrue(all(600 <= p["rating"] <= 2400 for p in puzzles))

    def test_short_cells_are_topped_up_by_others(self):
        rows = [r for r in synthetic_rows() if not r["Themes"].startswith("skewer")]
        puzzles, coverage = bp.sample_puzzles(rows, 810, 600, 2400, seed=1)
        self.assertEqual(len(puzzles), 810)
        self.assertTrue(all(coverage[(b, "skewer")] == 0 for b in range(9)))

    def test_deterministic_with_seed(self):
        rows = synthetic_rows()
        a, _ = bp.sample_puzzles(rows, 400, 600, 2400, seed=7)
        b, _ = bp.sample_puzzles(rows, 400, 600, 2400, seed=7)
        c, _ = bp.sample_puzzles(rows, 400, 600, 2400, seed=8)
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_record_shape(self):
        puzzles, _ = bp.sample_puzzles(synthetic_rows(), 81, 600, 2400, seed=1)
        p = puzzles[0]
        self.assertEqual(set(p), {"id", "fen", "moves", "rating", "themes"})
        self.assertEqual(p["moves"], ["f2g3", "e6e7", "b2b1", "b3c1"])
        self.assertIsInstance(p["rating"], int)
        self.assertIn("short", p["themes"])


class EndToEndTest(unittest.TestCase):
    def test_main_reads_csv_and_writes_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp) / "in.csv", Path(tmp) / "out.json"
            with open(src, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, FIELDS)
                writer.writeheader()
                writer.writerows(synthetic_rows(per_cell=5))
            bp.main(["--input", str(src), "--output", str(out), "--count", "162"])
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(len(data), 162)


if __name__ == "__main__":
    unittest.main()
