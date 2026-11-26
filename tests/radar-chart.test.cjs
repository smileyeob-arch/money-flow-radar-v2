/* Run with: node tests/radar-chart.test.cjs */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('radar-chart.js','utf8');
const context={window:{}};
vm.runInNewContext(source,context,{filename:'radar-chart.js'});
const api=context.window.MoneyFlowChart;
assert(api&&api.version==='3.4','Chart module must be available');
const dates=[];
for(let month=1;month<=9;month++)for(let day=1;day<=22;day++)
  dates.push('2026'+String(month).padStart(2,'0')+String(day).padStart(2,'0'));
const full=dates.slice(0,160).map((date,i)=>{
  const close=100000+i*170+1400*Math.sin(i/12);
  return {date,open:close-180,high:close+530,low:close-700,
          close,volume:1000000+i*2000};
});
const fib={'0.236':115000,'0.382':108000,'0.5':102000,'0.618':95000};
const modern=api.render(full,fib,{range:'66',name:'실제종목'});
assert(modern.includes('data-chart-range="132"'),'6-month range toggle');
assert(modern.includes('data-chart-range="all"'),'full range toggle');
assert.equal((modern.match(/stroke-width="1.4"/g)||[]).length,66,
  '66 OHLCV candles should be painted, without synthesizing prices');
assert(modern.includes('실제 거래량'),'Actual volume flag');
assert(modern.includes('F0.382'),'Fib guide should appear');
assert(modern.includes('RSI (14)'),'RSI should be present');
assert(modern.includes('>MACD</text>'),'MACD pane should be present');
assert(modern.includes('MA120 <b>'),'Long moving average should be included');
assert(!modern.includes('시가 정보 없음'),'New data must use candlestick not fallback');
const old=api.render(full.map(({date,close,high,low})=>({date,close,high,low})),
                     fib,{range:'66',name:'이전파일'});
assert(old.includes('시가 정보 없음'),'Old files must show honest fallback');
assert(old.includes('거래량 데이터 없음'),'Missing volume must not be invented');
assert.equal((old.match(/stroke-width="1.4"/g)||[]).length,0);
const short=api.render(full.slice(0,24),fib,{range:'all',name:'데이터부족'});
assert(short.includes('MA120 <b>—</b>'),'Unavailable MA120 must not be fabricated');
assert.equal(api.indicators.rsi(Array(40).fill(0).map((_,i)=>100+i))[39],100);
assert(Math.abs(api.indicators.sma(Array.from({length:20},(_,i)=>i+1),20)[19]-10.5)<1e-8);
assert.equal(api.indicators.macd(Array.from({length:50},(_,i)=>100+i)).hist.length,50);
console.log('PASS: real candlesticks, MA10/20/60/120, Fibonacci, volume, RSI, MACD, and legacy fallback');
