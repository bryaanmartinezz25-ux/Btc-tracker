/* BTC Pulse — pure, testable market logic. No strategy has a guaranteed hit rate. */
(function(root){
'use strict';
const WINDOW_MS=900000;
const slotFor=t=>Math.floor(t/WINDOW_MS);
const windowTimes=t=>({start:slotFor(t)*WINDOW_MS,end:(slotFor(t)+1)*WINDOW_MS});
function decodeTrade(m){
  if(!m || m.type!=='match' || m.product_id!=='BTC-USD' || !['sell','buy'].includes(m.side)) return null;
  const size=Number(m.size),price=Number(m.price),t=Date.parse(m.time);
  if(!(size>0)||!(price>0)||!Number.isFinite(t))return null;
  // Coinbase Exchange match.side = MAKER side; taker/aggressor is opposite.
  return {id:String(m.trade_id ?? `${m.time}:${m.price}:${m.size}`),t,size,price,side:m.side==='sell'?'BUY':'SELL'};
}
function pressure(trades,now,sec,wsSince,fresh,hasGap=false){
  const cutoff=now-sec*1000;let buy=0,sell=0,n=0,oldest=null,newest=null;
  for(const t of trades){
    if(t.t<cutoff||t.t>now+5000)continue;
    if(t.side==='BUY')buy+=t.size;else if(t.side==='SELL')sell+=t.size;else continue;
    n++;if(!oldest||t.t<oldest.t)oldest=t;if(!newest||t.t>newest.t)newest=t;
  }
  const total=buy+sell;
  return {buy,sell,n,total,bpct:total?buy/total*100:null,spct:total?sell/total*100:null,
    full:Boolean(fresh&&!hasGap&&wsSince&&wsSince<=cutoff),
    delta:oldest&&newest&&oldest.price>0?(newest.price/oldest.price-1)*100:null};
}
function evidence(k,flow,remain,quoteFresh,kind='entry'){
  const r={direction:null,odds:false,flow:false,price:false,valid:false,reason:''};
  if(!quoteFresh||!k){r.reason='Fresh Kalshi odds unavailable.';return r;}
  if(!Number.isFinite(k.upPercent)||!Number.isFinite(k.downPercent)||!Number.isFinite(k.spreadPercent)||k.spreadPercent>8){r.reason='Kalshi quote spread too wide or invalid.';return r;}
  if(!flow||!flow.full||flow.n<25||flow.total<0.5||!Number.isFinite(flow.delta)){r.reason='Waiting for a complete 2-minute Coinbase trade sample.';return r;}
  if(remain<=15000){r.reason='Signal frozen in final 15 seconds.';return r;}
  r.valid=true;
  const flip=kind==='flip',oddsThreshold=flip?53:60,flowThreshold=flip?63:57,deltaThreshold=flip?0.035:0.02;
  const up={odds:k.upPercent>=oddsThreshold,flow:flow.bpct>=flowThreshold,price:flow.delta>=deltaThreshold};
  const down={odds:k.downPercent>=oddsThreshold,flow:flow.spct>=flowThreshold,price:flow.delta<=-deltaThreshold};
  if(up.odds&&up.flow&&up.price){r.direction='UP';Object.assign(r,up);}
  else if(down.odds&&down.flow&&down.price){r.direction='DOWN';Object.assign(r,down);}
  else {r.odds=up.odds||down.odds;r.flow=up.flow||down.flow;r.price=up.price||down.price;}
  r.reason=r.direction?'Three independent checks agree.':'Odds, taker volume and price momentum do not all agree.';
  return r;
}
function emptySignal(marketId){return {marketId,direction:null,lockedAt:null,flipCount:0,lastFlipAt:null,pendingDir:null,pendingCount:0,pendingSince:null,warningDir:null,lastReason:'No signal yet.'};}
function signalStep(previous,{marketId,marketStart=null,mode='early',now,remain,k,flow,quoteFresh}){
  const s=(!previous||previous.marketId!==marketId)?emptySignal(marketId):{...previous};
  const hasLock=!!s.direction;
  const ev=evidence(k,flow,remain,quoteFresh,hasLock?'flip':'entry');
  // A watch warning is a possible reversal, never an executed switch.
  s.warningDir=null;
  if(hasLock&&quoteFresh&&flow?.full&&flow.n>=25&&Number.isFinite(flow.delta)){
    const opposite=s.direction==='UP'?'DOWN':'UP';
    const counterVolume=opposite==='UP'?flow.bpct:flow.spct;
    const counterMove=opposite==='UP'?flow.delta:-flow.delta;
    if(counterVolume>=57&&counterMove>=0.015) s.warningDir=opposite;
  }
  s.lastReason=ev.reason;
  const tooEarly=!hasLock && (mode==='late' ? remain>120000 : (Number.isFinite(marketStart) && now-marketStart<120000));
  if(!ev.valid || tooEarly || remain<=15000){s.pendingDir=null;s.pendingCount=0;s.pendingSince=null;return {state:s,evidence:ev,event:null};}
  if(hasLock&&s.lastFlipAt&&now-s.lastFlipAt<20000){s.pendingDir=null;s.pendingCount=0;s.pendingSince=null;return {state:s,evidence:ev,event:null};}
  const candidate=ev.direction;
  if(!candidate || (hasLock&&candidate===s.direction)){
    s.pendingDir=null;s.pendingCount=0;s.pendingSince=null;return {state:s,evidence:ev,event:null};
  }
  if(s.pendingDir!==candidate){s.pendingDir=candidate;s.pendingCount=1;s.pendingSince=now;}
  else s.pendingCount+=1;
  if(s.pendingCount>=3 && now-s.pendingSince>=12000){
    const was=s.direction;
    s.direction=candidate;s.lockedAt=now;s.lastFlipAt=was?now:null;
    s.flipCount+=was?1:0;
    s.pendingDir=null;s.pendingCount=0;s.pendingSince=null;s.warningDir=null;
    s.lastReason=was?`Reversed from ${was} after 3 confirmed checks.`:'Initial direction confirmed after 3 checks.';
    return {state:s,evidence:ev,event:{type:was?'FLIP':'LOCK',from:was,to:candidate,time:now,marketId}};
  }
  return {state:s,evidence:ev,event:null};
}
function ema(values,period){let e=null;const alpha=2/(period+1),out=[];for(const v of values){if(!Number.isFinite(v)){out.push(e);continue;}e=e===null?v:e+(v-e)*alpha;out.push(e);}return out;}
const api={slotFor,windowTimes,decodeTrade,pressure,evidence,signalStep,emptySignal,ema};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.BTCPulseLogic=api;
})(typeof window!=='undefined'?window:globalThis);
