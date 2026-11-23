// Public read-only Kalshi market data. No API keys, account, or order endpoints.
const API = 'https://external-api.kalshi.com/trade-api/v2';

function numberPrice(m, key) {
  const modern = m[`${key}_dollars`];
  if (modern !== null && modern !== undefined && modern !== '') {
    const n = Number(modern);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  }
  const legacy = m[key];
  if (legacy !== null && legacy !== undefined && legacy !== '') {
    const n = Number(legacy) / 100;
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  }
  return null;
}
function quote(m) {
  let yb = numberPrice(m,'yes_bid'), ya=numberPrice(m,'yes_ask');
  let nb = numberPrice(m,'no_bid'), na=numberPrice(m,'no_ask');
  // Kalshi bid for NO is the economic YES ask, and vice versa.
  if (ya===null && nb!==null) ya=1-nb;
  if (na===null && yb!==null) na=1-yb;
  if (yb===null && na!==null) yb=1-na;
  if (nb===null && ya!==null) nb=1-ya;
  if ([yb,ya,nb,na].some(x=>x===null || x<0 || x>1) || yb>ya || nb>na) return null;
  return {
    upPercent: Math.round(((yb+ya)/2)*10000)/100,
    downPercent: Math.round(((nb+na)/2)*10000)/100,
    yesBidPercent: Math.round(yb*10000)/100,
    yesAskPercent: Math.round(ya*10000)/100,
    noBidPercent: Math.round(nb*10000)/100,
    noAskPercent: Math.round(na*10000)/100,
    spreadPercent: Math.round((ya-yb)*10000)/100
  };
}
function findCurrentMarket(markets, now=Date.now()) {
  // Listings may go live long before the 15-minute observation interval.
  return (Array.isArray(markets)?markets:[])
    .filter(m => {
      const close=Date.parse(m.close_time);
      return String(m.ticker||'').startsWith('KXBTC15M-') &&
        ['open','active'].includes(String(m.status||'').toLowerCase()) &&
        Number.isFinite(close) && close-900000<=now && close>now;
    }).sort((a,b)=>Date.parse(a.close_time)-Date.parse(b.close_time))[0] || null;
}
function json(status,body) {
  return {statusCode:status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=4','Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)};
}
async function handler() {
  try {
    let all=[];
    let cursor=null;
    // Pages are bounded, but sufficiently large to handle many forthcoming markets.
    for (let page=0;page<3;page++) {
      const u=new URL(API+'/markets');
      u.searchParams.set('series_ticker','KXBTC15M');
      u.searchParams.set('status','open');
      u.searchParams.set('limit','200');
      if(cursor)u.searchParams.set('cursor',cursor);
      const r=await fetch(u,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(7000)});
      if(!r.ok)throw new Error(`Kalshi API HTTP ${r.status}`);
      const body=await r.json();
      all.push(...(body.markets||[]));
      if(findCurrentMarket(all))break;
      cursor=body.cursor;
      if(!cursor)break;
    }
    const m=findCurrentMarket(all);
    if(!m)return json(503,{ok:false,error:'No active 15-minute Bitcoin market found. Retrying soon.'});
    const q=quote(m);
    if(!q)return json(503,{ok:false,error:'Kalshi has no valid two-sided quote for the active market.'});
    const close=Date.parse(m.close_time);
    const strikeRaw=m.floor_strike;
    const strike=strikeRaw!==null && strikeRaw!==undefined && strikeRaw!=='' && Number.isFinite(Number(strikeRaw)) ? Number(strikeRaw) : null;
    return json(200,{
      ok:true,source:'Kalshi public Trade API',asOf:new Date().toISOString(),
      ticker:m.ticker,marketUrl:'https://kalshi.com/markets/kxbtc15m',
      openTime:new Date(close-900000).toISOString(),closeTime:m.close_time,
      strike, status:m.status, volume:m.volume_fp ?? m.volume ?? null,
      ...q
    });
  } catch(e) {
    return json(502,{ok:false,error:`Kalshi feed failed: ${String(e.message||e).slice(0,160)}`});
  }
}
module.exports={handler,findCurrentMarket,quote,numberPrice};
