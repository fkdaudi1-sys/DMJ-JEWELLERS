// /api/chat — AI assistant for DMJ Jewellers.
// Free setup: uses Google's Gemini API free tier (no billing needed).
// Needs Vercel env vars: GEMINI_API_KEY (required), PEXELS_API_KEY (optional, for pictures).
// Optional: GEMINI_MODEL (default gemini-flash-latest).

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const PER_IP_DAILY = 30;     // messages per visitor per day
const TOTAL_DAILY = 500;     // messages for the whole site per day (protects your bill)

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

async function allowed(ip) {
  if (!redisConf()) return true; // limits need the Redis storage from the admin setup
  const day = new Date().toISOString().slice(0, 10);
  try {
    const kIp = 'chat:ip:' + ip + ':' + day, kAll = 'chat:total:' + day;
    const a = await redisCmd(['INCR', kIp]);
    if (a === 1) await redisCmd(['EXPIRE', kIp, 90000]);
    if (a > PER_IP_DAILY) return false;
    const t = await redisCmd(['INCR', kAll]);
    if (t === 1) await redisCmd(['EXPIRE', kAll, 90000]);
    return t <= TOTAL_DAILY;
  } catch (e) { return true; }
}

async function getRates(req) {
  try {
    const r = await fetch('https://' + req.headers.host + '/api/rates');
    if (r.ok) return await r.json();
  } catch (e) {}
  return null;
}

async function pexels(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch('https://api.pexels.com/v1/search?per_page=4&query=' + encodeURIComponent(query), {
      headers: { Authorization: key }
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.photos || []).slice(0, 4).map(p => ({
      thumb: p.src.medium, link: p.url, credit: p.photographer, alt: p.alt || query
    }));
  } catch (e) { return []; }
}

function systemPrompt(rates) {
  let rateLine = "Today's rates are not available right now; ask the customer to confirm rates at the shop.";
  if (rates && rates.g22) {
    const who = rates.source === 'manual'
      ? 'set by the shop owner'
      : 'live international market rate, so the shop counter rate can differ';
    rateLine = `Indicative rates per gram (${who}): 24K gold Rs ${rates.g24}, 22K gold Rs ${rates.g22}, 18K gold Rs ${rates.g18}, silver Rs ${rates.silver}.`;
  }
  return `You are the friendly AI assistant on the website of DMJ Jewellers, a jewellery shop at Chokshi Bazar, Junagadh, Gujarat, India (WhatsApp/phone 99046 68792, Instagram @dmj_jewellers).

You can answer general jewellery questions: designs and styles (bridal, temple, antique, kundan, polki, diamond, lightweight daily wear, etc.), gold and silver purity (24K/22K/18K, 916, 999, 925, BIS hallmarking), how making charges and GST work, jewellery care, gifting ideas, and what to check when buying or selling gold.

${rateLine}

Rules:
- Reply in the customer's language (English, Hindi or Gujarati). Keep answers short and clear, usually under 120 words.
- Never promise a final price, discount, offer, stock, delivery or shop timing; you do not know them. For those, invite the customer to WhatsApp or visit the shop.
- Do not invent facts about DMJ Jewellers beyond what is written here.
- If asked for something unrelated to jewellery or the shop, politely steer back.
- If the customer wants to see designs or pictures, answer briefly and add one final line exactly like [[images: short English search phrase]] (example: [[images: bridal gold necklace set]]). Pictures are only design inspiration from the internet, not the shop's stock; say so in one short sentence. Add the line only when pictures are requested.
- You are an AI assistant; say so if asked.`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'not_configured' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  let msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-10).map(m => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    content: String((m && m.content) || '').slice(0, 600)
  })).filter(m => m.content.trim());
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'bad_request' });

  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (!(await allowed(ip))) return res.status(429).json({ error: 'limit_reached' });

  try {
    const rates = await getRates(req);
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
      method: 'POST',
      headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(rates) }] },
        contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 1000 }
      })
    });
    if (!r.ok) throw new Error('ai_error');
    const j = await r.json();
    const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
    let text = parts.map(p => p.text || '').join('').trim();

    let images = [];
    const m = text.match(/\[\[images:\s*([^\]]{2,80})\]\]/i);
    if (m) {
      images = await pexels(m[1].trim());
      text = text.replace(m[0], '').trim();
    }
    res.status(200).json({ reply: text || 'Sorry, please try again.', images });
  } catch (e) {
    res.status(502).json({ error: 'chat_failed' });
  }
};
