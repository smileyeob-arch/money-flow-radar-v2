'use strict';
/* K차트스캐너 visual style: daily candlesticks, MA5/10/20/60/120, volume.
   Fibonacci is a 0.236-0.382 lower-zone highlight only: no numbers on chart.
   Read-only technical visualization; never invent missing OHLCV observations. */
(() => {
  const W=1080,H=555,XL=60,XR=966,PT=37,PB=417,VT=428,VB=510;
  const maSpec=[
    {period:5,color:'#f2f5ff'},
    {period:10,color:'#377ff6'},
    {period:20,color:'#ffd02e'},
    {period:60,color:'#16bf6e'},
    {period:120,color:'#a35edd'}
  ];
  const UP='#ff5267',DOWN='#4387ed',EVEN='#9ab0c6';
  const ranges=[['22','1개월'],['66','3개월'],['132','6개월'],['all','전체']];
  const n=v=>{
    if(v==null||v==='')return null;
    const x=Number(v);return Number.isFinite(x)?x:null;
  };
  const fmt=(v,d=0)=>n(v)==null?'—':n(v).toLocaleString('ko-KR',{maximumFractionDigits:d});
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const R=v=>Math.round(v*100)/100;
  const dateText=(value,full=false)=>{
    const raw=String(value??'').replace(/\D/g,'');
    if(raw.length!==8)return String(value??'');
    return full?raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8):
      Number(raw.slice(4,6))+'/'+Number(raw.slice(6,8));
  };
  function normalize(source){
    const dates=new Map();
    for(const b of (Array.isArray(source)?source:[])){
      if(!b||!/^\d{8}$/.test(String(b.date??'')))continue;
      const close=n(b.close),open=n(b.open),high=n(b.high),low=n(b.low),volume=n(b.volume);
      if(close==null||close<=0)continue;
      dates.set(String(b.date),{
        date:String(b.date),close,
        open:open!=null&&open>0?open:null,
        high:high!=null&&high>0?high:null,
        low:low!=null&&low>0?low:null,
        volume:volume!=null&&volume>=0?volume:null
      });
    }
    return [...dates.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  function sma(values,period){
    const result=Array(values.length).fill(null);
    let sum=0;
    for(let i=0;i<values.length;i++){
      sum+=values[i];
      if(i>=period)sum-=values[i-period];
      if(i>=period-1)result[i]=sum/period;
    }
    return result;
  }
  function rangeData(bars,range){
    const all=normalize(bars);
    const size=range==='all'?all.length:Math.min(all.length,Number(range)||66);
    const offset=all.length-size;
    const selected=all.slice(offset);
    const ma={};
    const closes=all.map(b=>b.close);
    for(const spec of maSpec)ma[spec.period]=sma(closes,spec.period).slice(offset);
    return {all,selected,ma};
  }
  const xPos=(i,count)=>XL+i/(Math.max(1,count-1))*(XR-XL);
  const yPos=(v,lo,hi)=>PB-(v-lo)/(hi-lo)*(PB-PT);
  function priceDomain(selected,ma,fib){
    const values=[];
    for(const b of selected){values.push(b.close);if(b.high!=null)values.push(b.high);if(b.low!=null)values.push(b.low);}
    for(const spec of maSpec)for(const v of ma[spec.period]||[])if(v!=null)values.push(v);
    const f236=n(fib?.['0.236']),f382=n(fib?.['0.382']);
    // Keep the reference-zone visible only when prices are in the visible vicinity;
    // never flatten a chart around a distant obsolete Fibonacci anchor.
    const realMin=Math.min(...values),realMax=Math.max(...values);
    if(f236>0&&f382>0){
      const span=Math.max(1,realMax-realMin);
      if(f236>=realMin-span*.20&&f236<=realMax+span*.20)values.push(f236);
      if(f382>=realMin-span*.20&&f382<=realMax+span*.20)values.push(f382);
    }
    const min=Math.min(...values),max=Math.max(...values);
    const pad=Math.max(1,(max-min)*.07);
    return [min-pad,max+pad];
  }
  function seriesPath(items,min,max){
    let d='',active=false;
    items.forEach((v,i)=>{
      if(v==null){active=false;return;}
      d+=(active?' L ':' M ')+R(xPos(i,items.length))+' '+R(yPos(v,min,max));
      active=true;
    });
    return d.trim();
  }
  const line=(x1,y1,x2,y2,cls)=>'<line class="'+cls+'" x1="'+R(x1)+'" y1="'+R(y1)+
    '" x2="'+R(x2)+'" y2="'+R(y2)+'"/>';
  function render(sourceBars,fib,opts={}){
    const range=String(opts.range??'66');
    const {all,selected,ma}=rangeData(sourceBars,range);
    if(selected.length<2)return '<div class="kcs-empty">조회 가능한 일봉이 부족합니다.</div>';
    const [min,max]=priceDomain(selected,ma,fib);
    const y=v=>yPos(v,min,max),xx=i=>xPos(i,selected.length);
    const step=(XR-XL)/Math.max(1,selected.length-1),bodyWidth=Math.max(2,Math.min(12,step*.66));
    const candles=selected.some(b=>b.open!=null&&b.high!=null&&b.low!=null&&
      b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close));
    const volumeExists=selected.some(b=>b.volume!=null);
    const maximumVolume=Math.max(1,...selected.map(b=>b.volume||0));
    const grad='<defs><linearGradient id="kcsChartBg" x1="0" y1="0" x2="0" y2="1">'+
      '<stop offset="0%" stop-color="#0b1e36"/><stop offset="100%" stop-color="#061528"/></linearGradient>'+
      '<linearGradient id="kcsLineArea" x1="0" y1="0" x2="0" y2="1">'+
      '<stop offset="0%" stop-color="#3f89f5" stop-opacity=".3"/>'+
      '<stop offset="100%" stop-color="#3f89f5" stop-opacity=".02"/></linearGradient>'+
      '<clipPath id="kcsPriceClip"><rect x="'+XL+'" y="'+PT+'" width="'+(XR-XL)+
      '" height="'+(PB-PT)+'"/></clipPath></defs>';
    let svg='<svg class="kcs-svg" id="kcsPriceSvg" viewBox="0 0 '+W+' '+H+
      '" role="img" aria-label="K차트스캐너형 가격 캔들, 5 10 20 60 120일 이동평균선과 거래량, 0.236에서 0.382까지 피보나치 하단 구간">'+grad+
      '<rect width="'+W+'" height="'+H+'" rx="13" fill="url(#kcsChartBg)"/>'+
      '<rect x="'+XL+'" y="'+PT+'" width="'+(XR-XL)+'" height="'+(PB-PT)+
      '" fill="#07182d" opacity=".64"/>';
    for(let j=0;j<=6;j++){
      const p=max-(max-min)*j/6,yp=y(p);
      svg+=line(XL,yp,XR,yp,'kcs-grid')+
        '<text class="kcs-axis" x="'+(XR+13)+'" y="'+R(yp+4)+'">'+fmt(p)+'</text>';
    }
    const tickCount=Math.min(7,selected.length);
    for(let j=0;j<tickCount;j++){
      const i=Math.round(j*(selected.length-1)/Math.max(1,tickCount-1));
      const xpos=xx(i);
      svg+=line(xpos,PT,xpos,VB,'kcs-vertical')+
        '<text class="kcs-axis" text-anchor="middle" x="'+R(xpos)+
        '" y="542">'+safe(dateText(selected[i].date))+'</text>';
    }
    // K차트스캐너 rule: shade only the 0.236-0.382 Fibonacci interval.
    const f236=n(fib?.['0.236']),f382=n(fib?.['0.382']);
    if(f236>0&&f382>0&&Math.abs(f236-f382)>0.001){
      const y1=y(f236),y2=y(f382),top=Math.min(y1,y2),bottom=Math.max(y1,y2);
      svg+='<g clip-path="url(#kcsPriceClip)"><rect class="kcs-fib-fill" x="'+XL+
        '" y="'+R(top)+'" width="'+(XR-XL)+'" height="'+R(bottom-top)+'"/>'+
        line(XL,y1,XR,y1,'kcs-fib-edge')+line(XL,y2,XR,y2,'kcs-fib-edge')+'</g>';
    }
    if(candles){
      selected.forEach((b,i)=>{
        if(b.open==null||b.high==null||b.low==null||
          b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))return;
        const color=b.close>b.open?UP:b.close<b.open?DOWN:EVEN;
        const xp=xx(i),yt=y(Math.max(b.open,b.close)),yb=y(Math.min(b.open,b.close));
        svg+='<line x1="'+R(xp)+'" y1="'+R(y(b.high))+'" x2="'+R(xp)+
          '" y2="'+R(y(b.low))+'" stroke="'+color+'" stroke-width="1.3"/>'+
          '<rect x="'+R(xp-bodyWidth/2)+'" y="'+R(yt)+'" width="'+R(bodyWidth)+
          '" height="'+R(Math.max(1.5,yb-yt))+'" fill="'+color+'" rx=".5"/>';
      });
    }else{
      const d=seriesPath(selected.map(b=>b.close),min,max);
      svg+='<path d="'+d+' L '+R(xx(selected.length-1))+' '+PB+' L '+XL+' '+PB+
        ' Z" fill="url(#kcsLineArea)"/><path d="'+d+'" class="kcs-close-line"/>';
    }
    // Moving averages always reflect the full source history, including bars
    // preceding the selected range; unavailable MAs are not synthesized.
    for(const spec of maSpec){
      const d=seriesPath(ma[spec.period],min,max);
      if(d)svg+='<path class="kcs-ma-line" d="'+d+'" stroke="'+spec.color+'"/>';
    }
    // Right-side current price and key MA10/MA20 badges as in K차트스캐너.
    const last=selected.at(-1),previous=selected.at(-2);
    const lastColor=last.open!=null?(last.close>=last.open?UP:DOWN):
      (last.close>=previous.close?UP:DOWN);
    const lastY=Math.min(PB-11,Math.max(PT+11,y(last.close)));
    svg+='<rect x="'+(XR+7)+'" y="'+R(lastY-11)+'" width="95" height="21" rx="4" fill="'+lastColor+'"/>'+
      '<text class="kcs-price-badge" x="'+(XR+54)+'" y="'+R(lastY+4)+'" text-anchor="middle">'+fmt(last.close)+'</text>';
    // Hide MA badges if they overlap the latest close label; the colored
    // moving-average legend still shows their exact values.
    for(const spec of maSpec.filter(x=>x.period===10||x.period===20)){
      const value=ma[spec.period].at(-1);
      if(value==null)continue;
      const yy=y(value);
      if(yy<PT+12||yy>PB-12||Math.abs(yy-lastY)<25)continue;
      svg+='<rect x="'+(XR+7)+'" y="'+R(yy-9)+'" width="95" height="18" rx="4" fill="'+spec.color+'"/>'+
        '<text class="kcs-ma-badge" x="'+(XR+54)+'" y="'+R(yy+4)+'" text-anchor="middle">'+
        spec.period+'일 '+fmt(value)+'</text>';
    }
    svg+=line(XL,VT-2,XR,VT-2,'kcs-volume-separator');
    if(volumeExists){
      selected.forEach((b,i)=>{
        if(b.volume==null)return;
        const xp=xx(i),vHeight=(b.volume/maximumVolume)*(VB-VT-8);
        const clr=b.open!=null?(b.close>=b.open?UP:DOWN):
          (i>0&&b.close>=selected[i-1].close?UP:DOWN);
        svg+='<rect x="'+R(xp-bodyWidth/2)+'" y="'+R(VB-vHeight)+'" width="'+
          R(bodyWidth)+'" height="'+R(Math.max(1,vHeight))+'" fill="'+clr+'" opacity=".88"/>';
      });
    }else svg+='<text x="'+(XL+20)+'" y="'+(VT+40)+'" class="kcs-empty-note">거래량 미수집 · 새 관심종목 파일로 갱신 가능</text>';
    svg+='<text x="'+(XL+6)+'" y="'+(VT+13)+'" class="kcs-volume-name">거래량</text>'+
      '<g id="kcsHoverCross" visibility="hidden">'+
      '<line id="kcsCrossVertical" class="kcs-cross" x1="'+XL+'" x2="'+XL+'" y1="'+PT+'" y2="'+VB+'"/>'+
      '<line id="kcsCrossHorizontal" class="kcs-cross" x1="'+XL+'" x2="'+XR+'" y1="'+PT+'" y2="'+PT+'"/>'+
      '<circle id="kcsCrossDot" class="kcs-dot" cx="'+XL+'" cy="'+PT+'" r="4.5"/></g></svg>';
    const diff=last.close-previous.close,change=previous.close?(last.close/previous.close-1)*100:null;
    const maLegend=maSpec.map(spec=>'<span class="kcs-legend-label"><i style="background:'+
      spec.color+'"></i>'+spec.period+' <b>'+fmt(ma[spec.period].at(-1))+'</b></span>').join('');
    const controls=ranges.map(([id,label])=>'<button type="button" class="kcs-range'+
      (id===range?' active':'')+'" data-chart-range="'+id+'" aria-pressed="'+(id===range)+'">'+label+'</button>').join('');
    return '<section class="kcs-chart" id="kcsChart">'+
      '<div class="kcs-header"><div class="kcs-price-title"><div><strong>'+
      safe(opts.name||'종목')+'</strong> <span>일봉 · '+safe(dateText(last.date,true))+'</span></div>'+
      '<div class="kcs-price-row"><b>'+fmt(last.close)+'</b><span class="'+
      (change!=null&&change>=0?'up':'down')+'">'+(diff>=0?'+':'')+fmt(diff)+
      ' ('+(change!=null&&change>=0?'+':'')+fmt(change,2)+'%)</span></div></div>'+
      '<div class="kcs-range-bar" role="group" aria-label="차트 기간 선택">'+controls+'</div></div>'+
      '<div class="kcs-legend"><span class="kcs-legend-title">이동평균선</span>'+
      maLegend+'</div><div class="kcs-plot">'+svg+
      '<div class="kcs-tooltip" id="kcsTooltip" hidden></div></div>'+
      '<div class="kcs-footer"><span class="kcs-candle-key"><i class="bull"></i>상승 <i class="bear"></i>하락</span>'+
      '<span class="kcs-fib-indicator"><i></i>피보나치 0.236~0.382 관심구간</span>'+
      '<span>'+selected.length+'거래일 · '+(candles?'실제 캔들':'구형 시세: 종가선')+
      ' · '+(volumeExists?'거래량':'거래량 없음')+'</span></div></section>';
  }
  function bind(root,sourceBars,opts={}){
    const host=root?.querySelector('#kcsChart'),svg=host?.querySelector('#kcsPriceSvg');
    if(!host||!svg)return;
    const range=String(opts.range??'66');
    const {selected,ma}=rangeData(sourceBars,range);
    if(selected.length<2)return;
    const [min,max]=priceDomain(selected,ma,opts.fib);
    const cross=host.querySelector('#kcsHoverCross'),crossV=host.querySelector('#kcsCrossVertical'),
      crossH=host.querySelector('#kcsCrossHorizontal'),dot=host.querySelector('#kcsCrossDot'),
      tip=host.querySelector('#kcsTooltip');
    const close=()=>{cross?.setAttribute('visibility','hidden');if(tip)tip.hidden=true;};
    function move(event){
      const bounds=svg.getBoundingClientRect();
      if(!bounds.width)return;
      const x=(event.clientX-bounds.left)/bounds.width*W;
      if(x<XL||x>XR){close();return;}
      const i=Math.max(0,Math.min(selected.length-1,Math.round((x-XL)/(XR-XL)*(selected.length-1))));
      const b=selected[i],px=xPos(i,selected.length),py=yPos(b.close,min,max);
      cross?.setAttribute('visibility','visible');
      crossV?.setAttribute('x1',R(px));crossV?.setAttribute('x2',R(px));
      crossH?.setAttribute('y1',R(py));crossH?.setAttribute('y2',R(py));
      dot?.setAttribute('cx',R(px));dot?.setAttribute('cy',R(py));
      if(!tip)return;
      tip.innerHTML='<strong>'+safe(dateText(b.date,true))+'</strong>'+
        '<span>시가 <b>'+fmt(b.open)+'</b></span>'+
        '<span>고가 <b>'+fmt(b.high)+'</b></span>'+
        '<span>저가 <b>'+fmt(b.low)+'</b></span>'+
        '<span>종가 <b>'+fmt(b.close)+'</b></span>'+
        '<span>거래량 <b>'+ (b.volume==null?'—':fmt(b.volume)+'주')+'</b></span>'+
        '<span>10일선 <b>'+fmt(ma[10][i])+'</b></span>'+
        '<span>20일선 <b>'+fmt(ma[20][i])+'</b></span>';
      tip.hidden=false;
      tip.style.left=Math.max(8,Math.min(host.clientWidth-168,px/W*bounds.width+12))+'px';
      tip.style.top=Math.max(24,Math.min(bounds.height-20,py/H*bounds.height+6))+'px';
    }
    svg.addEventListener('pointermove',move);
    svg.addEventListener('pointerdown',move);
    svg.addEventListener('pointerleave',close);
  }
  window.MoneyFlowChart={render,bind,normalize,indicators:{sma},version:'3.5-kcs'};
})();
