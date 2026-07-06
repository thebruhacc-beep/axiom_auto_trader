// api/jupiter.js - Jupiter proxy zonder externe dependencies
const https = require('https');
const http  = require('http');

function request(urlStr, method, body) {
  return new Promise((resolve, reject) => {
    const url   = new URL(urlStr);
    const lib   = url.protocol === 'https:' ? https : http;
    const data  = body ? JSON.stringify(body) : null;
    const opts  = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   method || 'GET',
      headers:  {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = lib.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { resolve({ ok: false, status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    if (data) req.write(data);
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
      const qs  = Object.entries(params || {}).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      const r   = await request('https://quote-api.jup.ag/v6/quote?' + qs, 'GET');
      return res.status(r.status).json(r.data);
    }
    if (action === 'swap') {
      const r = await request('https://quote-api.jup.ag/v6/swap', 'POST', params);
      return res.status(r.status).json(r.data);
    }
    return res.status(400).json({ error: 'Onbekende actie' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
