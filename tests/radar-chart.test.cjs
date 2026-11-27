/* Run with: node tests/radar-chart.test.cjs */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('radar-chart.js','utf8');
const context={window:{}};
vm.runInNewContext(source,context,{filename:'radar-chart.js'});
const api=context.window.MoneyFlowChart;
assert.equal(api.version,'3.5-kcs','K차트스캐너 chart module loaded');
const dates=[];
for(let month=1;month<=9;month++)for(let day=1;day<=22;day++)
  dates.push('2026'+String(month).padStart(2,'0')+String(day).padStart(2,'0'));
const full=dates.slice(0,160).map((date,i)=>{
  const close=100000+i*170+1400*Math.sin(i/12);
  return {date,open:close-180,high:close+530,low:close-700,close,volume:1000000+i*2000};
});
const fib={'0.236':115000,'0.382':108000,'0.5':102000,'0.618':95000};
const current=api.render(full,fib,{range:'66',name:'실제종목'});
for(const period of [5,10,20,60,120])
  assert(current.includes(period+' <b>'),'All K차트스캐너 moving average legends');
assert(current.includes('#f2f5ff')&&current.includes('#377ff6')&&
  current.includes('#ffd02e')&&current.includes('#16bf6e')&&current.includes('#a35edd'),
  'K차트스캐너 MA5/10/20/60/120 palette matches screenshot');
assert(current.includes('data-chart-range="22"')&&current.includes('data-chart-range="132"'));
assert.equal((current.match(/stroke-width="1.3"/g)||[]).length,66,'66 true candle wicks');
assert(current.includes('class="kcs-fib-fill"'),'Fib 0.236/0.382 must be one shaded band');
assert(!current.includes('F0.382')&&!current.includes('F0.618'),'No numeric Fibonacci chart labels');
assert(!/\bRSI\b|\bMACD\b/i.test(current),'RSI and MACD must be absent from UI');
assert(current.includes('>거래량</text>'),'Volume pane present');
assert(!current.includes('거래량 미수집'),'Real volume values recognized');
assert(current.includes('data-chart-range="all"'),'Full history available');
const prior=api.render(full.map(({date,close,high,low})=>({date,close,high,low})),
   fib,{range:'66',name:'이전파일'});
assert(prior.includes('구형 시세: 종가선'),'Previous local JSON uses close line');
assert(prior.includes('거래량 없음'),'Previous local JSON does not fake volume');
assert.equal((prior.match(/stroke-width="1.3"/g)||[]).length,0,'No fabricated old candlesticks');
const short=api.render(full.slice(0,24),fib,{range:'all',name:'짧은이력'});
assert(short.includes('120 <b>—</b>'),'Insufficient MA120 shows unavailable');
assert.equal(api.indicators.rsi,undefined,'RSI calculation removed');
assert.equal(api.indicators.macd,undefined,'MACD calculation removed');
const a=api.indicators.sma(Array.from({length:20},(_,i)=>i+1),20);
assert(Math.abs(a[19]-10.5)<1e-8,'SMA is correctly calculated');
console.log('PASS: K차트스캐너 MA 5/10/20/60/120; candles, volume, fib 0.236–0.382 only; no RSI/MACD');
