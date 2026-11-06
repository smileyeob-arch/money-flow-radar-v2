"""One-time approximate 92-day Infostock theme backfill on an IP-registered PC.

Uses *historical individual-stock OHLCV/turnover* from Kiwoom ka10081, and
*CURRENT* Infostock theme membership from ka10106/ka10107. This is NOT the
historical official Infostock theme performance ranking. No orders are sent.
Caches confirmed chart responses locally so interrupted jobs can resume.
"""
import gzip
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from collect import (
    Kiwoom, eligible_individual_stocks, load_infostock_themes,
    daily_bars, KST, ROOT,
)
from radar import build_radar, WINDOW_DAYS
from radar_backfill_core import historical_snapshots, merge_events, tracked_from_events


LATEST_FILE = ROOT / "data" / "latest.json"
HISTORY_FILE = ROOT / "data" / "radar-history.json"
CACHE_VERSION = 1
CHECKPOINT_EVERY = 25
MIN_CHART_SUCCESS = 0.85  # Abort rather than present highly incomplete historical ranks.


def _load_json(path):
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Invalid existing JSON file: {path.name}; will not overwrite") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"Invalid JSON object in {path.name}")
    return data


def _checkpoint_path(snapshot):
    app_data = os.environ.get("LOCALAPPDATA")
    base = (Path(app_data) / "MoneyFlowRadar" if app_data
            else Path.home() / ".MoneyFlowRadar")
    directory = base / "historical-cache"
    directory.mkdir(parents=True, exist_ok=True)
    # snapshot is a datetime.date, not a string: date.replace("-", "") raises TypeError.
    date_token = snapshot.strftime("%Y%m%d")
    return directory / f"stock-charts-{date_token}-v1.json.gz"


def _load_checkpoint(path, asof):
    if not path.exists():
        return {"version": CACHE_VERSION, "asof": asof, "bars": {}}
    try:
        with gzip.open(path, "rt", encoding="utf-8") as reader:
            data = json.load(reader)
    except (OSError, ValueError, EOFError) as exc:
        raise RuntimeError("Local chart cache is unreadable; fix it before continuing") from exc
    if not isinstance(data, dict) or data.get("version") != CACHE_VERSION or data.get("asof") != asof:
        raise RuntimeError("Local chart cache version/date mismatch; refusing to mix sessions")
    if not isinstance(data.get("bars"), dict):
        raise RuntimeError("Local chart cache lacks stock bars")
    return data


