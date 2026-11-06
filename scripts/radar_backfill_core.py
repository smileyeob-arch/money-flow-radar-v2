"""Pure offline reconstruction helpers; never claims official historical theme rankings."""
from collections import defaultdict
from datetime import date, timedelta
from radar import theme_leaders


def historical_snapshots(universe, chart_map, theme_map, start_date, end_date,
                         min_coverage=0.65):
    """Replay per-session 500억원 liquidity filter against ALL surviving current shares.

    Universe and theme memberships are *current*, not point-in-time. Delisted
    shares and changed historical memberships are unavailable and excluded.
    Returns per-date proxy theme leaders and coverage counts.
    """
    if not isinstance(start_date, date) or not isinstance(end_date, date):
        raise ValueError("start and end must be date objects")
    if end_date < start_date:
        raise ValueError("end before start")
    if len(universe) < 100:
        raise RuntimeError("Not enough ordinary listed shares for an indicative reconstruction")
    day_candidates = defaultdict(list)
    day_coverage = defaultdict(int)
    start_key = start_date.strftime("%Y%m%d")
    end_key = end_date.strftime("%Y%m%d")
    for ticker, info in universe.items():
        bars = chart_map.get(ticker) or []
        ordered = sorted(
            (b for b in bars if isinstance(b, dict) and
             isinstance(b.get("date"), str) and
             isinstance(b.get("close"), (int, float)) and b["close"] > 0),
            key=lambda b: b["date"]
        )
        last = None
        for bar in ordered:
            dt = bar["date"]
            close = float(bar["close"])
            if start_key <= dt <= end_key:
                day_coverage[dt] += 1
                amount = float(bar.get("amount") or 0)
                if last and last > 0 and amount >= 50000:
                    themes = [t.get("name") for t in (theme_map.get(ticker) or [])
                              if isinstance(t, dict) and t.get("name")]
                    if themes:
                        day_candidates[dt].append({
                            "ticker": ticker, "name": info["name"],
                            "market": info["market"], "close": int(close),
                            "amount_eok": round(amount / 100, 1),
                            "change_pct": round((close / last - 1) * 100, 4),
                            "sectors": list(dict.fromkeys(themes))
                        })
            last = close
    # Strict coverage: ensure missed/suspended/new listings are not used as fake
    # zero-return members. We do not manufacture a theme winner on thin coverage.
    threshold = int(len(universe) * min_coverage)
    observed = sorted(day_coverage)
    if not observed:
        raise RuntimeError("No historical trading days returned by chart API")
    valid = [(dt, day_coverage[dt]) for dt in observed
             if day_coverage[dt] >= threshold]
    if len(valid) < 20:
        raise RuntimeError(f"Only {len(valid)} sessions meet {min_coverage:.0%} stock coverage")
    events = []
    coverage = []
    for dt, count in valid:
        leaders = theme_leaders(day_candidates[dt])
        coverage.append({
            "date": f"{dt[:4]}-{dt[4:6]}-{dt[6:]}",
            "stocks_with_bars": count, "liquid_stocks": len(day_candidates[dt]),
            "themes_ranked": len(leaders)
        })
        for leader in leaders:
            events.append({
                "date": f"{dt[:4]}-{dt[4:6]}-{dt[6:]}",
                "rank": leader["rank"], "theme": leader["theme"],
                "avg_change_pct": leader["avg_change_pct"],
                "member_count": leader["member_count"],
                "up_count": leader["up_count"], "amount_eok": leader["amount_eok"],
                "picks": leader["picks"], "proxy": True, "backfill": True,
                "current_theme_membership": True
            })
    return events, coverage


def merge_events(existing, inferred, snapshot_date):
    """Honor already observed live events; backfill only missing earlier days."""
    kept = [x for x in existing if isinstance(x, dict) and x.get("date")
            and x["date"] <= snapshot_date]
    known_days = {x["date"] for x in kept}
    added = [x for x in inferred if x.get("date") not in known_days
             and x.get("date", "") < snapshot_date]
    events = kept + added
    events.sort(key=lambda e: (e["date"], int(e.get("rank") or 99), e["theme"]))
    return events, len(added)


def tracked_from_events(events):
    """Build each picked stock's first-known event and subsequent theme signals."""
    tracked = {}
    for e in sorted(events, key=lambda x: (x["date"], int(x.get("rank") or 99))):
        for pick in (e.get("picks") or []):
            ticker = str(pick.get("ticker") or "").strip()
            if not ticker:
                continue
            entry = tracked.setdefault(ticker, {
                "ticker": ticker, "name": str(pick.get("name") or ticker),
                "market": str(pick.get("market") or ""),
                "first_seen": e["date"], "first_theme": e["theme"],
                "first_rank": int(e["rank"]), "signals": []
            })
            key = (e["date"], e["theme"], e["rank"])
            if any((x["date"], x["theme"], x["rank"]) == key
                   for x in entry["signals"]):
                continue
            entry["signals"].append({
                "date": e["date"], "theme": e["theme"], "rank": e["rank"],
                "avg_change_pct": e.get("avg_change_pct"),
                "reconstructed": bool(e.get("backfill"))
            })
    return list(tracked.values())
