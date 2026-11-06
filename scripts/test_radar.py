"""Offline validation for theme rankings and 20-day/Fibonacci pullback signals."""
import unittest
from datetime import date, timedelta
from radar import theme_leaders, pullback_state, build_radar


class RadarTests(unittest.TestCase):
    def test_theme_rank_uses_two_members_and_positive_average(self):
        stocks = [
            {"ticker": "000001", "name": "A", "market": "KOSPI", "close": 120,
             "sectors": ["반도체"], "amount_eok": 900, "change_pct": 11},
            {"ticker": "000002", "name": "B", "market": "KOSDAQ", "close": 100,
             "sectors": ["반도체", "로봇"], "amount_eok": 600, "change_pct": 6},
            {"ticker": "000003", "name": "C", "market": "KOSDAQ", "close": 110,
             "sectors": ["로봇"], "amount_eok": 800, "change_pct": 4},
            {"ticker": "000004", "name": "D", "market": "KOSPI", "close": 100,
             "sectors": ["단독테마"], "amount_eok": 1000, "change_pct": 28}
        ]
        leaders = theme_leaders(stocks)
        self.assertEqual([s["theme"] for s in leaders], ["반도체", "로봇"])
        self.assertEqual(leaders[0]["rank"], 1)
        self.assertEqual(len(leaders[0]["picks"]), 2)

    def test_ma20_fibonacci_confluence(self):
        origin = date(2026, 9, 1)
        bars = []
        for i in range(30):
            bars.append({"date": (origin+timedelta(days=i)).strftime("%Y%m%d"),
                         "close": 128, "high": 130, "low": 100})
        event = (origin+timedelta(days=30)).isoformat()
        for i, (close, high, low) in enumerate([
            (145, 150, 130), (138, 145, 135), (132, 138, 130), (130, 134, 128)
        ],30):
            bars.append({"date": (origin+timedelta(days=i)).strftime("%Y%m%d"),
                         "close": close, "high": high, "low": low})
        result = pullback_state(bars, event)
        self.assertEqual(result["status_key"], "confluence")
        self.assertAlmostEqual(result["fib"]["0.382"], 130.9, places=1)
        self.assertLess(abs(result["ma20_gap_pct"]), 3)

    def test_no_fabrication_from_empty_history(self):
        d = "2026-11-06"
        stocks = [
            {"ticker": "000001", "name": "A", "market": "KOSPI", "close": 120,
             "sectors": ["반도체"], "amount_eok": 900, "change_pct": 11},
            {"ticker": "000002", "name": "B", "market": "KOSDAQ", "close": 100,
             "sectors": ["반도체"], "amount_eok": 600, "change_pct": 6},
        ]
        empty = build_radar(d, stocks, {}, lambda ticker: [], record_new=False)
        self.assertEqual(len(empty["events"]), 0)
        self.assertEqual(len(empty["tracked"]), 0)
        active = build_radar(d, stocks, {}, lambda ticker: [], record_new=True)
        self.assertEqual(len(active["events"]), 1)
        self.assertEqual(len(active["tracked"]), 2)
        self.assertEqual(active["tracked"][0]["status_key"], "unknown")
        # The stock must remain in watch history even after it leaves the
        # next day's 500억원 selection universe.
        later = build_radar("2026-11-07", [], active, lambda ticker: [], record_new=False)
        self.assertEqual(len(later["tracked"]), 2)
        self.assertEqual(len(later["events"]), 1)
        self.assertNotIn("close", later["tracked"][0])


if __name__ == "__main__":
    unittest.main()
