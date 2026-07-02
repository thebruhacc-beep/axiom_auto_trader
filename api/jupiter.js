// api/jupiter.js - Jupiter API proxy
// Jupiter heeft CORS restricties voor sommige domeinen
// Deze proxy draait server-side en forwardt de requests

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, params } = req.body || {};

  try {
    let result;

    if (action === 'quote') {
      // Haal Jupiter quote op
      const url = 'https://quote-api.jup.ag/v6/quote?' + new URLSearchParams(params).toString();
      const r   = await fetch(url, { headers: { 'Accept': 'application/json' } });
      result    = await r.json();
    }
    else if (action === 'swap') {
      // Bouw swap transactie
      const r = await fetch('https://quote-api.jup.ag/v6/swap', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      });
      result = await r.json();
    }
    else {
      return res.status(400).json({ error: 'Onbekende actie: ' + action });
    }

    return res.status(200).json(result);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
