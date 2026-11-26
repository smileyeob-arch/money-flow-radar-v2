'use strict';
/* Self-contained, read-only SVG stock chart. Never synthesizes OHLCV values. */
(() => {
  const W=1080, XL=55, XR=952;
  const panes={price:[32,322],volume:[332,410],rsi:[423,493],macd:[510,580]};
  const maColors={10:'#facc15',20:'#fb923c',60:'#38bdf8',120:'#b084f9'};
  const bull='#ff6175',bear='#4a9ce8',neutral='#a9b9d1';
  const ranges=[['22','1개월'],['66','3개월'],['132','6개월'],['all','전체']];
  const num=v=>{
    if(v===null||v===undefined||v==='')return null;
    const n=Number(v);return Number.isFinite(n)?n:null;
  };
  const fmt=(v,max=0)=>num(v)==null?'—':num(v).toLocaleString('ko-KR',{maximumFractionDigits:max});
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const round=n=>Number(n.toFixed(2));
  const xAt=(i,count)=>XL+(count<2?0:i/(count-1)*(XR-XL));
  const yOn=(n,domain,pane)=>{
    const [min,max]=domain,[top,bottom]=pane;
    return bottom-(n-min)/(max-min)*(bottom-top);
  };
  const shortDate=v=>{
    const d=String(v??'').replace(/\D/g,'');
    return d.length===8?d.slice(4,6)+'.'+d.slice(6,8):String(v??'');
  };
  const longDate=v=>{
    const d=String(v??'').replace(/\D/g,'');
    return d.length===8?d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8):String(v??'');
  };
  function normalize(bars){
    const byDate=new Map();
    (Array.isArray(bars)?bars:[]).forEach(b=>{
      if(!b||!/^\d{8}$/.test(String(b.date??'')))return;
      const close=num(b.close),open=num(b.open),high=num(b.high),low=num(b.low),volume=num(b.volume);
      if(close==null||close<=0)return;
      byDate.set(String(b.date),{
        date:String(b.date),close,
        open:open!=null&&open>0?open:null,
        high:high!=null&&high>0?high:null,
        low:low!=null&&low>0?low:null,
        volume:volume!=null&&volume>=0?volume:null
      });
    });
    return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  function sma(values,p){
    const result=Array(values.length).fill(null);
    let sum=0;
    for(let i=0;i<values.length;i++){
      sum+=values[i];
      if(i>=p)sum-=values[i-p];
      if(i>=p-1)result[i]=sum/p;
    }
    return result;
  }
  function ema(values,p){
    const result=Array(values.length).fill(null);
    if(values.length<p)return result;
    const k=2/(p+1);
    result[p-1]=values.slice(0,p).reduce((a,b)=>a+b,0)/p;
    for(let i=p;i<values.length;i++)result[i]=values[i]*k+result[i-1]*(1-k);
    return result;
  }
  function rsi(values,p=14){
    const out=Array(values.length).fill(null);
    if(values.length<=p)return out;
    let gains=0,losses=0;
    for(let i=1;i<=p;i++){
      const d=values[i]-values[i-1];
      gains+=Math.max(0,d);losses+=Math.max(0,-d);
    }
    gains/=p;losses/=p;
    const indexValue=()=>gains===0&&losses===0?50:losses===0?100:100-100/(1+gains/losses);
    out[p]=indexValue();
    for(let i=p+1;i<values.length;i++){
      const d=values[i]-values[i-1];
      gains=(gains*(p-1)+Math.max(0,d))/p;
      losses=(losses*(p-1)+Math.max(0,-d))/p;
      out[i]=indexValue();
    }
    return out;
  }
  function macd(values){
    const a=ema(values,12),b=ema(values,26),line=Array(values.length).fill(null);
    for(let i=0;i<values.length;i++)if(a[i]!=null&&b[i]!=null)line[i]=a[i]-b[i];
    const tail=line.filter(x=>x!=null),signalTail=ema(tail,9);
    const signal=Array(values.length).fill(null),hist=Array(values.length).fill(null);
    let ptr=0;
    for(let i=0;i<line.length;i++)if(line[i]!=null){
      signal[i]=signalTail[ptr++];
      if(signal[i]!=null)hist[i]=line[i]-signal[i];
    }
    return {line,signal,hist};
  }
  const path=(series,domain,pane)=>{
    let s='',drawing=false;
    series.forEach((v,i)=>{
      if(v==null||!Number.isFinite(v)){drawing=false;return;}
      s+=(drawing?' L ':' M ')+round(xAt(i,series.length))+' '+round(yOn(v,domain,pane));
      drawing=true;
    });
    return s.trim();
  };
  const line=(x1,y1,x2,y2,cls)=>'<line class="'+cls+'" x1="'+round(x1)+'" y1="'+round(y1)+
    '" x2="'+round(x2)+'" y2="'+round(y2)+'"/>';
  function render(sourceBars, fib, opts={}){
    const all=normalize(sourceBars);
    const range=String(opts.range??'66');
    const count=range==='all'?all.length:Math.min(all.length,Number(range)||66);
    const start=all.length-count,selected=all.slice(start);
    if(selected.length<2)return '<div class="mfr-empty">일봉 데이터가 부족해 차트를 표시할 수 없습니다.</div>';
    const fullClose=all.map(x=>x.close);
    const ma={},periods=[10,20,60,120];
    periods.forEach(p=>ma[p]=sma(fullClose,p).slice(start));
    const rsiData=rsi(fullClose).slice(start),m=macd(fullClose);
    const macdValues={line:m.line.slice(start),signal:m.signal.slice(start),hist:m.hist.slice(start)};
    const candleReady=selected.some(b=>
      b.open!=null&&b.high!=null&&b.low!=null&&
      b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close));
    const volumeReady=selected.some(b=>b.volume!=null);
    const levels=['0.236','0.382','0.5','0.618'].map(key=>({key,price:num(fib?.[key])})).filter(x=>x.price>0);
    const values=[...selected.flatMap(b=>[b.low,b.high,b.close].filter(v=>v!=null)),...levels.map(x=>x.price)];
    const min=Math.min(...values),max=Math.max(...values),padding=Math.max(1,(max-min)*.07);
    const priceDomain=[min-padding,max+padding],priceY=v=>yOn(v,priceDomain,panes.price);
    const maxVolume=Math.max(1,...selected.map(b=>b.volume||0));
    const allMacd=[...macdValues.line,...macdValues.signal,...macdValues.hist].filter(x=>x!=null);
    const extent=Math.max(1,...allMacd.map(Math.abs))*1.2,macdDomain=[-extent,extent];
    const [pt,pb]=panes.price,[vt,vb]=panes.volume,[rt,rb]=panes.rsi,[mt,mb]=panes.macd;
    const xstep=(XR-XL)/(selected.length-1),barWidth=Math.max(2,Math.min(11,xstep*.62));
    let svg='<svg id="mfrAdvancedSvg" class="mfr-svg" viewBox="0 0 '+W+' 626" role="img" '+
      'aria-label="실제 일봉 시세의 캔들 또는 종가 그래프, 이동평균선, 피보나치, 거래량, RSI 및 MACD">'+
      '<defs><linearGradient id="mfrBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#142644"/>'+
      '<stop offset="1" stop-color="#07142a"/></linearGradient>'+
      '<linearGradient id="mfrArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#45b3e2" stop-opacity=".32"/>'+
      '<stop offset="1" stop-color="#45b3e2" stop-opacity=".02"/></linearGradient></defs>'+
      '<rect x="0" y="0" width="'+W+'" height="626" rx="13" fill="url(#mfrBg)"/>';
    for(const [name,[a,b]] of Object.entries(panes)){
      svg+='<rect x="'+XL+'" y="'+a+'" width="'+(XR-XL)+'" height="'+(b-a)+
        '" fill="#11223d" opacity="'+(name==='price'?'.65':'.5')+'"/>';
    }
    const tickValues=Array.from({length:6},(_,i)=>priceDomain[1]-i*(priceDomain[1]-priceDomain[0])/5);
    for(const v of tickValues){
      const y=priceY(v);
      svg+=line(XL,y,XR,y,'mfr-grid')+'<text class="mfr-axis" x="'+(XR+11)+'" y="'+round(y+4)+'">'+fmt(v)+'</text>';
    }
    const xTickCount=Math.min(6,selected.length),tickIndices=new Set(Array.from({length:xTickCount},(_,i)=>
      Math.round(i*(selected.length-1)/Math.max(1,xTickCount-1))));
    for(const i of tickIndices){
      const x=xAt(i,selected.length);
      svg+=line(x,pt,x,mb,'mfr-vertical')+'<text class="mfr-axis" text-anchor="middle" x="'+
        round(x)+'" y="610">'+safe(shortDate(selected[i].date))+'</text>';
    }
    if(levels.length){
      const hi=levels.find(x=>x.key==='0.236'),lo=levels.find(x=>x.key==='0.382');
      if(hi&&lo){const y1=priceY(hi.price),y2=priceY(lo.price);
        svg+='<rect x="'+XL+'" y="'+round(Math.min(y1,y2))+'" width="'+(XR-XL)+
          '" height="'+round(Math.abs(y1-y2))+'" fill="#2ee2b9" opacity=".065"/>';
      }
      for(const l of levels){
        const y=priceY(l.price);
        svg+=line(XL,y,XR,y,'mfr-fib'+(l.key==='0.382'?' mfr-fib-primary':''))+
          '<text class="mfr-fib-label'+(l.key==='0.382'?' primary':'')+
          '" x="'+(XR+10)+'" y="'+round(y-6)+'">F'+l.key+'</text>'+
          '<text class="mfr-fib-value" x="'+(XR+10)+'" y="'+round(y+8)+'">'+fmt(l.price)+'</text>';
      }
    }
    if(candleReady){
      selected.forEach((b,i)=>{
        if(b.open==null||b.high==null||b.low==null||
          b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))return;
        const x=xAt(i,selected.length);
        const color=b.close>b.open?bull:b.close<b.open?bear:neutral;
        const top=priceY(Math.max(b.open,b.close)),bottom=priceY(Math.min(b.open,b.close));
        svg+='<line x1="'+round(x)+'" y1="'+round(priceY(b.high))+
          '" x2="'+round(x)+'" y2="'+round(priceY(b.low))+
          '" stroke="'+color+'" stroke-width="1.4"/>'+
          '<rect x="'+round(x-barWidth/2)+'" y="'+round(top)+'" width="'+round(barWidth)+
          '" height="'+round(Math.max(1.5,bottom-top))+'" fill="'+color+'" rx=".6"/>';
      });
    }else{
      const closePath=path(selected.map(x=>x.close),priceDomain,panes.price);
      const firstX=xAt(0,selected.length),lastX=xAt(selected.length-1,selected.length);
      svg+='<path d="'+closePath+' L '+round(lastX)+' '+pb+' L '+round(firstX)+' '+pb+
        ' Z" fill="url(#mfrArea)"/><path d="'+closePath+'" class="mfr-close-line"/>';
    }
    for(const p of periods){
      const d=path(ma[p],priceDomain,panes.price);
      if(d)svg+='<path class="mfr-ma-line" d="'+d+'" stroke="'+maColors[p]+'"/>';
    }
    if(volumeReady){
      selected.forEach((b,i)=>{
        if(b.volume==null)return;
        const x=xAt(i,selected.length),height=(b.volume/maxVolume)*(vb-vt-5);
        const color=b.open!=null?(b.close>=b.open?bull:bear):
          (i>0&&b.close>=selected[i-1].close?bull:bear);
        svg+='<rect x="'+round(x-barWidth/2)+'" y="'+round(vb-height)+'" width="'+
          round(barWidth)+'" height="'+round(Math.max(1,height))+'" fill="'+color+'" opacity=".72"/>';
      });
      svg+='<text class="mfr-axis" x="'+(XR+11)+'" y="'+(vt+11)+'">'+fmt(maxVolume)+'</text>';
    }else{
      svg+='<text class="mfr-no-data" x="'+(XL+30)+'" y="'+((vt+vb)/2)+'">거래량 미수집 · 일봉 재수집 필요</text>';
    }
    for(const v of [30,50,70]){
      const y=yOn(v,[0,100],panes.rsi);
      svg+=line(XL,y,XR,y,'mfr-grid'+(v===50?'': ' mfr-guide'))+
        '<text class="mfr-axis" x="'+(XR+11)+'" y="'+round(y+4)+'">'+v+'</text>';
    }
    const rsiPath=path(rsiData,[0,100],panes.rsi);
    if(rsiPath)svg+='<path d="'+rsiPath+'" stroke="#d69dff" class="mfr-indicator-line"/>';
    svg+=line(XL,yOn(0,macdDomain,panes.macd),XR,yOn(0,macdDomain,panes.macd),'mfr-zero');
    const zero=yOn(0,macdDomain,panes.macd);
    macdValues.hist.forEach((v,i)=>{
      if(v==null)return;
      const y=yOn(v,macdDomain,panes.macd);
      svg+='<rect x="'+round(xAt(i,selected.length)-barWidth/2)+'" y="'+round(Math.min(y,zero))+
        '" width="'+round(barWidth)+'" height="'+round(Math.max(1,Math.abs(zero-y)))+
        '" fill="'+(v>=0?'#45dac7':'#ff6175')+'" opacity=".75"/>';
    });
    const mline=path(macdValues.line,macdDomain,panes.macd),
      sline=path(macdValues.signal,macdDomain,panes.macd);
    if(mline)svg+='<path class="mfr-indicator-line" d="'+mline+'" stroke="#3ab4ff"/>';
    if(sline)svg+='<path class="mfr-indicator-line" d="'+sline+'" stroke="#fca45a"/>';
    for(const [name,y] of [['거래량',vt+11],['RSI (14)',rt+11],['MACD',mt+11]])
      svg+='<text class="mfr-panel-name" x="'+(XL+7)+'" y="'+y+'">'+safe(name)+'</text>';
    svg+='<g id="mfrCross" visibility="hidden">'+line(XL,pt,XL,mb,'mfr-cross')+
      '<line id="mfrHoverVertical" class="mfr-cross" x1="'+XL+'" x2="'+XL+'" y1="'+pt+'" y2="'+mb+'"/>'+
      '<line id="mfrHoverHorizontal" class="mfr-cross" x1="'+XL+'" x2="'+XR+'" y1="'+pt+'" y2="'+pt+'"/>'+
      '<circle id="mfrHoverDot" cx="'+XL+'" cy="'+pt+'" r="4.8" class="mfr-hover-dot"/></g></svg>';
    const last=selected.at(-1),prev=all[start+selected.length-2];
    const change=prev?(last.close/prev.close-1)*100:null;
    const status=candleReady?'실제 시가·고가·저가·종가':'종가선 (시가 정보 없음)';
    const volLegend=volumeReady?'실제 거래량':'거래량 데이터 없음';
    const legend=['MA10','MA20','MA60','MA120'].map((v,i)=>'<span class="mfr-legend"><i style="--line-color:'+
      maColors[periods[i]]+'"></i>'+v+' <b>'+fmt(ma[periods[i]].at(-1))+'</b></span>').join('');
    const tools=ranges.map(([k,label])=>'<button type="button" data-chart-range="'+k+
      '" class="mfr-range'+(k===range?' active':'')+'" aria-pressed="'+(k===range)+
      '">'+label+'</button>').join('');
    return '<div id="mfrChart" class="mfr-chart">'+
      '<div class="mfr-chart-top"><div class="mfr-quote"><div class="mfr-quote-title">'+
      safe(opts.name||'종목')+' <span>일봉 · '+safe(longDate(last.date))+'</span></div>'+
      '<strong>'+fmt(last.close)+'원</strong><span class="mfr-change '+(change>=0?'positive':'negative')+
      '">'+(change==null?'':(change>=0?'+':'')+fmt(change,2)+'%')+'</span></div>'+
      '<div class="mfr-range-bar" role="group" aria-label="가격 차트 기간">'+tools+'</div></div>'+
      '<div class="mfr-key-row"><span><i class="mfr-up-dot"></i>상승</span>'+
      '<span><i class="mfr-down-dot"></i>하락</span>'+legend+'</div>'+
      '<div class="mfr-plot-container">'+svg+
      '<div id="mfrTooltip" class="mfr-tooltip" hidden></div></div>'+
      '<div class="mfr-data-note">'+safe(status)+' · '+safe(volLegend)+
      ' · 최근 '+selected.length+'거래일 · RSI(14)·MACD(12,26,9)'+
      (!candleReady?' · 캔들을 보려면 새 키움 관심종목 파일을 수집하세요.':'')+
      '</div></div>';
  }
  function bind(root,sourceBars,opts={}){
    const shell=root?.querySelector('#mfrChart'),svg=shell?.querySelector('#mfrAdvancedSvg');
    if(!shell||!svg)return;
    const all=normalize(sourceBars),range=String(opts.range??'66');
    const selected=all.slice(range==='all'?0:-Math.min(all.length,Number(range)||66));
    if(selected.length<2)return;
    const vals=selected.map(x=>x.close),top=panes.price[0],bottom=panes.price[1];
    const levels=['0.236','0.382','0.5','0.618'].map(k=>num(opts.fib?.[k])).filter(x=>x>0);
    const highs=selected.flatMap(x=>[x.high,x.low,x.close].filter(x=>x!=null));
    const min=Math.min(...highs,...levels),max=Math.max(...highs,...levels),padding=Math.max(1,(max-min)*.07);
    const domain=[min-padding,max+padding],priceY=v=>yOn(v,domain,panes.price);
    const cursor=shell.querySelector('#mfrCross'),crossV=shell.querySelector('#mfrHoverVertical'),
      crossH=shell.querySelector('#mfrHoverHorizontal'),dot=shell.querySelector('#mfrHoverDot'),
      tip=shell.querySelector('#mfrTooltip');
    const rsiValues=rsi(all.map(x=>x.close)).slice(-selected.length);
    const hide=()=>{cursor?.setAttribute('visibility','hidden');if(tip)tip.hidden=true;};
    const handle=e=>{
      const rect=svg.getBoundingClientRect();
      if(!rect.width)return;
      const pos=(e.clientX-rect.left)/rect.width*W;
      if(pos<XL||pos>XR){hide();return;}
      const ix=Math.max(0,Math.min(selected.length-1,Math.round((pos-XL)/(XR-XL)*(selected.length-1))));
      const b=selected[ix],x=xAt(ix,selected.length),y=priceY(b.close);
      cursor?.setAttribute('visibility','visible');
      crossV?.setAttribute('x1',round(x));crossV?.setAttribute('x2',round(x));
      crossH?.setAttribute('y1',round(y));crossH?.setAttribute('y2',round(y));
      dot?.setAttribute('cx',round(x));dot?.setAttribute('cy',round(y));
      const vol=b.volume==null?'—':fmt(b.volume)+'주';
      tip.innerHTML='<b>'+safe(longDate(b.date))+'</b>'+
        '<span>시가 <strong>'+fmt(b.open)+'</strong></span>'+
        '<span>고가 <strong>'+fmt(b.high)+'</strong></span>'+
        '<span>저가 <strong>'+fmt(b.low)+'</strong></span>'+
        '<span>종가 <strong>'+fmt(b.close)+'</strong></span>'+
        '<span>거래량 <strong>'+vol+'</strong></span>'+
        '<span>RSI(14) <strong>'+fmt(rsiValues[ix],1)+'</strong></span>';
      tip.hidden=false;
      tip.style.left=Math.max(8,Math.min(shell.clientWidth-165,x/W*rect.width+10))+'px';
      tip.style.top=Math.max(20,Math.min(rect.height-20,y/626*rect.height+10))+'px';
    };
    svg.addEventListener('pointermove',handle);
    svg.addEventListener('pointerdown',handle);
    svg.addEventListener('pointerleave',hide);
  }
  window.MoneyFlowChart={render,bind,normalize,indicators:{sma,rsi,macd},version:'3.4'};
})();
