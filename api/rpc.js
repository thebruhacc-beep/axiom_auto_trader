const https = require('https');

function rpcPost(hostname, path, method, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname, port: 443, path, method: method || 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ ok: res.statusCode < 400, status: res.statusCode, data: JSON.parse(d) }); } catch(e) { resolve({ ok: false, status: res.statusCode, data: null }); } });
    });
    req.on('error', () => resolve({ ok: false, data: null }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, data: null }); });
    if (data) req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { action, address, tokenAddress } = req.body || {};

  // RugCheck proxy
  if (action === 'rugcheck' && tokenAddress) {
    const r = await rpcPost('api.rugcheck.xyz', '/v1/tokens/' + tokenAddress + '/report/summary', 'GET', null);
    if (r.ok && r.data) return res.status(200).json(r.data);
    return res.status(200).json({ score: 50, topHolders: [], markets: [] });
  }

  // Solana balance
  if (address) {
    const body = { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address, { commitment: 'confirmed' }] };
    const endpoints = [
      'api.mainnet-beta.solana.com',
      'rpc.ankr.com',
      'mainnet.helius-rpc.com',
    ];
    const paths = ['/','/solana','/?api-key=15319d07-b4d3-4376-905b-3885f0bb1211'];
    for (let i = 0; i < endpoints.length; i++) {
      const r = await rpcPost(endpoints[i], paths[i] || '/', 'POST', body);
      if (!r.ok || !r.data) continue;
      const lam = r.data.result?.value ?? (typeof r.data.result === 'number' ? r.data.result : null);
      if (lam !== null && lam >= 0) return res.status(200).json({ sol: lam / 1e9, lamports: lam, address });
    }
    return res.status(503).json({ error: 'RPC fout' });
  }

  return res.status(400).json({ error: 'Geen actie' });
};
Done
