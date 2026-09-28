// /api/admin — owner only. Saves today's rates. Requires the ADMIN_PASSWORD
// set in Vercel Environment Variables. Without it, nothing can be changed.
 
const crypto = require('crypto');
const KEY = 'dmj_rates';
 
function redisConf() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
 
async function redisCmd(cmd) {
  const c = redisConf();
  const r = await fetch(c.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error('redis_error');
  return (await r.json()).result;
}
 
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
 
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
 
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'password_not_configured' });
 
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
 
  if (!safeEqual(body.password || '', expected)) {
    await new Promise(r => setTimeout(r, 800)); // slows down password guessing
    return res.status(401).json({ error: 'wrong_password' });
  }
  if (!redisConf()) return res.status(500).json({ error: 'storage_not_connected' });
 
  try {
    if (body.action === 'clear') {
      await redisCmd(['DEL', KEY]);
      return res.status(200).json({ ok: true, cleared: true });
    }
    const keys = ['g24', 'g22', 'g18', 'silver'];
    const vals = keys.map(k => Number(body[k]));
    if (vals.some(v => !isFinite(v) || v <= 0 || v > 1000000)) {
      return res.status(400).json({ error: 'invalid_numbers' });
    }
    const data = { g24: vals[0], g22: vals[1], g18: vals[2], silver: vals[3], updated: new Date().toISOString() };
    await redisCmd(['SET', KEY, JSON.stringify(data)]);
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    return res.status(500).json({ error: 'save_failed' });
  }
};
 
