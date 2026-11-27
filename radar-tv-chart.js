'use strict';
/* K scanner style: genuine daily candles, MA10/MA20, volume pane. No fake OHLC. */
(() => {
  const legacy=window.MoneyFlowChart;
  const L=()=>window.LightweightCharts;
  const instances=new WeakMap();
  const choices=[['22','1개월'],['66','3개월'],['132','6개월'],['252','1년'],['all','전체']];
  const n=v=>(v===null||v===undefined||v===''||!Number.isFinite(Number(v)))?null:Number(v);
  const fmt=v=>n(v)==null?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dstr=raw=>{const d=String(raw||'').replace(/\D/g,'');return d.length===8?d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8):String(raw||'');};
  function normalize(source){
    const map=new Map();
    for(const v of Array.isArray(source)?source:[]){
      const date=String(v?.date||'');
      if(!/^\d{8}$/.test(date))continue;
      const close=n(v.close);
      if(close==null||close<=0)continue;
      map.set(date,{date,time:dstr(date),open:n(v.open),high:n(v.high),low:n(v.low),close,volume:n(v.volume)});
    }
    return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  const valid=b=>b.open>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close);
  function average(all,p){
    let sum=0;const out=[];
    for(let i=0;i<all.length;i++){
      sum+=all[i].close;
      if(i>=p)sum-=all[i-p].close;
      if(i>=p-1)out.push({time:all[i].time,value:Math.round(sum/p*100)/100});
    }
    return out;
  }
  function render(source,fib,options={}){
    const range=String(options.range||'252');
    const all=normalize(source),selected=all.slice(range==='all'?0:-(Number(range)||252));
    const complete=selected.filter(valid).length,ready=selected.length>1&&complete>=Math.ceil(.90*selected.length);
    const last=all.at(-1);
    const period=range==='252'?'1 YEAR':range==='all'?'ALL':range==='132'?'6 MONTHS':range==='66'?'3 MONTHS':'1 MONTH';
    const controls=choices.map(pair=>'<button class="ksr-range'+(range===pair[0]?' active':'')+
      '" type="button" data-chart-range="'+pair[0]+'" aria-pressed="'+(range===pair[0])+'">'+pair[1]+'</button>').join('');
    const header='<header class="ksr-head"><div><small>PRICE ACTION / '+period+'</small>'+
      '<h3>'+safe(options.name||'종목')+' <span>'+safe(options.ticker||'')+'</span></h3></div>'+
      '<div class="ksr-controls">'+controls+'</div></header>'+
      '<div class="ksr-key"><span><i class="ksr-up"></i>양봉</span><span><i class="ksr-down"></i>음봉</span>'+
      '<span class="ksr-key10">━ MA10</span><span class="ksr-key20">━ MA20</span></div>';
    if(!ready){
      return '<section class="ksr-chart" id="ksrChart">'+header+
        '<div class="ksr-need"><strong>이 종목은 실제 캔들용 시가 데이터가 없습니다.</strong>'+
        '<p>파일 기준 '+safe(dstr(last?.date))+' · 캔들 구성 가능 '+complete+'/'+selected.length+'개 일봉</p>'+
        '<p>키움 등록 PC에서 아래 명령으로 관심종목 JSON을 재수집한 다음 파일을 다시 불러와 주세요.</p>'+
        '<code>powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\export-watchlist.ps1</code>'+
        '<p>종가선으로 대체하거나 가짜 캔들을 생성하지 않습니다.</p></div></section>';
    }
    if(!L()?.createChart){
      return '<div class="ksr-note">전문 차트 라이브러리를 불러오지 못해 기본 캔들로 표시합니다.</div>'+
        (legacy?.render?legacy.render(source,fib,{...options,range}):
          '<div class="ksr-need">차트 모듈을 연결할 수 없습니다.</div>');
    }
    return '<section class="ksr-chart" id="ksrChart">'+header+
      '<div class="ksr-shell"><div id="ksrCanvas" class="ksr-canvas" aria-label="1년 일봉 캔들, MA10, MA20 및 거래량 차트"></div>'+
      '<div id="ksrTooltip" class="ksr-tooltip" hidden></div></div>'+
      '<footer class="ksr-footer"><span>키움 ka10081 · 일봉 '+safe(dstr(last?.date))+
      ' · 보유 '+all.length+'거래일</span><span>피보나치 0.236·0.382 가격은 상단 분석표에서 확인</span></footer></section>';
  }
  function destroy(root){
    const instance=instances.get(root);
    if(instance){try{instance.remove();}catch(err){console.warn('Chart cleanup failed',err);}instances.delete(root);}
  }
  function bind(root,source,options={}){
    const node=root?.querySelector('#ksrCanvas');
    if(!node){if(root?.querySelector('#kcsChart'))legacy?.bind?.(root,source,options);return;}
    destroy(root);
    const lib=L();
    if(!lib?.CandlestickSeries || !lib?.LineSeries || !lib?.HistogramSeries)return;
    const all=normalize(source),candles=all.filter(valid);
    if(candles.length<2)return;
    let chart;
    try{
      chart=lib.createChart(node,{
        autoSize:true,
        layout:{background:{type:'solid',color:'#131d30'},textColor:'#8b9eb8',
          fontFamily:'Arial, sans-serif',fontSize:12,attributionLogo:true,
          panes:{separatorColor:'#b7c6d9',separatorHoverColor:'#d4e0ef'}},
        grid:{vertLines:{color:'#26354e'},horzLines:{color:'#26354e'}},
        rightPriceScale:{visible:true,borderVisible:false,
          scaleMargins:{top:.08,bottom:.06}},
        leftPriceScale:{visible:false},
        timeScale:{borderColor:'#2b3e58',timeVisible:false,secondsVisible:false,
          barSpacing:3.8,rightOffset:4,minBarSpacing:1.5},
        localization:{locale:'ko-KR',
          priceFormatter:price=>Number(price).toLocaleString('ko-KR',{maximumFractionDigits:2})}
      });
      const candle=chart.addSeries(lib.CandlestickSeries,{
        upColor:'#f17181',downColor:'#5899e8',borderVisible:false,
        wickUpColor:'#f17181',wickDownColor:'#5899e8',
        priceLineVisible:true,lastValueVisible:true
      });
      candle.setData(candles.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
      const ten=chart.addSeries(lib.LineSeries,{color:'#7eaeff',lineWidth:2,
        lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false});
      ten.setData(average(all,10));
      const twenty=chart.addSeries(lib.LineSeries,{color:'#f5c25e',lineWidth:2.5,
        lastValueVisible:false,priceLineVisible:false,crosshairMarkerVisible:false});
      twenty.setData(average(all,20));
      const volume=chart.addSeries(lib.HistogramSeries,{
        priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false
      },1);
      const volumeRows=all.filter(b=>b.volume!=null&&b.volume>=0).map(b=>({
        time:b.time,value:b.volume,color:b.open!=null&&b.close>=b.open?
          'rgba(241,113,129,.62)':'rgba(88,153,232,.65)'
      }));
      if(volumeRows.length)volume.setData(volumeRows);
      else node.insertAdjacentHTML('beforeend','<div class="ksr-no-volume">거래량 미수집 · 재수집 필요</div>');
      try{
        const panes=chart.panes();
        if(panes?.length>1){panes[0].setHeight(414);panes[1].setHeight(105);}
      }catch(err){console.warn('Default pane heights used',err);}
      const count=options.range==='all'?candles.length:(Number(options.range)||252);
      const last=candles.length-1;
      chart.timeScale().setVisibleLogicalRange({from:Math.max(-2,last-count+1),to:last+3});
      const tip=root.querySelector('#ksrTooltip');
      chart.subscribeCrosshairMove(param=>{
        if(!tip)return;
        if(!param?.time||!param?.point){tip.hidden=true;return;}
        const time=typeof param.time==='string'?param.time:
          String(param.time.year)+'-'+String(param.time.month).padStart(2,'0')+'-'+String(param.time.day).padStart(2,'0');
        if(!param.seriesData?.get(candle)){tip.hidden=true;return;}
        const day=all.find(b=>b.time===time);
        if(!day){tip.hidden=true;return;}
        tip.innerHTML='<b>'+safe(time)+'</b>'+
          '<span>시가 <strong>'+fmt(day.open)+'</strong></span>'+
          '<span>고가 <strong>'+fmt(day.high)+'</strong></span>'+
          '<span>저가 <strong>'+fmt(day.low)+'</strong></span>'+
          '<span>종가 <strong>'+fmt(day.close)+'</strong></span>'+
          '<span>거래량 <strong>'+fmt(day.volume)+'주</strong></span>';
        tip.style.left=Math.max(6,Math.min(node.clientWidth-170,param.point.x+15))+'px';
        tip.style.top=Math.max(12,Math.min(430,param.point.y-95))+'px';
        tip.hidden=false;
      });
      instances.set(root,chart);
    }catch(err){
      try{chart?.remove();}catch(ignore){}
      node.innerHTML='<div class="ksr-error">전문 차트를 표시하지 못했습니다. 새로고침해 주세요.</div>';
      console.error('K scanner chart error',err);
    }
  }
  window.MoneyFlowChart={render,bind,destroy,normalize,version:'3.6-tv'};
})();
