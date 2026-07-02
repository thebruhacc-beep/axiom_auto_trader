// api/rpc.js - Vercel Serverless Function
// Draait server-side: geen CORS probleem
// Browser roept /api/rpc aan → deze functie haalt saldo op van Solana

export default async function handler(req, res) {
  // CORS headers zodat onze eigen site dit mag aanroepen
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.body || {};

  if (!address || typeof address !== 'string' || address.length < 32) {
    return res.status(400).json({ error: 'Ongeldig wallet adres' });
  }

  // Probeer meerdere RPC endpoints server-side (geen CORS hier)
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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal:  AbortSignal.timeout(5000),
      });

      if (!r.ok) continue;
      const d = await r.json();
      if (d.error) continue;

      const lamports = d.result?.value ?? d.result;
      if (typeof lamports === 'number' && lamports >= 0) {
        return res.status(200).json({
          sol:      lamports / 1e9,
          lamports: lamports,
          address:  address,
          source:   url.split('?')[0],
        });
      }
    } catch (e) {
      continue;
    }
  }

  return res.status(503).json({ error: 'Alle RPC endpoints onbereikbaar' });
}
