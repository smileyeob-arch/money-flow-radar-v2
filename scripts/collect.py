"""Kiwoom REST read-only end-of-day collector for Money Flow Radar v2.

Requires KIWOOM_APP_KEY and KIWOOM_APP_SECRET in environment/GitHub Secrets.
No credentials or access tokens are written to logs, JSON or repository.
"""
import csv
import json
import math
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
KST = ZoneInfo("Asia/Seoul")
OUT = ROOT / "data" / "latest.json"
MAPPING = ROOT / "data" / "sectors.csv"
HOST = "https://api.kiwoom.com"
DELAY = float(os.getenv("KIWOOM_REQUEST_DELAY", "0.30"))
MIN_AMOUNT_EOK = 500
MIN_AMOUNT_MILLION = 50000
MAX_RANK_PAGES = 10


def number(value, default=None):
    try:
        v = float(str(value).replace(",", "").strip())
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def positive(value, default=0):
    v = number(value, default)
    return abs(v) if v is not None else default


def load_mapping():
    with MAPPING.open(encoding="utf-8-sig", newline="") as f:
        return {
            r["ticker"].strip().zfill(6): [t.strip() for t in r["sector"].split("|") if t.strip()]
            for r in csv.DictReader(f) if r.get("ticker") and r.get("sector")
        }


class Kiwoom:
    def __init__(self):
        key = (os.environ.get("KIWOOM_APP_KEY") or "").strip()
        secret = (os.environ.get("KIWOOM_APP_SECRET") or os.environ.get("KIWOOM_SECRET_KEY") or "").strip()
        if not key or not secret:
            raise RuntimeError("Missing KIWOOM_APP_KEY / KIWOOM_APP_SECRET in GitHub Actions Secrets")
        self.session = requests.Session()
        self.last_call = 0.0
        r = self.session.post(
            HOST + "/oauth2/token",
            headers={"Content-Type": "application/json;charset=UTF-8"},
            json={"grant_type": "client_credentials", "appkey": key, "secretkey": secret},
            timeout=25,
        )
        r.raise_for_status()
        data = r.json()
        if str(data.get("return_code", 0)) != "0" or not data.get("token"):
            import re
            message = str(data.get("return_msg", ""))
            embedded = re.search(r"\[(\d{3,5}):", message)
            detail = embedded.group(1) if embedded else "unknown"
            print(f"Kiwoom OAuth diagnostic: return_code={data.get('return_code')}, embedded_code={detail}", flush=True)
            raise RuntimeError("Kiwoom OAuth rejected credentials: inspect embedded code; verify production/mock keys, secret values, and permissions")
        self.token = data["token"]
        print("Kiwoom OAuth authenticated", flush=True)

    def call(self, api_id, path, body, cont="N", next_key=""):
        since = time.monotonic() - self.last_call
        if since < DELAY:
            time.sleep(DELAY - since)
        headers = {
            "Content-Type": "application/json;charset=UTF-8",
            "authorization": "Bearer " + self.token,
            "api-id": api_id,
        }
        if cont == "Y":
            headers["cont-yn"] = "Y"
            headers["next-key"] = next_key
        self.last_call = time.monotonic()
        try:
            response = self.session.post(HOST + path, headers=headers, json=body, timeout=30)
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as exc:
            raise RuntimeError(f"{api_id} transport error: {type(exc).__name__}") from exc
        if str(payload.get("return_code", 0)) != "0":
            code = payload.get("return_code")
            msg = str(payload.get("return_msg", ""))[:160]
            raise RuntimeError(f"{api_id} API error {code}: {msg}")
        return payload, response.headers.get("cont-yn", "N").upper(), response.headers.get("next-key", "")


def eligible_individual_stocks(client):
    """Fail closed: only marketCode 0/10, excluding fund vehicles, SPACs and preferred shares."""
    eligible = {}
    for request_market in ("0", "10"):
        cont, next_key = "N", ""
        for page in range(10):
            payload, ncont, nkey = client.call("ka10099", "/api/dostk/stkinfo",
                                               {"mrkt_tp": request_market}, cont, next_key)
            rows = payload.get("list")
            if not isinstance(rows, list):
                raise RuntimeError("ka10099 list missing; cannot classify stocks safely")
            print(f"ka10099 requested={request_market} page={page+1}: {len(rows)} rows", flush=True)
            for item in rows:
                code = str(item.get("code", "")).strip()
                kind = str(item.get("marketCode", "")).strip()
                name = str(item.get("name", "")).strip()
                if not re.fullmatch(r"\d{6}", code) or kind not in ("0", "10"):
                    continue
                if re.search(r"스팩|SPAC|리츠|REIT", name, re.I):
                    continue
                if re.search(r"우(?:B|C|D|E|F)?$", name, re.I):
                    continue
                eligible[code] = {"market": "KOSPI" if kind == "0" else "KOSDAQ", "name": name}
            if ncont != "Y" or not nkey:
                break
            cont, next_key = "Y", nkey
        else:
            raise RuntimeError("ka10099 stock master pagination incomplete")
    if len(eligible) < 100:
        raise RuntimeError(f"ka10099 stock master too small: {len(eligible)}")
    print(f"Eligible ordinary stocks: {len(eligible)}", flush=True)
    return eligible


