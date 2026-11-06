"""KRX end-of-day turnover collector. Does not write output on upstream failure."""
import csv
import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd
from pykrx import stock

ROOT = Path(__file__).resolve().parents[1]
KST = ZoneInfo('Asia/Seoul')
OUT = ROOT / 'data' / 'latest.json'
MAPPING = ROOT / 'data' / 'sectors.csv'


def clean(v):
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def load_mapping():
    with MAPPING.open(encoding='utf-8-sig', newline='') as f:
        return {r['ticker'].strip().zfill(6): [v.strip() for v in r['sector'].split('|') if v.strip()] for r in csv.DictReader(f) if r.get('ticker') and r.get('sector')}


def market_snapshot(day):
    # Fetch KOSPI and KOSDAQ separately to avoid ETFs and other instruments.
    frames=[]
    for market in ('KOSPI','KOSDAQ'):
        df=stock.get_market_ohlcv_by_ticker(day, market=market)
        if df is None or df.empty or '거래대금' not in df.columns:
            continue
        df=df.copy()
        df['market']=market
        frames.append(df)
    if not frames:
        raise RuntimeError(f'No KRX data for {day}')
    return pd.concat(frames)


def main():
    today=datetime.now(KST).date()
    # End-of-day run after close; if market is closed, use the most recent session.
    latest=None
    for offset in range(0, 11):
        day=(today-timedelta(days=offset)).strftime('%Y%m%d')
        try:
            frame=market_snapshot(day)
            active=int((frame['거래대금']>0).sum())
            print(f'Snapshot {day}: {len(frame)} rows, {active} active stocks', flush=True)
            if active>100:
                latest=(day,frame)
                break
            print(f'Skip {day}: only {active} active stocks, expected >100', flush=True)
        except Exception as exc:
            print(f'Skip {day}: {exc}')
    if latest is None:
        raise RuntimeError('Unable to fetch a valid recent market session. Previous JSON preserved.')
    date, current=latest
    current=current[current['거래대금']>0].sort_values('거래대금',ascending=False).head(100)
    if len(current)<50:
        raise RuntimeError('Suspiciously small result; previous JSON preserved.')
    mapping=load_mapping()
    # Retrieve preceding 20 market sessions (not 20 calendar days).
    history=[]
    cursor=datetime.strptime(date,'%Y%m%d').date()-timedelta(days=1)
    attempts=0
    while len(history)<20 and attempts<48:
        d=cursor.strftime('%Y%m%d')
        try:
            f=market_snapshot(d)
            if (f['거래대금']>0).sum()>100:
                history.append(f[['거래대금','종가']])
                print('History',d)
        except Exception as exc:
            print('Skip history',d,str(exc))
        cursor-=timedelta(days=1)
        attempts+=1
    if len(history)<20:
        raise RuntimeError(f'Only {len(history)} prior sessions found; previous JSON preserved.')
    hist_amount=pd.concat([h['거래대금'] for h in history],axis=1)
    hist_close=pd.concat([h['종가'] for h in history],axis=1)
    stocks=[]
    for ticker,r in current.iterrows():
        ticker=str(ticker).zfill(6)
        amount=float(r['거래대금'])
        prior=hist_amount.loc[ticker].astype(float) if ticker in hist_amount.index else pd.Series(dtype=float)
        # Missing historic rows are excluded from that stock's comparison window.
        prior=prior[prior>0]
        def pct(base):
            return round((amount/base-1)*100,1) if base and base>0 else None
        try:
            name=stock.get_market_ticker_name(ticker) or ticker
        except Exception:
            name=ticker
        close=clean(r.get('종가')) or 0
        prev=clean(r.get('시가')) or 0
        # pykrx '등락률' is close-to-previous-close, not open-to-close.
        change=clean(r.get('등락률'))
        if change is None:
            change=0.0
        d1=pct(float(prior.iloc[0])) if len(prior)>=1 else None
        p5=pct(float(prior.iloc[:5].mean())) if len(prior)>=5 else None
        p20=pct(float(prior.iloc[:20].mean())) if len(prior)>=20 else None
        close_history=hist_close.loc[ticker].astype(float) if ticker in hist_close.index else pd.Series(dtype=float)
        close_history=close_history[close_history>0]
        # Current close + preceding 19 sessions = 20-session moving average.
        ma20=round((close+float(close_history.iloc[:19].sum()))/20,2) if close>0 and len(close_history)>=19 else None
        gap20=round((close/ma20-1)*100,2) if ma20 and ma20>0 else None
        themes=mapping.get(ticker,['미분류'])
        stocks.append(dict(ticker=ticker,name=name,market=r['market'],sector=themes[0],sectors=themes,close=int(close),change_pct=round(change,2),amount_eok=round(amount/1e8,1),day_amount_pct=d1,spike5_pct=p5,spike20_pct=p20,ma20_close=ma20,ma20_gap_pct=gap20))
    # Transparent heuristic: relative turnover rank (0-40), 5d turnover ratio (0-25),
    # daily return (0-20), 20d turnover ratio (0-15). Not a backtested signal.
    max_amount=max(s['amount_eok'] for s in stocks) or 1
    for s in stocks:
        vol=40*s['amount_eok']/max_amount
        s5=25*min(1,max(0,(s['spike5_pct'] or 0)/200))
        move=20*min(1,max(0,s['change_pct'])/15)
        s20=15*min(1,max(0,(s['spike20_pct'] or 0)/200))
        s['score']=round(vol+s5+move+s20,1)
    result=dict(date=f'{date[:4]}-{date[4:6]}-{date[6:]}',generated_at_kst=datetime.now(KST).strftime('%Y-%m-%d %H:%M KST'),source='KRX via pykrx',sector_mapping_note='data/sectors.csv 수동 테마 분류; 다중 테마 거래대금 중복 집계 가능; 미분류는 분류 미등록',stocks=stocks)
    OUT.parent.mkdir(exist_ok=True)
    tmp=OUT.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(tmp,OUT)
    print(f'Wrote {OUT}: {len(stocks)} stocks for {date}')

if __name__=='__main__':
    main()
