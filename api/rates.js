// Vercel Serverless Function: /api/rates
// Fetches live gold & silver spot prices (free, no API key) from GoldAPI.io's
// public static endpoint and converts them to an approximate Indian retail
// rate per gram.
//
// IMPORTANT: GoldAPI's free static endpoint returns the INTERNATIONAL spot
// price (converted to INR), refreshed roughly every 30 minutes. Indian
// jewellery retail rates run higher than raw spot because they bake in
// import duty, GST-exclusive dealer premium, and local market conditions.
// GOLD_PREMIUM / SILVER_PREMIUM below correct for that gap. These were
// calibrated against public Indian market rates at build time — check them
// against your bullion supplier's quote occasionally and adjust if they drift.
 
const GOLD_PREMIUM = 1.25;   // ~25% above raw spot-converted price
const SILVER_PREMIUM = 1.05; // ~5% above raw spot-converted price
const TROY_OUNCE_TO_GRAM = 31.1034768;
 
module.exports = async (req, res) => {
  try {
    const [goldRes, silverRes] = await Promise.all([
      fetch('https://www.goldapi.io/api/static/XAU/INR'),
      fetch('https://www.goldapi.io/api/static/XAG/INR')
    ]);
 
    if (!goldRes.ok || !silverRes.ok) {
      throw new Error('upstream_error');
    }
 
    const gold = await goldRes.json();
    const silver = await silverRes.json();
 
    const g24 = Math.round(gold.price_gram_24k * GOLD_PREMIUM);
    const g22 = Math.round(gold.price_gram_22k * GOLD_PREMIUM);
    const g18 = Math.round(gold.price_gram_18k * GOLD_PREMIUM);
    const silverGram = Math.round((silver.price / TROY_OUNCE_TO_GRAM) * SILVER_PREMIUM);
 
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      g24,
      g22,
      g18,
      silver: silverGram,
      source: 'goldapi.io (spot, adjusted)',
      updated: new Date().toISOString()
    });
  } catch (err) {
    res.status(502).json({ error: 'rate_fetch_failed' });
  }
};
 