def rank_stocks(client, universe):
    """Ranked KOSPI/KOSDAQ ordinary shares only; minimum turnover 500억원."""
    result = {}
    excluded = 0
    for market, market_name in (("001", "KOSPI"), ("101", "KOSDAQ")):
        cont, next_key = "N", ""
        for page in range(MAX_RANK_PAGES):
            payload, ncont, nkey = client.call(
                "ka10032", "/api/dostk/rkinfo",
                {"mrkt_tp": market, "mang_stk_incls": "0", "stex_tp": "3"},
                cont, next_key
            )
            rows = payload.get("trde_prica_upper") or []
            print(f"ka10032 {market_name} page={page+1}: {len(rows)} rows", flush=True)
            amounts = []
            for row in rows:
                code = str(row.get("stk_cd", "")).strip().split("_")[0]
                if not re.fullmatch(r"\d{6}", code):
                    continue
                amount = positive(row.get("trde_prica"))
                if amount <= 0:
                    continue
                amounts.append(amount)
                info = universe.get(code)
                if amount < MIN_AMOUNT_MILLION or not info or info["market"] != market_name:
                    excluded += 1
                    continue
                item = dict(ticker=code, name=info["name"], market=market_name, rank_amount_million=amount)
                if code not in result or amount > result[code]["rank_amount_million"]:
                    result[code] = item
            if not rows or (amounts and min(amounts) < MIN_AMOUNT_MILLION):
                break
            if ncont != "Y" or not nkey:
                break
            cont, next_key = "Y", nkey
        else:
            print(f"WARNING: {market_name} reached the page limit; ranking may be incomplete", flush=True)
    stocks = sorted(result.values(), key=lambda item: -item["rank_amount_million"])
    print(f"500억원+ ordinary stocks: {len(stocks)}, excluded rank rows: {excluded}", flush=True)
    if not stocks:
        raise RuntimeError("No eligible ordinary stocks >=500억원; JSON unchanged")
    return stocks



def daily_bars(client, code, today):
    payload, _, _ = client.call(
        "ka10081", "/api/dostk/chart",
        {"stk_cd": code, "base_dt": today.strftime("%Y%m%d"), "upd_stkpc_tp": "1"},
    )
    data = payload.get("stk_dt_pole_chart_qry") or []
    bars = {}
    for r in data:
        dt = str(r.get("dt", ""))
        close = positive(r.get("cur_prc"))
        amount = positive(r.get("trde_prica"))
        if re.fullmatch(r"\d{8}", dt) and close > 0 and amount > 0:
            bars[dt] = {"date": dt, "close": close, "amount": amount,
                        "prev_delta": number(r.get("pred_pre"))}
    return [bars[dt] for dt in sorted(bars, reverse=True)]


def analyze(rank, bars, mapping):
    if len(bars) < 21:
        return None
    today = bars[0]
    previous = bars[1:21]
    if not previous[0]["close"] or not all(x["amount"] > 0 for x in previous):
        return None
    amount = today["amount"]
    def pct(base):
        return round((amount / base - 1) * 100, 1) if base > 0 else None
    close = today["close"]
    avg20 = sum(x["close"] for x in bars[:20]) / 20
    change = (close / previous[0]["close"] - 1) * 100
    ticker = rank["ticker"]
    themes = mapping.get(ticker, ["미분류"])
    return dict(
        ticker=ticker, name=rank["name"], market=rank["market"], sector=themes[0],
        sectors=themes, close=int(close), change_pct=round(change, 2),
        amount_eok=round(amount / 100, 1),  # Kiwoom ka10081 trde_prica is in million KRW
        day_amount_pct=pct(previous[0]["amount"]),
        spike5_pct=pct(sum(x["amount"] for x in previous[:5]) / 5),
        spike20_pct=pct(sum(x["amount"] for x in previous) / 20),
        ma20_close=round(avg20, 2),
        ma20_gap_pct=round((close / avg20 - 1) * 100, 2),
        session=today["date"],
    )


