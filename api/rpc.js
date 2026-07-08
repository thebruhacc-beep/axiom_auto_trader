// api/rpc.js - Solana RPC proxy met https module (geen fetch)
const https = require('https');

function rpcCall(url, body) {
  return new Promise((resolve, reject) => {
    const payload  = JSON.stringify(body);
    const urlObj   = new URL(url);
    const options  = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET test
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'RPC proxy actief' });
  }

  const address = (req.body || {}).address;
  if (!address) return res.status(400).json({ error: 'Geen adres' });

  const body = { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] };

  const endpoints = [
    'https://api.mainnet-beta.solana.com',
    'https://rpc.ankr.com/solana',
    'https://mainnet.helius-rpc.com/?api-key=15319d07-b4d3-4376-905b-3885f0bb1211',
    'https://solana.publicnode.com',
  ];

  for (const url of endpoints) {
    const d = await rpcCall(url, body);
    if (!d || d.error) continue;
    const lamports = d.result && typeof d.result.value === 'number' ? d.result.value : typeof d.result === 'number' ? d.result : null;
    if (lamports !== null && lamports >= 0) {
      return res.status(200).json({ sol: lamports / 1e9, lamports, address, source: url.split('?')[0] });
    }
  }

  return res.status(503).json({ error: 'Alle RPC endpoints faalden', address });
};
