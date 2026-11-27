/* Offline regression test for K-Scanner matching one-year trading chart.
   Run with: node tests/radar-tv-chart.test.cjs */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('radar-tv-chart.js','utf8');
const result={series:[],charts:0,removed:0,paneIndex:[],visible:null};
const mock={
  CandlestickSeries:'Candle',LineSeries:'Line',HistogramSeries:'Volume',
  createChart() {
    result.charts++;
    const chart={
      addSeries(type,settings,pane){
        const item={type,settings,pane,data:[],setData(rows){this.data=rows;}};
        result.series.push(item);return item;
      },
      panes(){return [{setHeight(){}},{setHeight(){}}];},
      timeScale(){return {setVisibleLogicalRange(range){result.visible=range;}};},
      subscribeCrosshairMove(){},
      remove(){result.removed++;}
    };
    return chart;
  }
};
const window={LightweightCharts:mock,MoneyFlowChart:{render(){return 'legacy-render';},bind(){}}};
vm.runInNewContext(source,{window,console},{filename:'radar-tv-chart.js'});
const chart=window.MoneyFlowChart;
assert.equal(chart.version,'3.6-tv');
const sourceBars=[];
const start=Date.UTC(2025,8,1);
for(let i=0;i<275;i++){
 const dt=new Date(start+i*86400000);
 const date=dt.toISOString().slice(0,10).replace(/-/g,'');
 const close=5000+i*7,open=close-(i%2?16:-12);
 sourceBars.push({date,open,high:Math.max(open,close)+20,
   low:Math.min(open,close)-20,close,volume:1000+i*3});
}
const screen=chart.render(sourceBars,{}, {name:'바이브컴퍼니',ticker:'301300',range:'252'});
assert(screen.includes('PRICE ACTION / 1 YEAR'));
assert(screen.includes('바이브컴퍼니'));
assert(screen.includes('MA10')&&screen.includes('MA20'));
assert(!screen.includes('RSI')&&!screen.includes('MACD'));
assert(screen.includes('data-chart-range="252"'));
assert(screen.includes('id="ksrCanvas"'));
const root={
  elements:{
    '#ksrCanvas':{clientWidth:1200,innerHTML:'',insertAdjacentHTML(){}},
    '#ksrTooltip':{hidden:true,innerHTML:'',style:{}}
  },
  querySelector(selector){return this.elements[selector]||null;}
};
chart.bind(root,sourceBars,{range:'252'});
assert.equal(result.charts,1);
assert.equal(result.series.length,4);
assert.equal(result.series[0].type,'Candle');
assert.equal(result.series[0].data.length,275);
assert.equal(result.series[1].data.length,266,'MA10 uses all source bars');
assert.equal(result.series[2].data.length,256,'MA20 uses all source bars');
assert.equal(result.series[3].type,'Volume');
assert.equal(result.series[3].pane,1);
assert.equal(result.series[3].data.length,275);
assert.equal(result.visible.to-result.visible.from,254,'roughly 252-day viewport plus right padding');
chart.destroy(root);
assert.equal(result.removed,1);
const old=sourceBars.map(({date,close,high,low})=>({date,close,high,low}));
const noData=chart.render(old,{}, {name:'과거데이터'});
assert(noData.includes('실제 캔들용 시가 데이터가 없습니다.'));
assert(!noData.includes('id="ksrCanvas"'));
assert(!noData.includes('legacy-render'));
console.log('PASS: 1Y candles, MA10/MA20, real volume separate pane, no RSI/MACD, no fake OHLC');
