// api/jupiter.js - Jupiter proxy (CommonJS)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { action, params } = req.body || {};
  try {
    if (action === 'quote') {
      const url = 'https://quote-api.jup.ag/v6/quote?' + new URLSearchParams(params).toString();
      const r   = await fetch(url, { headers: { 'Accept': 'application/json' } });
      return res.status(200).json(await r.json());
    }
    if (action === 'swap') {
      const r = await fetch('https://quote-api.jup.ag/v6/swap', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      });
      return res.status(200).json(await r.json());
    }
    return res.status(400).json({ error: 'Onbekende actie' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