def _infostock_rows(data, keys, api_id):
    """Read a documented-style array without interpreting unknown objects as stock lists."""
    for key in keys:
        value = data.get(key)
        if isinstance(value, list):
            return value
    arrays = [(k, v) for k, v in data.items() if isinstance(v, list)]
    if len(arrays) == 1:
        print(f"{api_id} response list key: {arrays[0][0]}", flush=True)
        return arrays[0][1]
    raise RuntimeError(f"{api_id} list schema unresolved; fields={list(data.keys())[:20]}")


def _infostock_value(row, keys):
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def load_infostock_themes(client, selected):
    """Build an Infostock-only reverse map from ka10106 -> ka10107.

    Since provider schema versions may differ, unexpected response shapes FAIL
    CLOSED without writing a misleading JSON. No ka90001 or fabricated themes.
    """
    selected_codes = {x["ticker"] for x in selected}
    theme_index = {}
    categories = []
    seen_codes = set()
    cont, next_key = "N", ""
    for page in range(20):
        payload, ncont, nkey = client.call(
            "ka10106", "/api/dostk/thme", {}, cont, next_key
        )
        rows = _infostock_rows(payload, ("list",), "ka10106")
        for row in rows:
            if not isinstance(row, dict):
                continue
            code = _infostock_value(row, ("code",))
            name = _infostock_value(row, ("name",))
            if code and name and code not in seen_codes:
                seen_codes.add(code)
                categories.append((code, name))
        print(f"Infostock ka10106 page={page+1}, themes={len(categories)}", flush=True)
        if ncont != "Y" or not nkey:
            break
        cont, next_key = "Y", nkey
    else:
        raise RuntimeError("ka10106 theme list pagination limit hit; refusing incomplete map")
    if not categories:
        raise RuntimeError("ka10106 returned no recognizable theme codes/names; JSON unchanged")

    detail_errors = 0
    response_validated = 0
    # Verified against actual Kiwoom Infostock response on 2026-11-06.
    code_key = "code"
    max_details = int(os.getenv("INFOSTOCK_MAX_THEMES", "1000"))
    if len(categories) > max_details:
        raise RuntimeError(f"Infostock theme count {len(categories)} exceeds safe limit {max_details}")
    for i, (theme_code, theme_name) in enumerate(categories, 1):
        try:
            payload, ncont, next_key = client.call(
                "ka10107", "/api/dostk/thme", {code_key: theme_code}
            )
            rows = _infostock_rows(payload, ("list",), "ka10107")
            response_validated += 1
            def process(batch):
                for entry in batch:
                    if not isinstance(entry, dict):
                        continue
                    ticker = _infostock_value(entry, ("stk_cd",)).split("_")[0]
                    if ticker in selected_codes:
                        theme_index.setdefault(ticker, []).append(
                            {"code": theme_code, "name": theme_name}
                        )
            process(rows)
            pages = 1
            while ncont == "Y" and next_key:
                if pages >= 20:
                    raise RuntimeError(f"ka10107 pagination exceeded for {theme_code}")
                payload, ncont, next_key = client.call(
                    "ka10107", "/api/dostk/thme",
                    {code_key: theme_code}, "Y", next_key
                )
                process(_infostock_rows(payload, ("list",), "ka10107"))
                pages += 1
        except Exception as exc:
            detail_errors += 1
            if detail_errors <= 3:
                print(f"Infostock ka10107 diagnostic: {type(exc).__name__}: {str(exc)[:180]}", flush=True)
            # Any incomplete membership mapping must not be published as complete.
            if detail_errors >= 3:
                raise RuntimeError(
                    "Infostock detail API schema or authorization failed repeatedly; JSON unchanged"
                ) from exc
        if i % 50 == 0:
            print(f"Infostock detail progress {i}/{len(categories)}, matched={len(theme_index)}", flush=True)

    if detail_errors:
        raise RuntimeError(f"Infostock {detail_errors} detail lookup(s) failed; JSON unchanged")
    if not response_validated or not theme_index:
        raise RuntimeError(
            "Infostock returned no matched stocks; check ka10106/ka10107 field names; JSON unchanged"
        )
    return theme_index, len(categories)


