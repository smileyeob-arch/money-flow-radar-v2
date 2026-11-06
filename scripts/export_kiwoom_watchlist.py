"""Read-only Kiwoom HTS watchlist export for PRIVATE local browser import.

Never sends watchlist, account holdings, token or API key to GitHub.
Outputs one JSON file under LOCALAPPDATA\MoneyFlowRadar.
"""
import json
import os
import re
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

    max_stocks = int(os.environ.get("KIWOOM_WATCHLIST_MAX", "400"))
    if len(selected) > max_stocks:
        raise RuntimeError(
            f"Too many personal watchlist stocks ({len(selected)}). "
            f"Default safe limit is {max_stocks}; no export written."
        )
    stocks = []
    now = datetime.now(KST)
    for idx, (ticker, info) in enumerate(sorted(selected.items()), 1):
        try:
            bars = daily_bars(client, ticker, now.date())
            technical = historical_technical(bars)
            record = {"ticker": ticker, "name": info["name"], "market": info["market"],
                      "bars": [
                          {"date": b["date"],"close": b["close"],
                           "high": b.get("high"),"low": b.get("low")}
                          for b in bars[:110]
                      ],
                      "session": bars[0]["date"] if bars else None,
                      **technical}
            stocks.append(record)
        except Exception as exc:
            print(f"Technical data unavailable {ticker}: {type(exc).__name__}",flush=True)
            stocks.append({"ticker": ticker, "name": info["name"],
                           "market": info["market"],"status":"일봉 조회 실패",
                           "status_key":"unknown", "bars":[]})
        if idx % 20 == 0:
            print(f"Watchlist daily charts {idx}/{len(selected)}",flush=True)
    if not stocks:
        raise RuntimeError("No eligible KOSPI/KOSDAQ ordinary stocks; existing file unchanged")
    data = {
        "kind": "kiwoom_watchlist_local",
        "exported_at_kst": now.strftime("%Y-%m-%d %H:%M KST"),
        "source": "Kiwoom REST ka01300 / ka01301 / ka10099 / ka10081",
        "privacy": "local_only_do_not_upload_to_public_github",
        "swing_method": "strongest low-to-later-high within recent 90 sessions; not a historical theme signal",
        "groups": group_items, "stocks": stocks
    }
    base = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "MoneyFlowRadar"
    base.mkdir(parents=True, exist_ok=True)
    target = base / "watchlist-export.json"
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, target)
    print(f"EXPORT SUCCESS: {len(stocks)} stocks in {len(groups)} groups.", flush=True)
    print(f"LOCAL ONLY: {target}", flush=True)
    print("No personal watchlist data uploaded to GitHub.",flush=True)


if __name__ == "__main__":
    main()
