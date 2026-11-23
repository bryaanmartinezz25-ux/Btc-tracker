(function(){
'use strict';
const L=window.BTCPulseLogic;
const $=id=>document.getElementById(id);
const fmtBTC=n=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:8}):'—';
const fmtUSD=n=>Number.isFinite(n)?'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const pct=n=>Number.isFinite(n)?n.toFixed(1)+'%':'—%';
const fmtTime=t=>Number.isFinite(t)?new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const fmtShortTime=t=>Number.isFinite(t)?new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'—';
const compact=n=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:2}):'—';
const tradeCutoff=5*60*1000,MAX_TRADES=50000;
const S={trades:[],seen:new Set(),ws:null,wsOpen:false,wsSince:null,wsGap:false,lastTrade:null,connectFails:0,reconnect:null,
  kalshi:null,kalshiAt:0,kalshiError:'',kalshiLoading:false,candles:[],candleAt:0,candleError:'',candleLoading:false,
  price:null,priceAt:0,signal:null,history:[],lastEvidence:null,chartDirty:true,lastPaint:0,audio:null,firstSound:false};
try{const h=JSON.parse(localStorage.getItem('btcPulseHistoryV2')||'[]');if(Array.isArray(h))S.history=h.slice(0,25);}catch(e){}
try{const s=JSON.parse(localStorage.getItem('btcPulseSignalV2')||'null');if(s&&typeof s.marketId==='string'&&['UP','DOWN'].includes(s.direction))S.signal=s;}catch(e){}
function store(){try{if($('persistToggle').checked&&S.signal)localStorage.setItem('btcPulseSignalV2',JSON.stringify(S.signal));else localStorage.removeItem('btcPulseSignalV2');localStorage.setItem('btcPulseHistoryV2',JSON.stringify(S.history.slice(0,25)));}catch(e){}}
function notify(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>el.classList.remove('show'),4800);}
function status(id,ok,label){const el=$(id);el.className='status-pill'+(ok===true?' live':ok===false?' error':'');el.lastChild.textContent=label;}
function setText(id,value){$(id).textContent=String(value);}
function setClass(id,className){$(id).className=className;}
function latestMarket(){return S.kalshi&&Date.parse(S.kalshi.closeTime)>Date.now()&&Date.parse(S.kalshi.openTime)<=Date.now()?S.kalshi:null;}
function quoteFresh(now=Date.now()){return Boolean(latestMarket()&&now-S.kalshiAt<22000);}
function streamFresh(now=Date.now()){return Boolean(S.wsOpen&&S.wsSince&&S.lastTrade&&now-S.lastTrade<12000&&!S.wsGap);}
function getFlow(seconds=120,now=Date.now()){return L.pressure(S.trades,now,seconds,S.wsSince,streamFresh(now),S.wsGap);}
function prune(now=Date.now()){
  const cutoff=now-tradeCutoff-15000;let remove=0;
  while(remove<S.trades.length&&S.trades[remove].t<cutoff)remove++;
  if(remove>0){for(let i=0;i<remove;i++)S.seen.delete(S.trades[i].id);S.trades.splice(0,remove);}
  if(S.trades.length>MAX_TRADES){
    const over=S.trades.length-MAX_TRADES;
    for(let i=0;i<over;i++)S.seen.delete(S.trades[i].id);
    S.trades.splice(0,over);S.wsGap=true;S.wsSince=Date.now();
    setText('coinbaseNotice','Volume too high for the local trade buffer. Collecting a new continuous sample.');
  }
}
function trade(m){const t=L.decodeTrade(m);if(!t||S.seen.has(t.id))return;
  const now=Date.now();if(Math.abs(now-t.t)>30000)return;
  S.seen.add(t.id);S.trades.push(t);S.lastTrade=now;S.price=t.price;S.priceAt=now;S.chartDirty=true;
  if(t.size>=Number($('tradeThreshold').value)&&$('soundToggle').checked)playSound(t.side);
  if(S.trades.length%130===0)prune(now);
}
function wsConnect(){
  if(S.ws&&[0,1].includes(S.ws.readyState))return;
  clearTimeout(S.reconnect);status('coinbaseStatus',null,'BTC connecting');
  let ws;try{ws=new WebSocket('wss://ws-feed.exchange.coinbase.com');}catch(e){wsFail();return;}
  S.ws=ws;
  const guard=setTimeout(()=>{if(ws.readyState!==1)ws.close();},12000);
  ws.onopen=()=>{
    clearTimeout(guard);S.wsOpen=true;S.wsSince=Date.now();S.lastTrade=null;S.wsGap=false;S.connectFails=0;
    S.trades=[];S.seen.clear();
    ws.send(JSON.stringify({type:'subscribe',product_ids:['BTC-USD'],channels:['matches','heartbeat']}));
    status('coinbaseStatus',true,'BTC connected · sampling');
  };
  ws.onmessage=ev=>{try{const m=JSON.parse(ev.data);if(m.type==='match')trade(m);else if(m.type==='error'){
    setText('coinbaseNotice',`Coinbase rejected the feed: ${String(m.message||'unknown error')}.`);ws.close();
  }}catch(e){}};
  ws.onerror=()=>{status('coinbaseStatus',false,'BTC connection error');};
  ws.onclose=()=>{clearTimeout(guard);S.wsOpen=false;S.wsSince=null;S.wsGap=true;S.lastTrade=null;status('coinbaseStatus',false,'BTC disconnected');if(document.visibilityState!=='hidden')wsFail();};
}
function wsFail(){clearTimeout(S.reconnect);S.connectFails++;S.reconnect=setTimeout(wsConnect,Math.min(30000,1500*Math.pow(2,Math.min(S.connectFails,5))));}
async function getJSON(url,timeout=11000){
  const controller=new AbortController(),tid=setTimeout(()=>controller.abort(),timeout);
  try{const r=await fetch(url,{cache:'no-store',signal:controller.signal});const data=await r.json();if(!r.ok||data.ok!==true)throw new Error(String(data.error||`HTTP ${r.status}`));return data;}finally{clearTimeout(tid);}
}
async function loadKalshi(){
  if(S.kalshiLoading)return;S.kalshiLoading=true;
  try{
    const k=await getJSON('/api/kalshi');
    const now=Date.now(),close=Date.parse(k.closeTime),open=Date.parse(k.openTime),asOf=Date.parse(k.asOf);
    if(!(close>now&&open<=now&&close-open<=905000&&close-open>=895000)||!Number.isFinite(asOf)||now-asOf>22000)throw new Error('Market window or timestamp is not current.');
    if(!Number.isFinite(k.upPercent)||!Number.isFinite(k.downPercent)||!Number.isFinite(k.spreadPercent)||Math.abs(k.upPercent+k.downPercent-100)>2)throw new Error('Quotes are invalid.');
    if(S.kalshi?.ticker!==k.ticker){
      // Each market starts with a new independent signal. A persisted signal only applies to its original ticker.
      if(S.signal?.marketId!==k.ticker)S.signal=L.emptySignal(k.ticker);
    }
    S.kalshi=k;S.kalshiAt=Date.now();S.kalshiError='';
    // Signals evolve ONLY when an independently fetched Kalshi update is observed.
    if(!S.signal||S.signal.marketId!==k.ticker)S.signal=L.emptySignal(k.ticker);
    updateSignal(Date.now());
  }catch(e){S.kalshiError=String(e.message||e);if(!quoteFresh())S.kalshi=null;}
  finally{S.kalshiLoading=false;render();}
}
async function loadCandles(){
  if(S.candleLoading)return;S.candleLoading=true;
  try{const response=await getJSON('/api/candles',12000);S.candles=response.candles||[];S.candleAt=Date.now();S.candleError='';S.chartDirty=true;}
  catch(e){S.candleError=String(e.message||e);}finally{S.candleLoading=false;}
}
function addHistory(event){
  S.history.unshift({...event});S.history=S.history.slice(0,25);
  if(event.type==='FLIP')notify(`⚠ DIRECTION FLIPPED: ${event.from} → ${event.to}`);
  else notify(`SIGNAL CONFIRMED: LOCKED ${event.to}`);
  store();
}
function updateSignal(now){
  const k=latestMarket();if(!k)return;
  if(S.signal?.marketId!==k.ticker)S.signal=L.emptySignal(k.ticker);
  const p=getFlow(120,now),remaining=Date.parse(k.closeTime)-now;
  const result=L.signalStep(S.signal,{marketId:k.ticker,marketStart:Date.parse(k.openTime),mode:$('timingMode').value,now,remain:remaining,k,flow:p,quoteFresh:quoteFresh(now)});
  S.signal=result.state;S.lastEvidence=result.evidence;
  if(result.event)addHistory(result.event);
  store();
}
function render(){
  const now=Date.now(),k=latestMarket(),fresh=quoteFresh(now),wsGood=streamFresh(now);
  // show stream-connected separately from enough seconds of gathered trades
  status('coinbaseStatus',wsGood?true:S.wsOpen?null:false,wsGood?'BTC live':S.wsOpen?'BTC warming up':'BTC disconnected');
  status('kalshiStatus',fresh?true:S.kalshiError?false:null,fresh?'Kalshi live':S.kalshiError?'Kalshi unavailable':'Kalshi connecting');
  if(!fresh||!wsGood){setClass('overallWarning','warning-banner warn');
    setText('overallWarning',`Live signal verification paused: ${!fresh?'Kalshi quote unavailable or stale. ':''}${!wsGood?'Coinbase trade stream incomplete.':''} Existing locks are historical signals, not fresh confirmations.`);
  }else{
    const full=getFlow(120,now).full;
    setClass('overallWarning',full?'warning-banner ok':'warning-banner pending');
    setText('overallWarning',full
      ? 'Both live feeds are connected and the two-minute sample is complete. A signal still requires agreement between Kalshi odds, Coinbase trade flow and short-term price movement.'
      : 'Both live feeds are connected, but the continuous two-minute trade sample is NOT complete. The timer starts when this webpage connects to Coinbase, not when the Kalshi market opens.');
  }
  const windowTimes=k?{start:Date.parse(k.openTime),end:Date.parse(k.closeTime)}:L.windowTimes(now),remaining=Math.max(0,windowTimes.end-now);
  setText('countdown',String(Math.floor(remaining/60000)).padStart(2,'0')+':'+String(Math.floor(remaining%60000/1000)).padStart(2,'0'));
  $('timeProgress').style.width=Math.max(0,Math.min(100,((now-windowTimes.start)/(windowTimes.end-windowTimes.start))*100)).toFixed(1)+'%';
  setText('startTime',fmtShortTime(windowTimes.start));setText('endTime',fmtShortTime(windowTimes.end));
  setText('windowLabel',k?'KALSHI 15 MIN':'CLOCK 15 MIN');
  setText('btcPrice',now-S.priceAt<15000?fmtUSD(S.price):'—');
  const f2=getFlow(120,now),selection=Number($('flowWindow').value),selected=getFlow(selection,now);
  setText('buyPct',pct(selected.bpct));setText('sellPct',pct(selected.spct));
  setText('buyBtc',fmtBTC(selected.buy)+' BTC');setText('sellBtc',fmtBTC(selected.sell)+' BTC');
  $('buyFill').style.width=(selected.bpct??0)+'%';$('sellFill').style.width=(selected.spct??0)+'%';
  setText('tradeCount',selected.n.toLocaleString());setText('netBtc',(selected.buy-selected.sell>=0?'+':'')+fmtBTC(selected.buy-selected.sell)+' BTC');
  const coverage=Math.max(0,Math.min(selection,S.wsSince?(now-S.wsSince)/1000:0));
  setText('coverage',`${Math.floor(coverage)} / ${selection} sec ${selected.full?'✓':''}`);
  setText('flowBias',selected.full?(selected.bpct>=55?'BUYERS AHEAD':selected.spct>=55?'SELLERS AHEAD':'NEARLY EVEN'):'WARMING UP');
  setText('coinbaseNotice',!wsGood?'Coinbase connection missing or stale. Do not treat past volume as live.':!selected.full?`Gathering ${selection} seconds of continuous Coinbase trade data; ${Math.max(0,Math.ceil(selection-coverage))} seconds remaining.`:'Complete Coinbase sample. Taker-initiated execution volumes shown, not individual people.');
  setText('priceMove',f2.full?pct(f2.delta):'—');
  if(k&&fresh){
    setText('kalshiUp',pct(k.upPercent));setText('kalshiDown',pct(k.downPercent));
    $('upFill').style.width=k.upPercent+'%';$('downFill').style.width=k.downPercent+'%';
    setText('yesSpread',pct(k.yesBidPercent)+' / '+pct(k.yesAskPercent));setText('noSpread',pct(k.noBidPercent)+' / '+pct(k.noAskPercent));
    setText('marketSpread',pct(k.spreadPercent));
    setText('quoteAge',Math.floor((now-S.kalshiAt)/1000)+'s old');
    setText('strike',Number.isFinite(k.strike)?fmtUSD(k.strike):'TBD');
    setText('distance',Number.isFinite(k.strike)&&now-S.priceAt<15000?(S.price-k.strike>=0?'+':'')+fmtUSD(S.price-k.strike):'—');
    setText('kalshiNotice',k.spreadPercent>8?'Market spread is wide: the signal will not lock or flip based on this quote.':'Kalshi YES and NO midpoints displayed as percentages. May differ from executable buy prices.');
    const url=/^https:\/\/kalshi\.com\//.test(k.marketUrl||'')?k.marketUrl:'https://kalshi.com/markets';
    $('marketLink').href=url;setText('marketLink',k.ticker);
  }else{
    for(const id of ['kalshiUp','kalshiDown'])setText(id,'—%');for(const id of ['yesSpread','noSpread','marketSpread','strike','distance'])setText(id,'—');
    $('upFill').style.width='0%';$('downFill').style.width='0%';setText('quoteAge','No fresh quote');
    setText('marketLink','Open Kalshi ↗');$('marketLink').href='https://kalshi.com/markets';
    setText('kalshiNotice',S.kalshiError?`Kalshi data unavailable: ${S.kalshiError}`:'Waiting for a valid Kalshi market quote.');
  }
  renderSignal(now,k,f2,fresh);
  setText('initialTiming',$('timingMode').value==='early'?'After first 2m':'Final 2m');
  setText('healthKalshi',fresh?'Live':'Unavailable');setText('healthCoinbase',wsGood?'Live':S.wsOpen?'Warming up':'Offline');
  setText('healthSample',f2.full?'Complete':`${Math.floor(Math.max(0,Math.min(120,S.wsSince?(now-S.wsSince)/1000:0)))} / 120s`);
  setText('healthChart',now-S.candleAt<90000?`${S.candles.length} candles`:'Offline');
  renderTape();renderHistory();
  if(S.chartDirty||now-S.lastPaint>9000)drawChart();
}
function renderSignal(now,k,f2,fresh){
  const sig=k&&S.signal?.marketId===k.ticker?S.signal:null;
  const activeSeconds=S.wsSince?Math.max(0,Math.floor((now-S.wsSince)/1000)):0;
  const remain=k?Date.parse(k.closeTime)-now:Infinity;
  const explanation=L.evidence(k,f2,remain,fresh,sig?.direction?'flip':'entry');
  const panel=$('readinessPanel');
  let diagnosis='',kind='';
  if(!k){diagnosis='No active Kalshi market found. A signal cannot be calculated.';kind='blocked';}
  else if(!fresh){diagnosis='Kalshi data is stale or unavailable. Existing lock information must not be treated as a fresh prediction.';kind='blocked';}
  else if(!streamFresh(now)){diagnosis='Coinbase live trade stream is interrupted. Leave the webpage open and visible while it reconnects; the sample restarts after reconnecting.';kind='blocked';}
  else if(!f2.full){
    diagnosis=`Trade history: ${Math.min(120,activeSeconds)} of 120 seconds gathered since this tab connected. The Kalshi market opening time does not fill in missed trades. Keep the browser tab active; refreshing or losing the connection restarts collection.`;
  }else if(!explanation.valid){diagnosis=`Two-minute sample complete, but no lock can be evaluated: ${explanation.reason} (observed ${f2.n} trades, ${fmtBTC(f2.total)} BTC).`;kind='blocked';}
  else if(!sig?.direction&&$('timingMode').value==='late'&&remain>120000){diagnosis='Two-minute feed is ready. Initial locks are set to FINAL TWO MINUTES ONLY in Signal intelligence settings.';}
  else if(!sig?.direction&&now-Date.parse(k.openTime)<120000){diagnosis='The sample is ready, but the earliest initial-lock time has not yet arrived for this Kalshi market.';}
  else if(!explanation.direction){
    diagnosis=`Data is ready; no confirmed direction. Kalshi: UP ${pct(k.upPercent)}, DOWN ${pct(k.downPercent)}. Coinbase 2m volume: BUY ${pct(f2.bpct)}, SELL ${pct(f2.spct)}; price movement ${f2.delta>=0?'+':''}${pct(f2.delta)}. Initial lock requires 60%+ Kalshi price, 57%+ trade pressure, and matching price momentum.`;
  }else if(sig?.pendingDir){diagnosis=`Candidate ${sig.pendingDir}; confirmation ${sig.pendingCount}/3. A direction is not locked until the repeated checks finish.`;kind='ready';}
  else if(sig?.direction){diagnosis=`Current experimental signal: ${sig.direction}. New contradictory evidence can trigger a reversal. This signal has not been proven to predict Kalshi settlement.`;kind='ready';}
  else{diagnosis=`All three criteria currently align with ${explanation.direction}. Waiting for repeated checks before displaying a confirmed signal.`;kind='ready';}
  panel.className='readiness-panel'+(kind?' '+kind:'');
  panel.textContent=diagnosis;
  setText('marketShort',k?k.ticker.slice(-17):'—');
  setText('lockTime',sig?.lockedAt?fmtTime(sig.lockedAt):'—');
  if(sig?.direction){
    const stale=!fresh||!f2.full;
    setText('direction','LOCKED '+sig.direction);
    setClass('direction','direction '+sig.direction.toLowerCase());
    setText('signalType',`${sig.flipCount?'FLIPPED '+sig.flipCount+'×':'INITIAL LOCK'}${stale?' · UNVERIFIED':''}`);
    if(stale)setText('signalDesc',`Last confirmed ${sig.direction} signal is retained, but a feed is stale or incomplete; fresh evidence cannot verify or reverse it.`);
    else if(sig.pendingDir)setText('signalDesc',`FLIP WARNING: ${sig.pendingDir} confirmation ${sig.pendingCount}/3. A reversal requires sustained opposing odds, flow and price momentum.`);
    else if(sig.warningDir)setText('signalDesc',`FLIP WARNING: ${sig.warningDir} pressure and price momentum are rising. Waiting for Kalshi confirmation before changing the lock.`);
    else if(remain<=15000)setText('signalDesc','Final 15 seconds: direction frozen. Settlement uses Kalshi’s reference index, not Coinbase spot.');
    else setText('signalDesc',`Confirmed ${sig.direction} for this window. The lock is REVERSIBLE if opposing evidence strengthens for at least 3 checks.`);
  }else{
    setText('direction',sig?.pendingDir?'VERIFYING '+sig.pendingDir:'WAITING');setClass('direction','direction waiting');
    setText('signalType',sig?.pendingDir?`CONFIRMATION ${sig.pendingCount}/3`:'NO LOCK');
    const early=$('timingMode').value==='early', elapsed=k?now-Date.parse(k.openTime):0;
    setText('signalDesc',!k?'Waiting for the active Kalshi 15-minute market.':!f2.full?'Collecting 2 minutes of continuous Coinbase executions.':early&&elapsed<120000?'Waiting until this Kalshi market has 2 minutes of price/trade history.':!early&&remain>120000?'Monitoring. Strict initial locks begin in the final 2 minutes.':sig?.pendingDir?`Checking ${sig.pendingDir} persistence before initial lock.`:remain<=15000?'Too late for a new lock this window.':'Waiting for Kalshi, 2-minute pressure and price momentum to agree.');
  }
  const ev=S.lastEvidence;if(ev&&fresh&&f2.full){for(const [id,v] of [['checkOdds',ev.odds],['checkFlow',ev.flow],['checkPrice',ev.price]]){
      $(id).textContent=v?'●':'○';$(id).className='step-indicator '+(v?'good':'bad');
  }}else for(const id of ['checkOdds','checkFlow','checkPrice']){$(id).textContent='○';$(id).className='step-indicator';}
  // Duplicate an important reversal warning in a prominent pill.
  setText('signalMode',sig?.pendingDir||sig?.warningDir?'⚠ FLIP WATCH':'AUTO · REVERSIBLE');
}
function renderTape(){
  const threshold=Number($('tradeThreshold').value),recent=S.trades.filter(t=>t.size>=threshold).slice(-70).reverse();
  const body=$('tradeTable');body.replaceChildren();
  if(recent.length===0){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='empty-table';td.textContent=`No observed individual Coinbase executions ≥ ${threshold} BTC since this page connected.`;tr.append(td);body.append(tr);}
  for(const t of recent){const tr=document.createElement('tr');const values=[fmtTime(t.t),t.side,fmtBTC(t.size),fmtUSD(t.price),fmtUSD(t.size*t.price)];
    values.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i===1)td.className='tag '+(t.side==='BUY'?'up':'down');tr.append(td);});body.append(tr);
  }
  setText('tradeNotice',`Watching Coinbase BTC/USD executions. Minimum ${threshold} BTC. ${recent.length} matching fills visible (not named people or whole orders).`);
}
function renderHistory(){
  const el=$('historyList');el.replaceChildren();if(!S.history.length){el.textContent='None yet. Locks and reversals will appear here.';return;}
  for(const h of S.history.slice(0,8)){const row=document.createElement('div');row.className='history-item';
    const left=document.createElement('span');left.textContent=fmtShortTime(h.time)+' · '+(h.type==='FLIP'?'FLIP '+h.from+' → '+h.to:'INITIAL LOCK');
    const right=document.createElement('b');right.className=h.to==='UP'?'up':'down';right.textContent=h.to;
    row.append(left,right);el.append(row);
  }
}
function playSound(side){
  if(!S.audio)return;
  try{const c=S.audio,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=side==='BUY'?880:500;g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.08,c.currentTime+.01);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.12);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.13);}catch(e){}
}
function exportCSV(){
  if(!S.trades.length){notify('No trades recorded to export yet.');return;}
  const csv='timestamp,aggressor,btc_size,price_usd,notional_usd,source\n'+S.trades.map(t=>[
    new Date(t.t).toISOString(),t.side,t.size,t.price,(t.size*t.price).toFixed(2),'Coinbase BTC-USD'].join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='btc-pulse-trades-'+new Date().toISOString().slice(0,10)+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function drawChart(){
  const canvas=$('priceChart'),ctx=canvas.getContext('2d');if(!ctx)return;
  const width=Math.max(100,canvas.clientWidth),height=Math.max(150,canvas.clientHeight),ratio=Math.min(2,window.devicePixelRatio||1);
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);S.lastPaint=Date.now();S.chartDirty=false;
  const list=S.candles.filter(c=>Number.isFinite(c.close)).slice(-75);
  if(list.length<3){ctx.fillStyle='#9aacc7';ctx.font='13px system-ui';ctx.fillText(S.candleError?'Chart feed unavailable.':'Waiting for 1-minute candle data…',20,height/2);setText('chartStatus',S.candleError||'Waiting for Coinbase 1-minute candles');return;}
  const left=14,right=77,top=19,bottom=28,iw=width-left-right,ih=height-top-bottom;
  const prices=list.flatMap(c=>[c.low,c.high]);let pmin=Math.min(...prices),pmax=Math.max(...prices);
  const cushion=Math.max((pmax-pmin)*.14,pmin*.00025);pmin-=cushion;pmax+=cushion;
  const y=p=>top+(pmax-p)/(pmax-pmin)*ih;
  const step=iw/list.length,candleW=Math.max(2,Math.min(8,step*.64));
  ctx.strokeStyle='#26394e';ctx.fillStyle='#8296b1';ctx.font='10px -apple-system,system-ui,sans-serif';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const yy=top+i*ih/4;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(width-right+5,yy);ctx.stroke();ctx.fillText('$'+Math.round(pmax-(pmax-pmin)*i/4).toLocaleString('en-US'),width-right+10,yy+4);}
  list.forEach((c,i)=>{
    const x=left+(i+.5)*step;
    const date=new Date(c.t);if(date.getUTCMinutes()%15===0){ctx.strokeStyle='#7593b366';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,height-bottom);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#b8c9e2';ctx.fillText(fmtShortTime(c.t),Math.max(2,x-19),height-10);}
    const col=c.close>=c.open?'#4de1ae':'#ff798b';ctx.strokeStyle=col;ctx.fillStyle=col;
    ctx.beginPath();ctx.moveTo(x,y(c.high));ctx.lineTo(x,y(c.low));ctx.stroke();ctx.fillRect(x-candleW/2,Math.min(y(c.open),y(c.close)),candleW,Math.max(1,Math.abs(y(c.close)-y(c.open))));
  });
  const closes=list.map(c=>c.close),ema9=L.ema(closes,9),ema21=L.ema(closes,21);
  function plotLine(nums,color){ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.beginPath();nums.forEach((v,i)=>{const x=left+(i+.5)*step;if(i===0)ctx.moveTo(x,y(v));else ctx.lineTo(x,y(v));});ctx.stroke();ctx.lineWidth=1;}
  plotLine(ema9,'#8ac9ff');plotLine(ema21,'#f7cf78');
  const first=list[0].t,last=list[list.length-1].t+60000;
  for(const t of S.trades){if(t.size<Number($('tradeThreshold').value)||t.t<first||t.t>=last)continue;
    const idx=(t.t-first)/(last-first)*iw;const xx=left+idx,yy=y(t.price);
    ctx.fillStyle=t.side==='BUY'?'#4de1ae':'#ff798b';ctx.beginPath();ctx.arc(xx,yy,Math.min(5,2.3+Math.log10(t.size+1)),0,Math.PI*2);ctx.fill();
  }
  if(Date.now()-S.priceAt<15000&&S.price>0){const yy=y(S.price);if(yy>top&&yy<height-bottom){ctx.strokeStyle='#f0f5ff88';ctx.setLineDash([2,4]);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(width-right,yy);ctx.stroke();ctx.setLineDash([]);}}
  setText('chartStatus',`Coinbase 1m candles · ${fmtShortTime(first)}–${fmtShortTime(list[list.length-1].t)} · last fetched ${Math.floor((Date.now()-S.candleAt)/1000)}s ago`);
}
$('tradeThreshold').addEventListener('change',()=>{S.chartDirty=true;render();});
$('flowWindow').addEventListener('change',render);$('exportBtn').addEventListener('click',exportCSV);
$('timingMode').addEventListener('change',()=>{try{localStorage.setItem('btcPulseTimingMode',$('timingMode').value);}catch(e){}render();});
try{const timing=localStorage.getItem('btcPulseTimingMode');if(['early','late'].includes(timing))$('timingMode').value=timing;}catch(e){}
$('soundToggle').addEventListener('change',()=>{if($('soundToggle').checked){try{S.audio=new(window.AudioContext||window.webkitAudioContext)();S.audio.resume();}catch(e){$('soundToggle').checked=false;notify('Sound unavailable in this browser.');}}});
$('persistToggle').addEventListener('change',store);
$('resetSignal').addEventListener('click',()=>{S.signal=latestMarket()?L.emptySignal(S.kalshi.ticker):null;localStorage.removeItem('btcPulseSignalV2');notify('Saved current lock cleared. History remains.');render();});
window.addEventListener('resize',()=>{S.chartDirty=true;drawChart();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(!S.wsOpen)wsConnect();loadKalshi();loadCandles();}});
window.addEventListener('beforeunload',()=>{if(S.ws)S.ws.close();});
function tick(){const now=Date.now();if(S.wsOpen&&S.lastTrade&&now-S.lastTrade>12000){S.wsGap=true;S.wsSince=now;S.ws.close();}
  if(S.kalshi&&Date.parse(S.kalshi.closeTime)<=now){S.kalshi=null;S.kalshiAt=0;}
  prune(now);render();}
wsConnect();loadKalshi();loadCandles();setInterval(tick,1000);
setInterval(()=>{if(document.visibilityState!=='hidden')loadKalshi();},8000);
setInterval(()=>{if(document.visibilityState!=='hidden')loadCandles();},35000);
setInterval(()=>{if(document.visibilityState!=='hidden'&&!S.wsOpen&&(!S.ws||S.ws.readyState===3))wsConnect();},25000);
})();