def attach_themes(client, stocks, manual_mapping):
    """Exclusive Infostock theme membership; do not fallback to Kiwoom basic themes."""
    theme_index, categories = load_infostock_themes(client, stocks)
    match_count = 0
    for item in stocks:
        details = theme_index.get(item["ticker"], [])
        names = list(dict.fromkeys(t["name"] for t in details))
        if names:
            match_count += 1
        else:
            names = ["미분류"]
        item["sectors"] = names
        item["sector"] = names[0]
        item["theme_source"] = "infostock_ka10106_ka10107" if details else "infostock_unmatched"
        item["theme_details"] = details
    print(f"Infostock summary: themes={categories}, matched={match_count}/{len(stocks)}", flush=True)
    return {"api_ids": ["ka10106", "ka10107"], "theme_count": categories,
            "matched": match_count, "unmatched": len(stocks) - match_count,
            "mode": "infostock_exclusive"}


def main():
    date = datetime.now(KST)
    client = Kiwoom()
    universe = eligible_individual_stocks(client)
    ranking = rank_stocks(client, universe)
    mapping = load_mapping()
    stocks = []
    failures = 0
    excluded_below_threshold = 0
    verified_charts = 0
    for i, rank in enumerate(ranking, 1):
        try:
            bars = daily_bars(client, rank["ticker"], date.date())
            s = analyze(rank, bars, mapping)
            if s is None:
                failures += 1
                print(f"Insufficient daily history: {rank['ticker']}", flush=True)
            else:
                verified_charts += 1
                if s["amount_eok"] >= MIN_AMOUNT_EOK:
                    stocks.append(s)
                else:
                    excluded_below_threshold += 1
                    print(f"Below 500억원 at daily chart: {rank['ticker']}", flush=True)
        except Exception as exc:
            failures += 1
            print(f"Skipping {rank['ticker']}: {str(exc)[:170]}", flush=True)
        if i % 20 == 0:
            print(f"Checked {i}/{len(ranking)}, included={len(stocks)}, below500={excluded_below_threshold}, failures={failures}", flush=True)

    # A valid share can legitimately fall below the threshold between ranking
    # and chart endpoints; it must not be counted as a fetch failure.
    if verified_charts < max(1, math.ceil(len(ranking) * 0.7)):
        raise RuntimeError(f"Too few chart responses: {verified_charts}/{len(ranking)}; JSON unchanged")
    if not stocks:
        raise RuntimeError("No ordinary shares with verified daily turnover >=500억원; JSON unchanged")

    # Market session should be consistent across included charts.
    from collections import Counter
    day, count = Counter(s["session"] for s in stocks).most_common(1)[0]
    if count < max(1, math.ceil(len(stocks) * 0.9)):
        raise RuntimeError("Daily chart sessions inconsistent; JSON unchanged")
    stocks = [s for s in stocks if s["session"] == day]
    print(f"Filter result: {len(stocks)} included >=500억원, {excluded_below_threshold} below, {failures} failed queries", flush=True)
    # Reject old snapshots instead of silently publishing old quotes as current.
    actual = datetime.strptime(day, "%Y%m%d").date()
    if (date.date() - actual).days > 5:
        raise RuntimeError("Latest chart session older than five days; JSON unchanged")

    theme_status = attach_themes(client, stocks, mapping)
    stocks.sort(key=lambda x: -x["amount_eok"])
    max_amount = max(x["amount_eok"] for x in stocks) or 1
    for s in stocks:
        vol = 40 * s["amount_eok"] / max_amount
        s5 = 25 * min(1, max(0, (s["spike5_pct"] or 0) / 200))
        move = 20 * min(1, max(0, s["change_pct"]) / 15)
        s20 = 15 * min(1, max(0, (s["spike20_pct"] or 0) / 200))
        s["score"] = round(vol + s5 + move + s20, 1)
        del s["session"]
    output = {
        "date": f"{day[:4]}-{day[4:6]}-{day[6:]}",
        "generated_at_kst": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "source": "Kiwoom REST (ka10099 + ka10032 + ka10081)",
        "filter_note": "KOSPI/KOSDAQ ordinary shares, no ETF/ETN/REIT/SPAC/preferred shares, turnover >=500억원",
        "sector_mapping_note": "인포스탁 전용 ka10106/ka10107 기반; 미매칭은 미분류; 다중 테마 거래대금 중복 집계 가능",
        "theme_lookup": theme_status,
        "stocks": stocks,
    }
    OUT.parent.mkdir(exist_ok=True)
    temp = OUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, OUT)
    print(f"Saved {len(stocks)} stocks, session={day}, failed={failures}, below500={excluded_below_threshold}", flush=True)


if __name__ == "__main__":
    main()
