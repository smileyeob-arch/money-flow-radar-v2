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

    def test_one_persistent_1632_error_is_flagged_not_fatal(self):
        info = {"080470": {"name": "조회오류종목", "market": "KOSDAQ"},
                "005930": {"name": "삼성전자", "market": "KOSPI"},
                "000660": {"name": "SK하이닉스", "market": "KOSPI"}}
        calls = []
        def respond(client, code, today):
            calls.append(code)
            if code == "080470":
                raise RuntimeError("ka10081 API error 7: 서비스를 처리하는 중에 오류가 발생했습니다 [1632]")
            return fake_bars()
        with tempfile.TemporaryDirectory() as directory:
            path = watchlist_checkpoint_path(date(2026, 11, 27), Path(directory))
            with patch("export_kiwoom_watchlist.daily_bars", side_effect=respond), \
                 patch("export_kiwoom_watchlist.time.sleep") as sleep:
                stocks = collect_watch_charts(object(), info, date(2026, 11, 27), path)
            self.assertEqual(len(stocks), 3)
            unresolved = [s for s in stocks if s.get("chart_error")]
            self.assertEqual(len(unresolved), 1)
            self.assertEqual(unresolved[0]["ticker"], "080470")
            self.assertEqual(unresolved[0]["status"], "일봉 조회 실패")
            self.assertEqual(unresolved[0]["bars"], [])
            self.assertNotIn("close", unresolved[0])
            self.assertEqual(calls.count("080470"), 3)
            self.assertEqual(sleep.call_count, 2)
            self.assertEqual(len(load_watchlist_cache(path, date(2026, 11, 27))["records"]), 2)
            # A follow-up run does not need to requery already cached shares.
            with patch("export_kiwoom_watchlist.daily_bars", return_value=fake_bars()) as request:
                recovered = collect_watch_charts(object(), info, date(2026, 11, 27), path)
            self.assertEqual(request.call_count, 1)
            self.assertEqual(len(recovered), 3)
            self.assertFalse(any(s.get("chart_error") for s in recovered))

    def test_many_failures_still_abort_without_a_partial_export(self):
        info = {f"{i:06d}": {"name": f"테스트{i}", "market": "KOSDAQ"}
                for i in range(1, 6)}
        with tempfile.TemporaryDirectory() as directory:
            path = watchlist_checkpoint_path(date(2026, 11, 27), Path(directory))
            def fetch(client, code, today):
                if code in {"000001", "000003"}:
                    raise RuntimeError("Permanent data failure")
                return fake_bars()
            with patch("export_kiwoom_watchlist.daily_bars", side_effect=fetch):
                with self.assertRaisesRegex(RuntimeError, "checkpoint preserved"):
                    collect_watch_charts(object(), info, date(2026, 11, 27), path)

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
