// api/jupiter.js - Jupiter proxy
// Gebruikt Node.js https module (geen fetch, werkt altijd op Vercel)
const https = require('https');

function httpsRequest(hostname, path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: hostname,
      port: 443,
      path: path,
      method: method || 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(raw) });
        } catch(e) {
          resolve({ status: res.statusCode, json: { error: 'Ongeldige JSON: ' + raw.slice(0, 200) } });
        }
      });
    });

    req.on('error', (e) => resolve({ status: 500, json: { error: e.message } }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ status: 500, json: { error: 'timeout' } }); });

    if (data) req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { action, params } = req.body || {};

  if (action === 'quote') {
    const p = params || {};
    const qs = [
      'inputMint='   + encodeURIComponent(p.inputMint   || ''),
      'outputMint='  + encodeURIComponent(p.outputMint  || ''),
      'amount='      + encodeURIComponent(p.amount      || ''),
      'slippageBps=' + encodeURIComponent(p.slippageBps || '50'),
      'onlyDirectRoutes=false',
    ].join('&');

    const r = await httpsRequest('quote-api.jup.ag', '/v6/quote?' + qs, 'GET');
    return res.status(r.status).json(r.json);
  }

  if (action === 'swap') {
    const r = await httpsRequest('quote-api.jup.ag', '/v6/swap', 'POST', params);
    return res.status(r.status).json(r.json);
  }

  return res.status(400).json({ error: 'Onbekende actie: ' + action });
};
