"""Ninety-day theme leadership and MA20/Fibonacci pullback journal.

Official historical Infostock theme ranking is NOT reconstructed. Rankings here
are an explicit proxy derived only from 500억원+ monitored shares per day.
No order placement or alerts are performed.
"""
from datetime import date, timedelta
from collections import defaultdict
import math

WINDOW_DAYS = 92
LEVELS = (0.236, 0.382, 0.500, 0.618)


def _n(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _d(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def theme_leaders(stocks):
    themes = defaultdict(list)
    for stock in stocks:
        if stock.get("change_pct") is None or stock.get("amount_eok") is None:
            continue
        for theme in set(stock.get("sectors") or []):
            if theme and theme != "미분류":
                themes[theme].append(stock)
    result = []
    for theme, members in themes.items():
        # A one-share theme is not a reliable market-wide theme strength proxy.
        if len(members) < 2:
            continue
        avg = sum(float(x["change_pct"]) for x in members) / len(members)
        up = sum(float(x["change_pct"]) > 0 for x in members)
        if avg <= 0 or up / len(members) < 0.5:
            continue
        candidates = sorted((x for x in members if float(x["change_pct"]) > 0),
                            key=lambda x: (-float(x["amount_eok"]), -float(x["change_pct"])))
        result.append({
            "theme": theme, "avg_change_pct": round(avg, 2),
            "member_count": len(members), "up_count": up,
            "amount_eok": round(sum(float(x["amount_eok"]) for x in members), 1),
            "picks": [{"ticker": x["ticker"], "name": x["name"],
                       "market": x["market"], "event_close": x["close"],
                       "event_amount_eok": x["amount_eok"]}
                      for x in candidates[:2]]
        })
    result.sort(key=lambda x: (-x["avg_change_pct"], -x["up_count"],
                               -x["amount_eok"], x["theme"]))
    return [{**v, "rank": i + 1} for i, v in enumerate(result[:2])]


def _round(x):
    return round(x, 2) if x is not None else None


def pullback_state(bars, first_event_date):
    ordered = sorted((r for r in bars if r.get("date")), key=lambda x: x["date"])
    if len(ordered) < 21:
        return {"status": "차트 부족", "status_key": "unknown"}
    event_key = str(first_event_date).replace("-", "")
    pivot = next((i for i, r in enumerate(ordered) if r["date"] >= event_key), None)
    if pivot is None or pivot < 5:
        return {"status": "기준 저점 부족", "status_key": "unknown"}
    before = ordered[max(0, pivot-20):pivot]
    afterwards = ordered[pivot:]
    if not before or not afterwards:
        return {"status": "차트 부족", "status_key": "unknown"}
    lows = [_n(r.get("low")) for r in before]
    highs = [_n(r.get("high")) for r in afterwards]
    closes = [_n(r.get("close")) for r in ordered[-20:]]
    close = _n(ordered[-1].get("close"))
    if any(v is None or v <= 0 for v in lows + highs + closes) or not close:
        return {"status": "고저가 데이터 부족", "status_key": "unknown"}
    low = min(lows)
    peak = max(highs)
    if peak <= low:
        return {"status": "상승폭 부족", "status_key": "unknown"}
    ma20 = sum(closes)/20
    span = peak - low
    fibs = {str(v): _round(peak-span*v) for v in LEVELS}
    gap20 = (close/ma20 - 1)*100
    gap236 = (close/fibs["0.236"] - 1)*100
    gap382 = (close/fibs["0.382"] - 1)*100
    retracement = (peak-close)/span*100
    rally = (peak/low-1)*100
    # Prevent a just-discovered or barely moving stock from being called a pullback.
    enough_time = len(afterwards) >= 4
    real_pullback = retracement >= 15 and close < peak * 0.98
    valid_rally = rally >= 8
    near_ma20 = abs(gap20) <= 3
    near_382 = abs(gap382) <= 3
    near_236 = abs(gap236) <= 3
    if close < fibs["0.618"] * 0.98 and close < ma20:
        status, key = "이탈 주의", "risk"
    elif enough_time and real_pullback and valid_rally and near_ma20 and near_382:
        status, key = "20일선·피보 중첩", "confluence"
    elif enough_time and real_pullback and valid_rally and near_ma20:
        status, key = "20일선 관심", "ma20"
    elif enough_time and real_pullback and valid_rally and near_382:
        status, key = "피보 0.382 관심", "fib"
    elif enough_time and real_pullback and valid_rally and near_236:
        status, key = "피보 0.236 관찰", "fib_watch"
    else:
        status, key = "눌림 대기", "waiting"
    return {
        "status": status, "status_key": key, "close": _round(close),
        "ma20": _round(ma20), "ma20_gap_pct": _round(gap20),
        "low_anchor": _round(low), "peak_high": _round(peak),
        "rally_pct": _round(rally), "retracement_pct": _round(retracement),
        "fib": fibs, "fib_236_gap_pct": _round(gap236),
        "fib_382_gap_pct": _round(gap382), "session": ordered[-1]["date"],
        "days_since_event_sessions": len(afterwards)
    }


def build_radar(snapshot_date, stocks, previous, get_bars, record_new=True):
    today = _d(snapshot_date)
    if today is None:
        raise ValueError("Invalid market session date")
    previous = previous if isinstance(previous, dict) else {}
    cutoff = today - timedelta(days=WINDOW_DAYS)
    events = [
        x for x in (previous.get("events") or [])
        if isinstance(x, dict) and (dt := _d(x.get("date"))) and cutoff <= dt <= today
    ]
    tracked = {
        t["ticker"]: dict(t) for t in (previous.get("tracked") or [])
        if isinstance(t, dict) and isinstance(t.get("ticker"), str)
        and (dt := _d(t.get("first_seen"))) and cutoff <= dt <= today
    }
    current = {s["ticker"]: s for s in stocks}
    new = theme_leaders(stocks) if record_new else []
    if record_new:
        # Replace any provisional ranking from an earlier collection on the same date.
        events = [e for e in events if e.get("date") != snapshot_date]
        for top in new:
            events.append({
                "date": snapshot_date,
                "rank": top["rank"], "theme": top["theme"],
                "avg_change_pct": top["avg_change_pct"],
                "member_count": top["member_count"], "up_count": top["up_count"],
                "amount_eok": top["amount_eok"],
                "picks": top["picks"], "proxy": True
            })
            for pick in top["picks"]:
                key = pick["ticker"]
                prior = tracked.get(key)
                if prior is None:
                    tracked[key] = {
                        "ticker": key, "name": pick["name"],
                        "market": pick["market"], "first_seen": snapshot_date,
                        "first_theme": top["theme"], "first_rank": top["rank"],
                        "signals": []
                    }
                tracked[key]["signals"] = [
                    x for x in tracked[key].get("signals", [])
                    if not (x.get("date") == snapshot_date and x.get("theme") == top["theme"])
                ] + [{"date": snapshot_date, "theme": top["theme"], "rank": top["rank"],
                       "avg_change_pct": top["avg_change_pct"]}]
    events.sort(key=lambda x: (x.get("date", ""), -int(x.get("rank", 2))), reverse=True)
    report = []
    for ticker, item in tracked.items():
        bars = get_bars(ticker)
        if not bars:
            quote = {"status": "시세 조회 실패", "status_key": "unknown"}
        else:
            quote = pullback_state(bars, item["first_seen"])
            # Keep the last 95 trading sessions for a chart and auditability.
            quote["bars"] = [
                {"date": b.get("date"),
                 "close": _n(b.get("close")), "high": _n(b.get("high")),
                 "low": _n(b.get("low"))}
                for b in sorted(bars, key=lambda x: x["date"])[-95:]
            ]
        report.append({**item, **quote,
                       "currently_500eok": ticker in current})
    report.sort(key=lambda x: (
        {"confluence": 0, "ma20": 1, "fib": 2, "fib_watch": 3,
         "waiting": 4, "risk": 5}.get(x["status_key"], 6),
        x["first_seen"], x["ticker"]
    ))
    return {
        "as_of": snapshot_date,
        "window_days": WINDOW_DAYS,
        "ranking_method": "500억원 이상 종목의 테마별 당일 평균 상승률 대용지표; 공식 인포스탁 전체 테마 수익률 아님",
        "history_start": min((e["date"] for e in events), default=None),
        "backfilled": False,
        "events": events,
        "tracked": report,
        "new_today": len(new)
    }
