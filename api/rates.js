// /api/rates  — public. Returns the rates every visitor sees.
// 1) If the owner has saved manual rates (via /admin.html), those are returned.
// 2) Otherwise falls back to live international spot price (like Google shows).
 
const TROY = 31.1034768;
const KEY = 'dmj_rates';
 
function redisConf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
 
async function redisCmd(cmd) {
  const c = redisConf();
  if (!c) return null;
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('redis_error');
  const j = await r.json();
  return j.result;
}
 
module.exports = async (req, res) => {
  try {
    let manual = null;
    try {
      const raw = await redisCmd(['GET', KEY]);
      if (raw) manual = JSON.parse(raw);
    } catch (e) { /* storage not connected yet — use market rate */ }
 
    if (manual && manual.g22) {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({
        g24: manual.g24, g22: manual.g22, g18: manual.g18, silver: manual.silver,
        source: 'manual', updated: manual.updated
      });
    }
 
    const [goldRes, silverRes] = await Promise.all([
      fetch('https://www.goldapi.io/api/static/XAU/INR'),
      fetch('https://www.goldapi.io/api/static/XAG/INR')
    ]);
    if (!goldRes.ok || !silverRes.ok) throw new Error('upstream_error');
    const gold = await goldRes.json();
    const silver = await silverRes.json();
 
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      g24: Math.round(gold.price_gram_24k),
      g22: Math.round(gold.price_gram_22k),
      g18: Math.round(gold.price_gram_18k),
      silver: Math.round(silver.price / TROY),
      source: 'market',
      updated: new Date().toISOString()
    });
  } catch (err) {
    res.status(502).json({ error: 'rate_fetch_failed' });
  }
};
 
