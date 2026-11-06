"""Offline regression tests for Kiwoom personal watchlist collection.

Tests >400 distinct shares and interrupted/resumed chart collection.
No real Kiwoom requests and no public GitHub watchlist publication.
"""
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from export_kiwoom_watchlist import (
    collect_watch_charts, load_watchlist_cache, watchlist_checkpoint_path,
)


def fake_bars():
    result = []
    for i in range(32):
        close = 1000 + (31 - i) * 10
        result.append({
            "date": f"2026{11:02d}{max(1, 6 - i):02d}" if i <= 5 else
            f"2026{10:02d}{max(1, 31 - (i - 6)):02d}",
            "close": close, "high": close + 20, "low": close - 20
        })
    return result


class WatchlistExportTests(unittest.TestCase):
    def test_collects_over_400_and_uses_local_cache(self):
        info = {f"{i:06d}": {"name": f"테스트{i}", "market": "KOSPI"}
                for i in range(1, 406)}
        with tempfile.TemporaryDirectory() as directory:
            path = watchlist_checkpoint_path(date(2026, 11, 6), Path(directory))
            with patch("export_kiwoom_watchlist.daily_bars", return_value=fake_bars()) as request:
                stocks = collect_watch_charts(object(), info, date(2026, 11, 6), path)
                self.assertEqual(request.call_count, 405)
            self.assertEqual(len(stocks), 405)
            self.assertTrue(path.exists())
            with patch("export_kiwoom_watchlist.daily_bars",
                       side_effect=AssertionError("Cached chart must not be refetched")):
                again = collect_watch_charts(object(), info, date(2026, 11, 6), path)
            self.assertEqual(len(again), 405)
            self.assertEqual(len(load_watchlist_cache(path, date(2026, 11, 6))["records"]), 405)

    def test_recovers_after_consecutive_api_errors(self):
        info = {f"{i:06d}": {"name": f"테스트{i}", "market": "KOSDAQ"}
                for i in range(1, 41)}
        with tempfile.TemporaryDirectory() as directory:
            path = watchlist_checkpoint_path(date(2026, 11, 6), Path(directory))
            count = 0
            def flaky(*args, **kwargs):
                nonlocal count
                count += 1
                if count > 25:
                    raise RuntimeError("Temporary Kiwoom API failure")
                return fake_bars()
            with patch("export_kiwoom_watchlist.daily_bars", side_effect=flaky):
                with self.assertRaisesRegex(RuntimeError, "checkpoint saved"):
                    collect_watch_charts(object(), info, date(2026, 11, 6), path)
            self.assertEqual(len(load_watchlist_cache(path, date(2026, 11, 6))["records"]), 25)
            with patch("export_kiwoom_watchlist.daily_bars", return_value=fake_bars()) as request:
                stocks = collect_watch_charts(object(), info, date(2026, 11, 6), path)
            self.assertEqual(len(stocks), 40)
            self.assertEqual(request.call_count, 15)


if __name__ == "__main__":
    unittest.main()
