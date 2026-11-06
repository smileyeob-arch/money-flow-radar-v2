'use strict';
/* Read-only 90-day watch dashboard. No trading, background alerts, or broker credentials. */
(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const fmt = (v, d=0) => v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' :
    Number(v).toLocaleString('ko-KR',{maximumFractionDigits:d});
  const pc = v => v == null ? '—' : (v>0?'+':'')+fmt(v,2)+'%';
  const koreanDate = v => v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(5).replace('-','/') : (v||'—');
  let data = null, chosen = null, filter = 'all';
  const priority = {confluence:0,ma20:1,fib:2,fib_watch:3,waiting:4,risk:5,unknown:6};
  const keyLabel = {confluence:'중첩 관심',ma20:'20일선 관심',fib:'0.382 관심',
    fib_watch:'0.236 관찰',waiting:'눌림 대기',risk:'이탈 주의',unknown:'데이터 확인'};
  function statusPill(s) {const k = priority[s.status_key]===undefined?'unknown':s.status_key;
    return '<span class="radar-pill radar-'+k+'">'+safe(s.status||keyLabel[k])+'</span>';}
  function showMarket(view) {
    const active = view === 'radar';
    $('radarPanel').classList.toggle('hidden',!active);
    document.querySelector('.workspace').classList.toggle('hidden',active);
    if(active)render();
  }
  document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click',()=>showMarket(b.dataset.view)));
  $('radarStatusFilter').addEventListener('change',e=>{filter=e.target.value;render();});
  $('radarRefresh').addEventListener('click',()=>loadRadar());
  function renderEvents() {
    const events = Array.isArray(data.events)?data.events:[];
    const area = $('radarEvents');
    if(!events.length) {area.innerHTML='<p class="radar-empty">아직 확정된 주도 테마 기록이 없습니다. 장 마감 후 로컬 수집을 실행하면 누적됩니다.</p>';return;}
    area.innerHTML=events.slice(0,45).map(e=>{
      const names=(e.picks||[]).map(x=>safe(x.name)).join(' · ');
      return '<article class="radar-event"><div class="radar-event-main"><b>'+safe(koreanDate(e.date))+
      '</b><span class="radar-rank">'+fmt(e.rank)+'위</span><strong>'+safe(e.theme)+
      '</strong></div><div class="radar-event-sub">감시종목 평균 '+pc(e.avg_change_pct)+
      ' · 상승 '+fmt(e.up_count)+'/'+fmt(e.member_count)+' · 종목: '+(names||'없음')+'</div></article>';
    }).join('');
  }
  function renderList() {
    const stocks=Array.isArray(data.tracked)?data.tracked:[];
    const chosenStocks=stocks.filter(x=>filter==='all'||x.status_key===filter)
      .sort((a,b)=>(priority[a.status_key]??6)-(priority[b.status_key]??6)||b.first_seen.localeCompare(a.first_seen));
    $('radarCount').textContent=stocks.length+'종목';
    $('radarCandidates').innerHTML=chosenStocks.length?chosenStocks.map(x=>
      '<button type="button" class="radar-candidate'+(chosen===x.ticker?' selected':'')+
      '" data-radar-ticker="'+safe(x.ticker)+'"><span class="radar-candidate-title"><strong>'+
      safe(x.name)+'</strong>'+statusPill(x)+'</span><span class="radar-sub">'+
      safe(x.ticker)+' · '+safe(x.first_theme)+' ('+fmt(x.first_rank)+'위) · 최초 '+safe(x.first_seen)+
      '</span><span class="radar-sub">종가 '+fmt(x.close)+'원 · MA20 '+fmt(x.ma20)+
      '원 · 피보 0.382 '+fmt(x.fib?.['0.382'])+'원</span></button>').join(''):
      '<p class="radar-empty">조건에 맞는 관심종목이 없습니다.</p>';
    const exists=stocks.some(x=>x.ticker===chosen);
    if(!exists)chosen=stocks[0]?.ticker||null;
    renderDetail();
  }
  function svgChart(bars, fib) {
    const good=(bars||[]).filter(x=>Number(x.close)>0&&x.date).slice(-70);
    if(good.length<2)return '<p class="radar-empty">차트 데이터를 확보하지 못했습니다.</p>';
    const x0=47,x1=738,y0=20,y1=224;
    const points=good.map(x=>Number(x.close));
    const ma=good.map((_,i)=>i>=19?points.slice(i-19,i+1).reduce((a,b)=>a+b,0)/20:null);
    // At least 70 bars were supplied by Python; rolling averages are calculated only
    // from those available bars. No extrapolation across missing historical days.
    const guides=['0.236','0.382','0.618'].map(key=>({key,val:Number(fib?.[key])}))
      .filter(x=>Number.isFinite(x.val)&&x.val>0);
    const vals=[...points,...ma.filter(Boolean),...guides.map(x=>x.val)];
    const lower=Math.min(...vals)*.975, upper=Math.max(...vals)*1.025;
    const X=i=>x0+(good.length===1?0:i/(good.length-1))*(x1-x0);
    const Y=v=>y1-(v-lower)/Math.max(1,upper-lower)*(y1-y0);
    const polyline=vals=>vals.map((v,i)=>v==null?null:X(i).toFixed(1)+','+Y(v).toFixed(1)).filter(Boolean).join(' ');
    const maLine=ma.map((v,i)=>v==null?null:X(i).toFixed(1)+','+Y(v).toFixed(1)).filter(Boolean).join(' ');
    const lines=guides.map(x=>'<line x1="'+x0+'" x2="'+x1+'" y1="'+Y(x.val)+'" y2="'+Y(x.val)+'" class="fib-guide"/>'+
    '<text x="744" y="'+(Y(x.val)+3)+'" class="svg-label">F'+x.key+'</text>').join('');
    const topTick=fmt(upper),bottomTick=fmt(lower);
    return '<svg class="radar-svg" viewBox="0 0 795 260" role="img" aria-label="종가, 20일선, 피보나치 수준을 표시한 70거래일 가격 차트">'+
    '<line x1="'+x0+'" x2="'+x1+'" y1="'+y1+'" y2="'+y1+'" stroke="#dfe6ef"/>'+
    '<text x="4" y="26" class="svg-label">'+topTick+'</text><text x="4" y="226" class="svg-label">'+bottomTick+'</text>'+
    lines+'<polyline points="'+polyline(points)+'" class="close-line"/>'+
    (maLine?'<polyline points="'+maLine+'" class="ma-line"/>':'')+
    '<text x="'+x0+'" y="247" class="svg-label">'+safe(good[0].date)+'</text>'+
    '<text x="'+(x1-80)+'" y="247" class="svg-label">'+safe(good.at(-1).date)+'</text></svg>';
  }
  function renderDetail() {
    const stocks=Array.isArray(data?.tracked)?data.tracked:[];
    const s=stocks.find(x=>x.ticker===chosen);
    const target=$('radarDetail');
    if(!s){target.innerHTML='<p class="radar-empty">종목을 선택하면 최초 상승일, 현재 위치, 피보나치 가격이 표시됩니다.</p>';return;}
    const dateList=(s.signals||[]).slice(-6).map(x=>safe(x.date)+' '+safe(x.theme)+' '+fmt(x.rank)+'위').join(' / ');
    target.innerHTML=
      '<div class="radar-detail-heading"><div><h3>'+safe(s.name)+'</h3><span>'+safe(s.ticker)+' · '+safe(s.market)+' · 최초 '+safe(s.first_seen)+'</span></div>'+statusPill(s)+'</div>'+
      '<div class="radar-prices">'+
      [['현재 종가',fmt(s.close)+'원'],['20일선',fmt(s.ma20)+'원'],['20일선 이격',pc(s.ma20_gap_pct)],
      ['상승 전 저점',fmt(s.low_anchor)+'원'],['상승 후 최고가',fmt(s.peak_high)+'원'],
      ['피보 0.236',fmt(s.fib?.['0.236'])+'원'],['피보 0.382',fmt(s.fib?.['0.382'])+'원'],
      ['피보 0.5',fmt(s.fib?.['0.5'])+'원'],['피보 0.618',fmt(s.fib?.['0.618'])+'원'],
      ['최고가 대비 되돌림',pc(s.retracement_pct)]].map(k=>'<div class="radar-price"><small>'+safe(k[0])+'</small><strong>'+safe(k[1])+'</strong></div>').join('')+'</div>'+
      '<div class="radar-history-line">주도 테마 선정 이력: '+(dateList||'기록 없음')+'</div>'+
      '<div class="radar-chart-legend"><span class="legend-close">종가</span><span class="legend-ma">20일선</span><span class="legend-fib">피보나치</span></div>'+
      svgChart(s.bars,s.fib)+
      '<p class="radar-footnote">기준 저점은 최초 관심일 이전 최대 20거래일의 최저가, 고점은 그날부터 현재까지 최고가. 0.382 값은 고점에서 상승폭의 38.2%를 되돌린 가격입니다. 관심은 매수 신호가 아니며 지지 여부를 확인해야 합니다.</p>';
  }
  function render() {
    if(!data)return;
    const events=Array.isArray(data.events)?data.events:[];
    const tracked=Array.isArray(data.tracked)?data.tracked:[];
    $('radarDateInfo').textContent='기준 '+safe(data.as_of||'—')+
      ' · 관측 시작 '+safe(data.history_start||'아직 없음')+' · 과거 순위 소급 복원 없음';
    $('radarStats').innerHTML=[
      ['기록된 테마 사건',events.length+'건'],
      ['추적 종목',tracked.length+'개'],
      ['중첩 관심',tracked.filter(x=>x.status_key==='confluence').length+'개'],
      ['MA20 관심',tracked.filter(x=>x.status_key==='ma20').length+'개']
    ].map(s=>'<div class="radar-stat"><small>'+s[0]+'</small><strong>'+s[1]+'</strong></div>').join('');
    renderEvents();renderList();
  }
  async function loadRadar() {
    try {
      const response=await fetch('data/radar-history.json?ts='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw Error('HTTP '+response.status);
      const payload=await response.json();
      if(!Array.isArray(payload.events)||!Array.isArray(payload.tracked))throw Error('기록 형식 오류');
      data=payload;render();
      $('radarLoadStatus').textContent='기록 연결됨';
    }catch(err){
      data={events:[],tracked:[],as_of:null,history_start:null};render();
      $('radarLoadStatus').textContent='기록 없음: 로컬 PC에서 최신 수집 실행 필요 ('+safe(err.message)+')';
    }
  }
  loadRadar();
})();