def _save_checkpoint(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(temp, "wt", encoding="utf-8", compresslevel=5) as writer:
        json.dump(data, writer, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp, path)


def _verify_input_date(latest):
    stamp = latest.get("date")
    if not isinstance(stamp, str) or len(stamp) != 10:
        raise RuntimeError("Run normal local EOD collection first to create latest.json")
    asof = datetime.strptime(stamp, "%Y-%m-%d").date()
    age = (datetime.now(KST).date() - asof).days
    if age < 0 or age > 5:
        raise RuntimeError(f"Latest EOD snapshot dated {stamp} is not current. Update it first.")
    if not isinstance(latest.get("stocks"), list) or not latest["stocks"]:
        raise RuntimeError("latest.json contains no confirmed 500억원+ ordinary stocks")
    return asof


def _download_chart_history(client, universe, asof, cache_path):
    checkpoint = _load_checkpoint(cache_path, asof.isoformat())
    stored = checkpoint["bars"]
    codes = sorted(universe)
    total = len(codes)
    completed = sum(code in stored for code in codes)
    print(f"Historical daily bars: {completed}/{total} locally cached; resume enabled", flush=True)
    consecutive_errors = 0
    error_count = 0
    for ix, code in enumerate(codes, 1):
        if code in stored:
            continue
        try:
            bars = daily_bars(client, code, asof)
            # Empty charts are recorded, but short histories still may be valid
            # for recently listed stocks. Coverage is checked across sessions.
            stored[code] = bars
            consecutive_errors = 0
        except Exception as exc:
            error_count += 1
            consecutive_errors += 1
            if error_count <= 5:
                print(f"Historical chart query failed {code}: {type(exc).__name__}", flush=True)
            if consecutive_errors >= 10:
                _save_checkpoint(cache_path, checkpoint)
                raise RuntimeError("Ten consecutive chart API errors; checkpoint saved; check connection/API")
        if ix % CHECKPOINT_EVERY == 0:
            _save_checkpoint(cache_path, checkpoint)
            success = sum(bool(stored.get(x)) for x in codes)
            print(f"Historical chart progress {ix}/{total}, cached={len(stored)}, valid={success}, failures={error_count}", flush=True)
    _save_checkpoint(cache_path, checkpoint)
    ok = sum(bool(stored.get(code)) for code in codes)
    print(f"Historical chart data ready: {ok}/{total} valid, {error_count} failed calls", flush=True)
    if ok < total * MIN_CHART_SUCCESS:
        raise RuntimeError(f"Historical chart coverage too low ({ok}/{total}); no published update")
    return stored


def main():
    latest = _load_json(LATEST_FILE)
    asof = _verify_input_date(latest)
    start = asof - timedelta(days=WINDOW_DAYS)
    previous = _load_json(HISTORY_FILE)
    client = Kiwoom()
    universe = eligible_individual_stocks(client)

    # First collect all surviving ordinary stocks, NOT only today's high-volume
    # 500억원+ shortlist. Otherwise old leaders that cooled off disappear.
    cache_path = _checkpoint_path(asof)
    print(f"Backfilling {start} through {asof} using historical turnover (current listed universe)", flush=True)
    chart_map = _download_chart_history(client, universe, asof, cache_path)

    # Membership is CURRENT and introduces unavoidable historical classification
    # bias. It must be labelled an approximate reconstruction on the UI.
    selected = [{"ticker": code} for code in universe]
    theme_map, total_themes = load_infostock_themes(client, selected)
    print(f"Current Infostock memberships collected: {total_themes} themes", flush=True)
    inferred, coverage = historical_snapshots(
        universe, chart_map, theme_map, start, asof, min_coverage=0.65
    )
    if len(coverage) < 20:
        raise RuntimeError("Historical session coverage insufficient; refusing publication")

    combined, new_events = merge_events(previous.get("events") or [], inferred, asof.isoformat())
    tracked = tracked_from_events(combined)
    # Safeguard against accidentally overwriting a previously populated journal.
    if not tracked or not combined:
        raise RuntimeError("No backfilled candidates; original journal preserved")

    def cached_quote(code):
        if code in chart_map:
            return chart_map[code]
        # A previously tracked share may have left the current listed universe.
        # It is left unpriced rather than guessed.
        return []

    base = {"events": combined, "tracked": tracked}
    report = build_radar(asof.isoformat(), latest["stocks"], base, cached_quote, record_new=False)
    report["backfilled"] = True
    report["ranking_method"] = (
        "과거 개별주 일봉 거래대금 500억원 이상 필터와 당시 등락률을 재계산하고 "
        "현재 인포스탁 테마 구성으로 추정한 테마 상승 순위(공식 과거 순위 아님)"
    )
    report["backfill_meta"] = {
        "source": "Kiwoom ka10081 individual-stock histories + current Infostock ka10106/ka10107",
        "method": "historical_turnover_and_return_with_current_theme_constituents",
        "official_historical_theme_ranking": False,
        "as_of": asof.isoformat(),
        "from": start.isoformat(),
        "to": asof.isoformat(),
        "listed_stocks_today": len(universe),
        "stocks_with_charts": sum(bool(chart_map.get(code)) for code in universe),
        "trading_sessions_covered": len(coverage),
        "inferred_events_added": new_events,
        "matched_current_themes": total_themes,
        "min_stock_coverage_fraction": 0.65,
        "limitations": [
            "Past Infostock theme membership changes are unavailable",
            "Delisted shares are not in the current listed universe",
            "Theme ranking proxy uses only historically liquid constituents"
        ]
    }
    if not report.get("tracked"):
        raise RuntimeError("Reconstruction produced no tracked shares; original file unchanged")
    # Write only after all source and consistency checks pass. Original is retained
    # in encrypted-user AppData checkpoint and remains in Git history.
    target = HISTORY_FILE.with_suffix(".json.tmp")
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(target, HISTORY_FILE)
    print(
        f"BACKFILL SUCCESS: {len(coverage)} trading sessions; "
        f"{new_events} historical top-2 events added; "
        f"{len(report['tracked'])} currently tracked shares; "
        f"report date={asof}. This is ESTIMATED, not official Infostock rankings.",
        flush=True
    )


if __name__ == "__main__":
    main()
