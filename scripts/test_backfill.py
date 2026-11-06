"""Offline tests for 3-month historical reconstruction (no Kiwoom auth)."""
import unittest
import tempfile
from unittest.mock import patch
from backfill import _checkpoint_path
from datetime import date, timedelta
from radar_backfill_core import historical_snapshots, merge_events, tracked_from_events


def fixture():
    universe, charts, themes = {}, {}, {}
    begin = date(2026, 8, 1)
    for i in range(100):
        code = f"{i+1:06d}"
        universe[code] = {"name": f"테스트{i+1}", "market": "KOSPI"}
        theme = "그룹A" if i < 60 else "그룹B"
        themes[code] = [{"name": theme, "code": theme}]
        close = 1000.0 + i
        bars = []
        for day in range(36):
            close *= (1.019 if i < 60 else 1.009)
            # Later the high-turnover threshold excludes a subset, but these
            # shares remain in the historical per-day coverage count.
            amount = 60000 if (i % 5 != 0) else 10000
            bars.append({
                "date": (begin + timedelta(days=day)).strftime("%Y%m%d"),
                "close": close, "high": close * 1.02, "low": close * .98,
                "amount": amount
            })
        charts[code] = bars
    return universe, charts, themes


class HistoricalThemeTests(unittest.TestCase):
    def test_checkpoint_path_with_date_object(self):
        # Regression for date.replace("-", "") raising TypeError.
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict("os.environ", {"LOCALAPPDATA": directory}):
                result = _checkpoint_path(date(2026, 11, 6))
                self.assertEqual(result.name, "stock-charts-20261106-v1.json.gz")
                self.assertTrue(result.parent.is_dir())

    def test_backfill_is_bounded_and_liquidity_filtered(self):
        universe, charts, themes = fixture()
        start = date(2026, 8, 6)
        end = date(2026, 9, 5)
        events, coverage = historical_snapshots(
            universe, charts, themes, start, end, min_coverage=.65
        )
        self.assertGreaterEqual(len(coverage), 20)
        self.assertTrue(events)
        self.assertTrue(all(start.isoformat() <= e["date"] <= end.isoformat() for e in events))
        self.assertTrue(all(e["backfill"] and e["proxy"] for e in events))
        self.assertEqual({e["theme"] for e in events}, {"그룹A", "그룹B"})
        self.assertEqual(events[0]["rank"], 1)
        self.assertEqual(events[0]["theme"], "그룹A")
        self.assertTrue(all(x["liquid_stocks"] == 80 for x in coverage))
        self.assertTrue(all(p["event_amount_eok"] >= 500
                            for e in events for p in e["picks"]))

    def test_preserve_actual_day_and_first_event_for_stock(self):
        inferred = [
            {"date": "2026-11-04", "rank": 1, "theme": "반도체", "backfill": True,
             "picks": [{"ticker": "000660", "name": "테스트", "market": "KOSPI"}]},
            {"date": "2026-11-06", "rank": 1, "theme": "가상", "backfill": True,
             "picks": [{"ticker": "000660", "name": "테스트", "market": "KOSPI"}]}
        ]
        live = [
            {"date": "2026-11-06", "rank": 1, "theme": "실측기록", "proxy": True,
             "picks": [{"ticker": "000660", "name": "테스트", "market": "KOSPI"}]}
        ]
        merged, added = merge_events(live, inferred, "2026-11-06")
        self.assertEqual(added, 1)
        self.assertEqual([x["theme"] for x in merged], ["반도체", "실측기록"])
        watched = tracked_from_events(merged)
        self.assertEqual(len(watched), 1)
        self.assertEqual(watched[0]["first_seen"], "2026-11-04")
        self.assertEqual(len(watched[0]["signals"]), 2)
        self.assertTrue(watched[0]["signals"][0]["reconstructed"])


if __name__ == "__main__":
    unittest.main()
