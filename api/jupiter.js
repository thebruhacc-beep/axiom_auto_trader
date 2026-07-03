// api/jupiter.js - Jupiter proxy met https module (geen fetch)
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

function httpsPost(url, payload) {
  return new Promise((resolve, reject) => {
    const body    = JSON.stringify(payload);
    const urlObj  = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const { action, params } = req.body || {};

  try {
    if (action === 'quote') {
      const qs  = Object.entries(params || {})
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&');
      const url = 'https://quote-api.jup.ag/v6/quote?' + qs;
      const r   = await httpsGet(url);
      if (r.status !== 200) return res.status(r.status).json({ error: 'Jupiter quote fout', detail: r.body });
      return res.status(200).json(r.body);
    }

    if (action === 'swap') {
      const r = await httpsPost('https://quote-api.jup.ag/v6/swap', params || {});
      if (r.status !== 200) return res.status(r.status).json({ error: 'Jupiter swap fout', detail: r.body });
      return res.status(200).json(r.body);
    }

    return res.status(400).json({ error: 'Onbekende actie: ' + action });

  } catch(e) {
    console.error('[jupiter]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
