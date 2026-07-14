// /api/bybit.js
// Vercel serverless function - BYBIT_API_KEY en BYBIT_API_SECRET komen uit
// environment variables. Signing gebeurt hier server-side, secret verlaat de server nooit.

import crypto from 'crypto';

export default async function handler(req, res) {
  try {
    // Credentials komen per request mee vanuit de browser (localStorage -> POST body),
    // met env vars als optionele fallback.
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const BYBIT_API_KEY = body.api_key || process.env.BYBIT_API_KEY;
    const BYBIT_API_SECRET = body.api_secret || process.env.BYBIT_API_SECRET;

    if (!BYBIT_API_KEY || !BYBIT_API_SECRET) {
      return res.status(500).json({
        error: 'Bybit credentials ontbreken. Vul API key en secret in bij Instellingen in het dashboard.'
      });
    }

    const base = 'https://api.bybit.com';
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const accountType = body.accountType || 'UNIFIED';
    const queryString = `accountType=${accountType}`;

    // Bybit v5 signing: timestamp + api_key + recv_window + queryString, HMAC-SHA256
    const signPayload = timestamp + BYBIT_API_KEY + recvWindow + queryString;
    const sign = crypto.createHmac('sha256', BYBIT_API_SECRET).update(signPayload).digest('hex');

    const bybitRes = await fetch(`${base}/v5/account/wallet-balance?${queryString}`, {
      headers: {
        'X-BAPI-API-KEY': BYBIT_API_KEY,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': sign
      }
    });
    const data = await bybitRes.json();

    if (data.retCode !== 0) {
      return res.status(400).json({ error: 'Bybit API fout (controleer of API key rechten heeft voor account read)', details: data });
    }

    res.status(200).json(data.result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
