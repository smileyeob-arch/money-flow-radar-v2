"""Read-only Kiwoom HTS watchlist export for PRIVATE local browser import.

Never sends watchlist, account holdings, token or API key to GitHub.
Outputs one JSON file under LOCALAPPDATA\MoneyFlowRadar.
"""
import gzip
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

from collect import Kiwoom, KST, eligible_individual_stocks, daily_bars


def checked_response(data, api):
    code = str(data.get("rtcd", "S")).upper()
    if code not in ("S", "0"):
        raise RuntimeError(f"{api} returned status {code}; nothing exported")


def normalize_stock_code(raw):
    """Allow provider prefix/suffix around a six-digit ticker, not arbitrary IDs."""
    value = str(raw or "").strip().upper()
    match = re.fullmatch(r"(?:A)?(\d{6})(?:_(?:KRX|NXT))?", value)
    return match.group(1) if match else ""


def watchlist_group_list(client):
    payload, _, _ = client.call("ka01300", "/api/dostk/watchlist", {})
    checked_response(payload, "ka01300")
    rows = payload.get("nofi")
    if not isinstance(rows, list):
        raise RuntimeError(f"ka01300 returned unexpected fields {list(payload)[:12]}")
    groups = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("gcod") or "").strip()
        name = str(row.get("name") or code).strip()
        if code:
            groups.append({"id": code, "name": name})
    return groups


def watchlist_members(client, group):
    payload, _, _ = client.call(
        "ka01301", "/api/dostk/watchlist", {"arn_grp_id": group["id"]}
    )
    checked_response(payload, "ka01301")
    rows = payload.get("nofj")
    if not isinstance(rows, list):
        raise RuntimeError(f"ka01301 returned unexpected fields {list(payload)[:12]}")
    codes = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = normalize_stock_code(row.get("cod2"))
        if code and code not in codes:
            codes.append(code)
    return codes, len(rows)


def historical_technical(bars):
    """Current MA20/Fibonacci technical proximity, not a theme selection date."""
    ordered = sorted(
        [b for b in bars if b.get("date") and b.get("close", 0) > 0 and
         b.get("high", 0) > 0 and b.get("low", 0) > 0],
        key=lambda r: r["date"]
    )
    if len(ordered) < 25:
        return {"status": "일봉 부족", "status_key": "unknown"}
    lookback = ordered[-90:]
    close = float(lookback[-1]["close"])
    ma20 = sum(float(b["close"]) for b in lookback[-20:]) / 20
    # Find strongest low-to-later-high swing in recent 90 sessions.
    # Require a meaningful pullback interval after the peak.
    best = None
    for peak_index in range(6, len(lookback) - 2):
        prefix = lookback[max(0, peak_index-50):peak_index]
        if not prefix:
            continue
        low_row = min(prefix, key=lambda b: float(b["low"]))
        peak_row = lookback[peak_index]
        low, high = float(low_row["low"]), float(peak_row["high"])
        if high <= low:
            continue
        ratio = high / low - 1
        if best is None or ratio > best["rally"]:
            best = {"low": low, "high": high, "rally": ratio,
                    "low_date": low_row["date"], "peak_date": peak_row["date"]}
    if best is None:
        return {"status": "상승 구간 미확인", "status_key": "unknown",
                "close": round(close, 2), "ma20": round(ma20, 2),
                "ma20_gap_pct": round((close / ma20-1)*100, 2)}
    low, high = best["low"], best["high"]
    fib = {str(r): round(high-(high-low)*r,2) for r in (.236,.382,.5,.618)}
    near_ma = abs(close/ma20-1) <= .03
    near_fib = abs(close/fib["0.382"]-1) <= .03
    retracement=(high-close)/(high-low)
    valid=best["rally"]>=.08 and retracement>=.15
    if close < fib["0.618"]*.98 and close < ma20:
        status,key="이탈 주의","risk"
    elif valid and near_ma and near_fib:
        status,key="20일선·피보 중첩","confluence"
    elif valid and near_ma:
        status,key="20일선 관심","ma20"
    elif valid and near_fib:
        status,key="피보 0.382 관심","fib"
    elif valid and abs(close/fib["0.236"]-1) <= .03:
        status,key="피보 0.236 관찰","fib_watch"
    else:
        status,key="눌림 대기","waiting"
    return {
        "status": status,"status_key": key,
        "close": round(close,2), "ma20": round(ma20,2),
        "ma20_gap_pct": round((close/ma20-1)*100,2),
        "low_anchor": round(low,2), "peak_high": round(high,2),
        "rally_pct": round(best["rally"]*100,2),
        "retracement_pct": round(retracement*100,2),
        "fib": fib,"swing_low_date": best["low_date"],
        "swing_high_date": best["peak_date"],
    }



