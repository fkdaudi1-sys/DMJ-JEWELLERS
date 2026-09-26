// Vercel Serverless Function: /api/rates
// Fetches live gold & silver spot prices (free, no API key) from GoldAPI.io's
// public static endpoint, converted to INR.
//
// NOTE: This is the raw INTERNATIONAL SPOT price converted to INR — the same
// category of number Google's gold price widget shows. It will run LOWER
// than the retail rate a jeweller actually quotes a customer, because it
// does not include import duty or dealer premium. Kept intentionally
// uncorrected per DMJ Jewellers' preference to match Google's figure.
 
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
 
    const g24 = Math.round(gold.price_gram_24k);
    const g22 = Math.round(gold.price_gram_22k);
    const g18 = Math.round(gold.price_gram_18k);
    const silverGram = Math.round(silver.price / TROY_OUNCE_TO_GRAM);
 
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json({
      g24,
      g22,
      g18,
      silver: silverGram,
      source: 'goldapi.io (international spot)',
      updated: new Date().toISOString()
    });
  } catch (err) {
    res.status(502).json({ error: 'rate_fetch_failed' });
  }
};
 
