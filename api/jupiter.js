// api/jupiter.js - Jupiter API proxy (CommonJS)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const body   = req.body || {};
  const action = body.action;
  const params = body.params || {};

  try {
    if (action === 'quote') {
      // Bouw query string
      const qs = Object.entries(params)
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&');
      const url = 'https://quote-api.jup.ag/v6/quote?' + qs;

      const r = await fetch(url, {
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      });

      const text = await r.text();
      let data;
      try { data = JSON.parse(text); }
      catch(e) { return res.status(502).json({ error: 'Jupiter ongeldig JSON: ' + text.slice(0, 200) }); }

      if (!r.ok) return res.status(r.status).json({ error: 'Jupiter quote HTTP ' + r.status, detail: data });
      return res.status(200).json(data);
    }

    if (action === 'swap') {
      const r = await fetch('https://quote-api.jup.ag/v6/swap', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify(params),
      });

      const text = await r.text();
      let data;
      try { data = JSON.parse(text); }
      catch(e) { return res.status(502).json({ error: 'Jupiter swap ongeldig JSON: ' + text.slice(0, 200) }); }

      if (!r.ok) return res.status(r.status).json({ error: 'Jupiter swap HTTP ' + r.status, detail: data });
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Onbekende actie: ' + action });

  } catch(e) {
    console.error('[Jupiter proxy]', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
};
