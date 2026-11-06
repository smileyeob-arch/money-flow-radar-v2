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
  let personalData = null, currentSource = 'theme', selectedGroup = 'all', personalError = null;
  const activeStocks = () => currentSource === 'kiwoom' ? (personalData?.stocks || []) : (data?.tracked || []);
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
  $('radarEventOrder').addEventListener('change',()=>renderEvents());
  // The candidate rows are rebuilt when filters and data change. Delegate the
  // click to their stable parent so every stock always updates the detail.
  $('radarCandidates').addEventListener('click',event=>{
    const remove=event.target.closest('button[data-remove-ticker]');
    if(remove && $('radarCandidates').contains(remove)){
      if(currentSource!=='kiwoom' || !personalData)return;
      const ticker=remove.dataset.removeTicker;
      if(!personalData.stocks.some(item=>item.ticker===ticker))return;
      // Remove ONLY from the browser's imported copy, not Kiwoom HTS,
      // the selected JSON file on disk, or the public theme tracker.
      personalData.stocks=personalData.stocks.filter(item=>item.ticker!==ticker);
      for(const group of personalData.groups){
        if(Array.isArray(group.tickers))
          group.tickers=group.tickers.filter(code=>code!==ticker);
      }
      if(chosen===ticker)chosen=null;
      render();
      return;
    }
    const row=event.target.closest('button[data-radar-ticker]');
    if(!row || !$('radarCandidates').contains(row))return;
    const ticker=row.dataset.radarTicker;
    if(!activeStocks().some(item=>item.ticker===ticker))return;
    chosen=ticker;
    renderList();
  });
  $('radarDataSource').addEventListener('change',e=>{
    currentSource=e.target.value==='kiwoom'?'kiwoom':'theme';
    $('radarWatchTools').classList.toggle('hidden',currentSource!=='kiwoom');
    $('radarWatchInfo').classList.toggle('hidden',currentSource!=='kiwoom');
    $('radarEventsPanel').classList.toggle('hidden',currentSource==='kiwoom');
    chosen=null;
    render();
  });
  $('radarWatchGroup').addEventListener('change',e=>{
    selectedGroup=e.target.value;
    chosen=null;
    render();
  });
  $('radarWatchRemoveGroup').addEventListener('click',()=>{
    if(currentSource!=='kiwoom' || !personalData || selectedGroup==='all')return;
    const group=personalData.groups.find(g=>String(g.id)===selectedGroup);
    if(!group)return;
    const label=String(group.name||group.id||'선택 그룹');
    if(!window.confirm('"'+label+'" 그룹을 현재 불러온 목록에서 제외할까요? 영웅문과 원본 JSON은 변경되지 않습니다.'))return;
    personalData.groups=personalData.groups.filter(g=>String(g.id)!==selectedGroup);
    const remainingCodes=new Set(personalData.groups.flatMap(g=>
      Array.isArray(g.tickers)?g.tickers:[]));
    personalData.stocks=personalData.stocks.filter(s=>remainingCodes.has(s.ticker)).map(stock=>{
      const groups=personalData.groups.filter(g=>Array.isArray(g.tickers) && g.tickers.includes(stock.ticker))
        .map(g=>String(g.name||g.id||'그룹'));
      return {...stock,group_names:groups,first_theme:groups.join(' · ')||'내 관심종목'};
    });
    selectedGroup='all';
    $('radarWatchGroup').innerHTML='<option value="all">모든 관심그룹</option>'+
      personalData.groups.filter(g=>g && g.id!=null).map(g=>
        '<option value="'+safe(g.id)+'">'+safe(g.name||g.id)+'</option>').join('');
    $('radarWatchGroup').value='all';
    chosen=null;
    render();
  });
  $('radarWatchClear').addEventListener('click',()=>{
    personalData=null;
    personalError=null;
    selectedGroup='all';
    $('radarWatchFile').value='';
    $('radarWatchGroup').innerHTML='<option value="all">모든 관심그룹</option>';
    chosen=null;
    render();
  });
  $('radarWatchFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    try{
      if(file.size>30*1024*1024)throw Error('파일 크기는 최대 30MB까지 허용합니다.');
      const payload=JSON.parse(await file.text());
      if(payload?.kind!=='kiwoom_watchlist_local' ||
         !Array.isArray(payload.groups) || !Array.isArray(payload.stocks) ||
         payload.groups.length>500 || payload.stocks.length>3000)
        throw Error('키움 로컬 관심종목 내보내기 파일이 아닙니다.');
      for(const x of payload.stocks){
        if(!/^\d{6}$/.test(String(x.ticker||'')) || !Array.isArray(x.bars))
          throw Error('파일의 종목 데이터 형식이 올바르지 않습니다.');
      }
      const names=new Map();
      for(const group of payload.groups){
        if(!group || !Array.isArray(group.tickers))continue;
        for(const ticker of group.tickers){
          if(!names.has(ticker))names.set(ticker,[]);
          names.get(ticker).push(String(group.name||group.id||'그룹'));
        }
      }
      personalData={...payload,stocks:payload.stocks.map(x=>({
        ...x,group_names:names.get(x.ticker)||[],
        first_theme:(names.get(x.ticker)||[]).join(' · ')||'내 관심종목',
      }))};
      $('radarWatchGroup').innerHTML='<option value="all">모든 관심그룹</option>'+
        payload.groups.filter(g=>g && g.id!=null).map(g=>
          '<option value="'+safe(g.id)+'">'+safe(g.name||g.id)+'</option>').join('');
      personalError=null;selectedGroup='all';chosen=null;
      render();
    }catch(err){
      personalData=null;chosen=null;
      personalError='가져오기 실패: '+String(err.message||err);
      render();
    }
  });
  function renderEvents() {
    const events = [...(Array.isArray(data.events)?data.events:[])];
    const area = $('radarEvents');
    if (!events.length) {
      area.innerHTML='<p class="radar-empty">과거 주도 테마 데이터가 없습니다. IP 등록된 PC에서 3개월 복원 수집을 실행하면 날짜별 목록이 나타납니다.</p>';
      return;
    }
    const mode=$('radarEventOrder').value;
    const visible=mode==='backfill' ? events.filter(e=>Boolean(e.backfill)) : events;
    visible.sort((a,b)=>mode==='oldest' ? a.date.localeCompare(b.date)||a.rank-b.rank
      : b.date.localeCompare(a.date)||a.rank-b.rank);
    area.innerHTML=visible.length?visible.slice(0,200).map(e=>{
      const names=(e.picks||[]).map(x=>safe(x.name)).join(' · ');
      const tag=e.backfill?'<span class="radar-proxy">과거 추정</span>':
        '<span class="radar-live">당일 기록</span>';
      return '<article class="radar-event"><div class="radar-event-main"><b>'+safe(koreanDate(e.date))+
      '</b><span class="radar-rank">'+fmt(e.rank)+'위</span>'+tag+'<strong>'+
      safe(e.theme)+'</strong></div><div class="radar-event-sub">당시 500억 이상 감시종목 평균 '+
      pc(e.avg_change_pct)+' · 상승 '+fmt(e.up_count)+'/'+fmt(e.member_count)+
      ' · 관심: '+(names||'없음')+'</div></article>';
    }).join(''):'<p class="radar-empty">선택한 기간에 기록된 테마가 없습니다.</p>';
  }
  function renderList() {
    const stocks=activeStocks();
    const groupCodes=currentSource==='kiwoom' && selectedGroup!=='all'?
      (personalData?.groups.find(g=>String(g.id)===selectedGroup)?.tickers||[]):null;
    const chosenStocks=stocks.filter(x=>(filter==='all'||x.status_key===filter)&&
      (!groupCodes||groupCodes.includes(x.ticker)))
      .sort((a,b)=>(priority[a.status_key]??6)-(priority[b.status_key]??6)||
        String(b.first_seen||'').localeCompare(String(a.first_seen||'')));
    $('radarCount').textContent=stocks.length+'종목';
    if(!chosenStocks.some(x=>x.ticker===chosen))
      chosen=chosenStocks[0]?.ticker||null;
    $('radarCandidates').innerHTML=chosenStocks.length?chosenStocks.map(x=>
      '<div class="radar-candidate-row"><button type="button" class="radar-candidate'+(chosen===x.ticker?' selected':'')+
      '" data-radar-ticker="'+safe(x.ticker)+'" aria-pressed="'+(chosen===x.ticker)+'"><span class="radar-candidate-title"><strong>'+
      safe(x.name)+'</strong>'+statusPill(x)+'</span><span class="radar-sub">'+
      safe(x.ticker)+' · '+(currentSource==='kiwoom'
        ? safe(x.group_names?.join(' / ')||'내 관심종목')+' · 기술적 구간'
        : safe(x.first_theme)+' ('+fmt(x.first_rank)+'위) · 최초 '+safe(x.first_seen))+
      '</span><span class="radar-sub">종가 '+fmt(x.close)+'원 · MA20 '+fmt(x.ma20)+
      '원 · 피보 0.382 '+fmt(x.fib?.['0.382'])+'원</span></button>'+
      (currentSource==='kiwoom'?'<button type="button" class="radar-remove-stock"'+
      ' data-remove-ticker="'+safe(x.ticker)+'" aria-label="'+safe(x.name)+' 목록에서 지우기"'+
      ' title="'+safe(x.name)+' 목록에서 지우기">×</button>':'')+'</div>').join(''):
      '<p class="radar-empty">조건에 맞는 관심종목이 없습니다.</p>';
    renderDetail();
  }
  function chartSeries(bars) {
    const all=(Array.isArray(bars)?bars:[]).filter(x=>x && x.date && Number(x.close)>0 &&
      Number.isFinite(Number(x.close))).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const series=all.slice(-78);
    const offset=all.length-series.length;
    const closes=all.map(x=>Number(x.close));
    const ma=series.map((_,i)=>{
      const p=offset+i;
      if(p<19)return null;
      return closes.slice(p-19,p+1).reduce((a,b)=>a+b,0)/20;
    });
    return {series,ma};
  }
  function svgChart(bars, fib) {
    const {series,ma}=chartSeries(bars);
    if(series.length<2)return '<p class="radar-empty">차트 데이터가 없습니다.</p>';
    const W=840,H=318,x0=70,x1=724,y0=30,y1=260;
    const closes=series.map(x=>Number(x.close));
    const levels=['0.236','0.382','0.5','0.618'].map(key=>({
      key,price:Number(fib?.[key])
    })).filter(x=>Number.isFinite(x.price)&&x.price>0);
    const allValues=[...closes,...ma.filter(v=>v!=null),...levels.map(x=>x.price)];
    const baseMin=Math.min(...allValues),baseMax=Math.max(...allValues);
    const margin=Math.max(1,(baseMax-baseMin)*.08);
    const min=baseMin-margin,max=baseMax+margin,scale=Math.max(1,max-min);
    const X=i=>x0+(i/(series.length-1))*(x1-x0);
    const Y=v=>y1-(v-min)/scale*(y1-y0);
    const pathFor=arr=>{
      let path='',drawing=false;
      arr.forEach((v,i)=>{
        if(v==null||!Number.isFinite(v)){drawing=false;return;}
        path+=(drawing?' L ':' M ')+X(i).toFixed(2)+' '+Y(v).toFixed(2);
        drawing=true;
      });
      return path.trim();
    };
    const curve=pathFor(closes),maCurve=pathFor(ma);
    const area=curve+' L '+x1+' '+y1+' L '+x0+' '+y1+' Z';
    const yGrid=Array.from({length:5},(_,i)=>{
      const v=max-i*scale/4,y=Y(v);
      return '<line x1="'+x0+'" y1="'+y.toFixed(1)+'" x2="'+x1+'" y2="'+y.toFixed(1)+
        '" class="radar-gridline"/><text x="'+(x0-10)+'" y="'+(y+4).toFixed(1)+
        '" text-anchor="end" class="radar-axis">'+fmt(v)+'</text>';
    }).join('');
    const tickIndexes=[0,.25,.5,.75,1].map(v=>Math.round(v*(series.length-1)));
    const xTicks=[...new Set(tickIndexes)].map(i=>{
      const label=String(series[i].date);
      const date=label.slice(4,6)+'.'+label.slice(6,8);
      const x=X(i);
      return '<line x1="'+x.toFixed(1)+'" y1="'+y1+'" x2="'+x.toFixed(1)+
        '" y2="'+(y1+5)+'" class="radar-axis-tick"/><text x="'+x.toFixed(1)+
        '" y="'+(y1+23)+'" text-anchor="middle" class="radar-axis">'+safe(date)+'</text>';
    }).join('');
    const levelLines=levels.map(v=>{
      const y=Y(v.price),highlight=v.key==='0.382';
      return '<line x1="'+x0+'" y1="'+y.toFixed(1)+'" x2="'+x1+'" y2="'+y.toFixed(1)+
        '" class="radar-fib-line'+(highlight?' focus':'')+'"/><text x="'+(x1+11)+
        '" y="'+(y+3.5).toFixed(1)+'" class="radar-fib-label'+(highlight?' focus':'')+'">F'+
        v.key+'  '+fmt(v.price)+'</text>';
    }).join('');
    const topFib=levels.find(x=>x.key==='0.236'),lowerFib=levels.find(x=>x.key==='0.382');
    let zone='';
    if(topFib&&lowerFib){
      const ya=Y(topFib.price),yb=Y(lowerFib.price);
      const top=Math.min(ya,yb);
      zone='<rect x="'+x0+'" y="'+top.toFixed(1)+'" width="'+(x1-x0)+
        '" height="'+Math.abs(yb-ya).toFixed(1)+'" class="radar-fib-zone"/>';
    }
    const last=closes.at(-1),lastX=X(series.length-1),lastY=Y(last);
    return '<div id="radarChartShell" class="radar-chart-shell">'+
      '<div class="radar-chart-summary"><span><i class="radar-chart-pulse"></i> 최근 '+series.length+
      '거래일 가격 흐름</span><strong>'+fmt(last)+'원</strong></div>'+
      '<svg id="radarPriceSvg" class="radar-svg" viewBox="0 0 '+W+' '+H+
      '" role="img" aria-label="종가와 20일 이동평균, 피보나치 네 구간을 표시하는 가격 그래프"'+
      ' data-min="'+min+'" data-max="'+max+'">'+
      '<defs><linearGradient id="radarAreaGradient" x1="0" y1="0" x2="0" y2="1">'+
      '<stop offset="0%" stop-color="#2b9cc3" stop-opacity=".23"/>'+
      '<stop offset="75%" stop-color="#2b9cc3" stop-opacity=".055"/>'+
      '<stop offset="100%" stop-color="#2b9cc3" stop-opacity="0"/></linearGradient>'+
      '<linearGradient id="radarLineGradient" x1="0" y1="0" x2="1" y2="0">'+
      '<stop offset="0%" stop-color="#4677d5"/><stop offset="100%" stop-color="#0aadb5"/>'+
      '</linearGradient></defs>'+
      '<rect x="'+x0+'" y="'+y0+'" width="'+(x1-x0)+'" height="'+(y1-y0)+
      '" rx="5" class="radar-plot-bg"/>'+yGrid+zone+levelLines+
      '<path d="'+area+'" class="radar-price-area"/>'+
      '<path d="'+curve+'" class="radar-price-glow"/>'+
      '<path d="'+curve+'" class="radar-price-curve"/>'+
      (maCurve?'<path d="'+maCurve+'" class="radar-ma-curve"/>':'')+
      '<circle cx="'+lastX.toFixed(2)+'" cy="'+lastY.toFixed(2)+'" r="7" class="radar-last-halo"/>'+
      '<circle cx="'+lastX.toFixed(2)+'" cy="'+lastY.toFixed(2)+'" r="3.8" class="radar-last-dot"/>'+
      '<g id="radarCursor" visibility="hidden">'+
      '<line id="radarCrossV" x1="'+x0+'" y1="'+y0+'" x2="'+x0+'" y2="'+y1+
      '" class="radar-crosshair"/>'+
      '<line id="radarCrossH" x1="'+x0+'" y1="'+y0+'" x2="'+x1+'" y2="'+y0+
      '" class="radar-crosshair"/>'+
      '<circle id="radarCrossDot" cx="'+x0+'" cy="'+y0+'" r="5" class="radar-cursor-dot"/>'+
      '</g>'+xTicks+'</svg>'+
      '<div class="radar-hover-card" id="radarHoverCard" hidden></div>'+
      '<div class="radar-chart-hint">차트에 마우스를 올리면 날짜별 종가와 20일선을 확인할 수 있어요.</div></div>';
  }
  function bindChartHover(bars) {
    const svg=$('radarPriceSvg'),cursor=$('radarCursor'),card=$('radarHoverCard');
    const shell=$('radarChartShell');
    if(!svg||!cursor||!card||!shell)return;
    const {series,ma}=chartSeries(bars);
    if(series.length<2)return;
    const W=840,x0=70,x1=724,y0=30,y1=260;
    const min=Number(svg.dataset.min),max=Number(svg.dataset.max);
    if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min)return;
    const X=i=>x0+(i/(series.length-1))*(x1-x0);
    const Y=v=>y1-(v-min)/(max-min)*(y1-y0);
    const cursorV=$('radarCrossV'),cursorH=$('radarCrossH'),dot=$('radarCrossDot');
    const hide=()=>{cursor.setAttribute('visibility','hidden');card.hidden=true;};
    svg.addEventListener('pointermove',event=>{
      const rect=svg.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      const sx=(event.clientX-rect.left)/rect.width*W;
      if(sx<x0||sx>x1){hide();return;}
      const i=Math.max(0,Math.min(series.length-1,
        Math.round((sx-x0)/(x1-x0)*(series.length-1))));
      const price=Number(series[i].close),x=X(i),y=Y(price);
      cursor.setAttribute('visibility','visible');
      cursorV.setAttribute('x1',x.toFixed(1));cursorV.setAttribute('x2',x.toFixed(1));
      cursorH.setAttribute('y1',y.toFixed(1));cursorH.setAttribute('y2',y.toFixed(1));
      dot.setAttribute('cx',x.toFixed(1));dot.setAttribute('cy',y.toFixed(1));
      const rawDate=String(series[i].date);
      const date=rawDate.slice(0,4)+'-'+rawDate.slice(4,6)+'-'+rawDate.slice(6,8);
      card.innerHTML='<strong>'+safe(date)+'</strong><span>종가 <b>'+fmt(price)+'원</b></span>'+
        '<span>20일선 <b>'+fmt(ma[i])+'원</b></span>';
      const pixelX=x/W*rect.width;
      card.style.left=Math.min(Math.max(12,pixelX+16),Math.max(12,shell.clientWidth-164))+'px';
      card.style.top=Math.max(45,y/318*rect.height-18)+'px';
      card.hidden=false;
    });
    svg.addEventListener('pointerleave',hide);
  }
  function renderDetail() {
    const stocks=activeStocks();
    const s=stocks.find(x=>x.ticker===chosen);
    const target=$('radarDetail');
    if(!s){target.innerHTML='<p class="radar-empty">종목을 선택하면 최초 상승일, 현재 위치, 피보나치 가격이 표시됩니다.</p>';return;}
    const dateList=(s.signals||[]).slice(-6).map(x=>safe(x.date)+' '+safe(x.theme)+' '+fmt(x.rank)+'위').join(' / ');
    const personal=currentSource==='kiwoom';
    const info=personal ? ('저장 관심그룹: '+safe((s.group_names||[]).join(' / '))+
      ' · 기술적 저점 '+safe(s.swing_low_date||'—')+' · 기술적 고점 '+safe(s.swing_high_date||'—')) :
      ('주도 테마 선정 이력: '+(dateList||'기록 없음'));
    target.innerHTML=
      '<div class="radar-detail-heading"><div><h3>'+safe(s.name)+'</h3><span>'+safe(s.ticker)+' · '+safe(s.market)+' · '+(personal?'내 키움 관심종목':('최초 '+safe(s.first_seen)))+'</span></div>'+statusPill(s)+'</div>'+
      '<div class="radar-prices">'+
      [[personal?'조회일 종가':'현재 종가',fmt(s.close)+'원'],['20일선',fmt(s.ma20)+'원'],['20일선 이격',pc(s.ma20_gap_pct)],
      [personal?'최근 구간 저점':'상승 전 저점',fmt(s.low_anchor)+'원'],[personal?'최근 구간 고점':'상승 후 최고가',fmt(s.peak_high)+'원'],
      ['피보 0.236',fmt(s.fib?.['0.236'])+'원'],['피보 0.382',fmt(s.fib?.['0.382'])+'원'],
      ['피보 0.5',fmt(s.fib?.['0.5'])+'원'],['피보 0.618',fmt(s.fib?.['0.618'])+'원'],
      ['최고가 대비 되돌림',pc(s.retracement_pct)]].map(k=>'<div class="radar-price"><small>'+safe(k[0])+'</small><strong>'+safe(k[1])+'</strong></div>').join('')+'</div>'+
      '<div class="radar-history-line">'+info+'</div>'+
      '<div class="radar-chart-legend"><span class="legend-close">종가</span><span class="legend-ma">20일선</span><span class="legend-fib">피보나치</span></div>'+
      svgChart(s.bars,s.fib)+
      '<p class="radar-footnote">'+(personal
        ? '내 관심종목 기술적 분석은 최근 90거래일 안에서 저점 뒤에 나타난 고점을 기준으로 계산합니다. 과거 테마 상승일은 알 수 없으며, 매수 신호가 아닙니다. 개인 JSON은 브라우저 메모리에서만 처리됩니다.'
        : '기준 저점은 최초 관심일 이전 최대 20거래일의 최저가, 고점은 그날부터 현재까지 최고가. 0.382 값은 고점에서 상승폭의 38.2%를 되돌린 가격입니다. 관심은 매수 신호가 아니며 지지 여부를 확인해야 합니다.')+'</p>';
    bindChartHover(s.bars);
  }
  function render() {
    if(currentSource==='kiwoom'){
      $('radarWatchRemoveGroup').disabled=!personalData || selectedGroup==='all';
      const stocks=activeStocks();
      const groups=personalData?.groups||[];
      $('radarDateInfo').textContent=personalData?
        '내 키움 관심종목 · 로컬 가져오기 '+String(personalData.exported_at_kst||'')+
        ' · 실시간 연동 아님 · 개인 파일은 GitHub 미전송':
        '내 키움 관심종목 · 개인 파일을 아직 가져오지 않았습니다.';
      $('radarWatchInfo').textContent=personalError || (personalData
        ? '개인 관심그룹 '+groups.length+'개, 일반주 '+stocks.length+
          '종목. 종목 옆 ×로 개별 삭제하거나 선택 그룹을 삭제할 수 있습니다. 이 브라우저 화면에만 적용되며, 파일 재선택 시 복원됩니다.'
        : '키움 PC에서 windows/export-watchlist.ps1 실행 후, %LOCALAPPDATA%\\MoneyFlowRadar\\watchlist-export.json 파일을 선택하세요. 개인 파일은 GitHub에 업로드하지 않습니다.');
      $('radarStats').innerHTML=[
        ['관심그룹',groups.length+'개'],['내 관심종목',stocks.length+'개'],
        ['중첩 관심',stocks.filter(x=>x.status_key==='confluence').length+'개'],
        ['20일선 관심',stocks.filter(x=>x.status_key==='ma20').length+'개']
      ].map(v=>'<div class="radar-stat"><small>'+v[0]+'</small><strong>'+v[1]+'</strong></div>').join('');
      renderList();
      return;
    }
    if(!data)return;
    const events=Array.isArray(data.events)?data.events:[];
    const tracked=Array.isArray(data.tracked)?data.tracked:[];
    const meta=data.backfill_meta||{};
    $('radarDateInfo').textContent=data.backfilled
      ? '기준 '+safe(data.as_of||'—')+' · 과거복원 '+safe(meta.from||'—')+' ~ '+safe(meta.to||'—')+
        ' · 공식 인포스탁 당시 테마순위 아님 (과거 시세 + 현재 테마 구성으로 추정)'
      : '기준 '+safe(data.as_of||'—')+' · 누적 시작 '+safe(data.history_start||'아직 없음')+
        ' · 과거 3개월 복원은 아직 수행되지 않았습니다.';
    $('radarStats').innerHTML=[
      [data.backfilled ? '복원 거래일' : '기록된 테마 사건',
       data.backfilled ? String(data.backfill_meta?.trading_sessions_covered||'—')+'일' : events.length+'건'],
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