CACHE_VERSION = 3
CHECKPOINT_EVERY = 25


def watchlist_checkpoint_path(asof, base):
    """Private, date-scoped cache. Never committed to the GitHub repository."""
    directory = Path(base) / "watchlist-chart-cache"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / ("watchlist-bars-" + asof.strftime("%Y%m%d") + "-v3.json.gz")


def load_watchlist_cache(path, asof):
    if not path.exists():
        return {"version": CACHE_VERSION, "session": asof.strftime("%Y%m%d"), "records": {}}
    try:
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            result = json.load(stream)
    except (OSError, ValueError, EOFError) as exc:
        raise RuntimeError("Watchlist cache unreadable; do not overwrite it without checking") from exc
    if (not isinstance(result, dict) or result.get("version") != CACHE_VERSION
            or result.get("session") != asof.strftime("%Y%m%d")
            or not isinstance(result.get("records"), dict)):
        raise RuntimeError("Watchlist cache date/version does not match the requested session")
    return result


def save_watchlist_cache(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(temp, "wt", encoding="utf-8", compresslevel=5) as stream:
        json.dump(data, stream, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp, path)


def stock_record(code, info, bars):
    technical = historical_technical(bars)
    return {
        "ticker": code, "name": info["name"], "market": info["market"],
        "bars": [
            {"date": b["date"], "open": b.get("open"), "close": b["close"],
             "high": b.get("high"), "low": b.get("low"),
             "volume": b.get("volume")}
            for b in bars[:260]
        ],
        "session": bars[0]["date"] if bars else None,
        **technical
    }


def _fetch_chart_with_retry(client, code, today, attempts=3):
    """Retry only transient Kiwoom processing/transport failures.

    A permanently rejected request is not retried indefinitely, and no
    failed/stale OHLCV observations are ever written into the chart cache.
    """
    for attempt in range(1, attempts + 1):
        try:
            return daily_bars(client, code, today)
        except Exception as exc:
            detail = str(exc)
            transient = ("API error 7" in detail and "[1632]" in detail) or (
                "transport error" in detail)
            if not transient or attempt >= attempts:
                raise
            print(f"Transient chart error for {code}; retry {attempt}/{attempts - 1}", flush=True)
            time.sleep(min(4, attempt * 1.5))


def unavailable_stock_record(code, info, reason):
    """Keep a group member visible, but never invent a price or an indicator."""
    return {
        "ticker": code, "name": info["name"], "market": info["market"],
        "status": "일봉 조회 실패", "status_key": "unknown",
        "bars": [], "session": None, "chart_error": reason,
    }


def collect_watch_charts(client, selected, today, cache_path):
    """Resume personal charts and publish an explicitly marked partial result."""
    cache = load_watchlist_cache(cache_path, today)
    records = cache["records"]
    total = len(selected)
    already = sum(code in records for code in selected)
    print(f"Personal watchlist charts: {already}/{total} cached locally; resume supported", flush=True)
    consecutive_errors = 0
    failed_codes = {}
    processed_since_checkpoint = 0
    for idx, (code, info) in enumerate(sorted(selected.items()), 1):
        if code in records:
            continue
        try:
            bars = _fetch_chart_with_retry(client, code, today)
            records[code] = stock_record(code, info, bars)
            consecutive_errors = 0
        except Exception as exc:
            # Do not cache failures. On the next run we retry only the
            # unavailable tickers; previously successful 1544 remain cached.
            failed_codes[code] = f"{type(exc).__name__}: {str(exc)[:160]}"
            consecutive_errors += 1
            if len(failed_codes) <= 8:
                print(f"Watchlist chart error {code}: {failed_codes[code]}", flush=True)
        processed_since_checkpoint += 1
        if processed_since_checkpoint >= CHECKPOINT_EVERY or idx == total:
            save_watchlist_cache(cache_path, cache)
            processed_since_checkpoint = 0
            print(f"Watchlist progress {idx}/{total}; cached={sum(c in records for c in selected)}, errors={len(failed_codes)}", flush=True)
        if consecutive_errors >= 8:
            save_watchlist_cache(cache_path, cache)
            raise RuntimeError("8 consecutive Kiwoom chart errors. Local checkpoint saved; rerun to resume.")
    save_watchlist_cache(cache_path, cache)
    missing = [code for code in sorted(selected) if code not in records]
    # A handful of bad requests must not prevent all 1544 valid stocks from
    # being viewed. Stop if too many responses fail: that indicates wider
    # service trouble rather than one unreliable issue.
    allowed_missing = max(1, min(20, total // 100))
    if len(missing) > allowed_missing:
        raise RuntimeError(
            f"{len(missing)} watchlist chart requests failed (limit {allowed_missing}); "
            "checkpoint preserved, export not overwritten. Rerun to retry."
        )
    if missing:
        print(
            f"PARTIAL EXPORT WARNING: {len(missing)} chart(s) unavailable: "
            f"{', '.join(missing)}. All failed shares will be shown as '일봉 조회 실패'; "
            "remaining successful quotes are preserved.",
            flush=True
        )
    output = [
        records[code] if code in records else
        unavailable_stock_record(code, selected[code], failed_codes.get(code, "일봉 데이터 없음"))
        for code in sorted(selected)
    ]
    return output


def main():
    client = Kiwoom()
    groups = watchlist_group_list(client)
    print(f"HTS watchlist group count: {len(groups)}", flush=True)
    if not groups:
        raise RuntimeError("No HTS watchlist groups returned; no export created")
    universe = eligible_individual_stocks(client)
    selected = {}
    group_items = []
    for group in groups:
        codes, raw_count = watchlist_members(client, group)
        accepted = [code for code in codes if code in universe]
        group_items.append({**group, "tickers": accepted})
        for code in accepted:
            selected[code] = universe[code]
        print(f"Group '{group['name']}': {len(accepted)} KOSPI/KOSDAQ ordinary stocks "
              f"({raw_count} raw entries)", flush=True)

    # Keep all selected groups. 1,545 unique tickers is valid; the former
    # 400-ticker cap stopped before exporting any data.
    max_stocks = int(os.environ.get("KIWOOM_WATCHLIST_MAX", "3000"))
    if len(selected) > max_stocks:
        raise RuntimeError(
            f"Watchlist has {len(selected)} unique shares, exceeding safe cap {max_stocks}. "
            "Increase KIWOOM_WATCHLIST_MAX explicitly if needed."
        )
    now = datetime.now(KST)
    base = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "MoneyFlowRadar"
    base.mkdir(parents=True, exist_ok=True)
    cache_path = watchlist_checkpoint_path(now.date(), base)
    print(f"Groups loaded: {len(group_items)}; {len(selected)} unique ordinary shares", flush=True)
    stocks = collect_watch_charts(client, selected, now.date(), cache_path)
    if not stocks:
        raise RuntimeError("No eligible KOSPI/KOSDAQ ordinary stocks; existing file unchanged")
    failed_stocks = [x["ticker"] for x in stocks if x.get("status_key") == "unknown" and
                     x.get("chart_error")]
    data = {
        "kind": "kiwoom_watchlist_local",
        "failed_chart_count": len(failed_stocks),
        "failed_chart_tickers": failed_stocks,
        "exported_at_kst": now.strftime("%Y-%m-%d %H:%M KST"),
        "source": "Kiwoom REST ka01300 / ka01301 / ka10099 / ka10081",
        "privacy": "local_only_do_not_upload_to_public_github",
        "swing_method": "strongest low-to-later-high within recent 90 sessions; not a historical theme signal",
        "groups": group_items, "stocks": stocks
    }
    target = base / "watchlist-export.json"
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temp, target)
    print(f"EXPORT SUCCESS: {len(stocks)} stocks in {len(groups)} groups; "
          f"chart unavailable={len(failed_stocks)}, valid={len(stocks)-len(failed_stocks)}.", flush=True)
    print(f"LOCAL ONLY: {target}", flush=True)
    print("No personal watchlist data uploaded to GitHub.",flush=True)


if __name__ == "__main__":
    main()
