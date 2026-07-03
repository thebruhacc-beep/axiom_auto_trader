// api/rpc.js - Vercel Serverless Function (CommonJS)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET request voor simpele test
  if (req.method === 'GET') {
    const address = req.query && req.query.address;
    if (!address) return res.status(200).json({ status: 'ok', message: 'Gebruik POST met {address}' });
    return await fetchBalance(address, res);
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const address = body.address;
    if (!address) return res.status(400).json({ error: 'Geen adres' });
    return await fetchBalance(address, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

async function fetchBalance(address, res) {
  const endpoints = [
    'https://api.mainnet-beta.solana.com',
    'https://rpc.ankr.com/solana',
    'https://mainnet.helius-rpc.com/?api-key=15319d07-b4d3-4376-905b-3885f0bb1211',
    'https://solana.publicnode.com',
  ];

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getBalance',
    params: [address, { commitment: 'confirmed' }],
  });

  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.error) continue;
      const lamports = (d.result && typeof d.result.value === 'number')
        ? d.result.value
        : (typeof d.result === 'number' ? d.result : null);
      if (lamports !== null && lamports >= 0) {
        return res.status(200).json({
          sol: lamports / 1e9,
          lamports,
          address,
          source: url.split('?')[0],
        });
      }
    } catch(e) { continue; }
  }

  return res.status(503).json({ error: 'Alle RPC endpoints onbereikbaar', address });
}
