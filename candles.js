// Public Coinbase 1-minute OHLCV candles for chart context (not Kalshi settlement prices).
function json(status,body){return {statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=20','Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)}}
async function handler() {
  try {
    const now=Date.now();
    const start=new Date(now-95*60000).toISOString(),end=new Date(now).toISOString();
    const url=new URL('https://api.exchange.coinbase.com/products/BTC-USD/candles');
    url.searchParams.set('granularity','60');url.searchParams.set('start',start);url.searchParams.set('end',end);
    const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'BTC-Pulse-ReadOnly/1.0'},signal:AbortSignal.timeout(7000)});
    if(!r.ok)throw new Error(`Coinbase HTTP ${r.status}`);
    const raw=await r.json();
    if(!Array.isArray(raw))throw new Error('Unexpected Coinbase candle response');
    const candles=raw.map(c=>({t:c[0]*1000,low:Number(c[1]),high:Number(c[2]),open:Number(c[3]),close:Number(c[4]),volume:Number(c[5])}))
      .filter(c=>Object.values(c).every(Number.isFinite)&&c.close>0).sort((a,b)=>a.t-b.t);
    return json(200,{ok:true,asOf:new Date().toISOString(),candles});
  }catch(e){return json(502,{ok:false,error:`Candle feed failed: ${String(e.message||e).slice(0,160)}`})}
}
module.exports={handler};
