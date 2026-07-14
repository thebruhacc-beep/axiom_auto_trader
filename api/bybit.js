// /api/bybit.js
// Vercel serverless function - BYBIT_API_KEY en BYBIT_API_SECRET komen uit
// environment variables. Signing gebeurt hier server-side, secret verlaat de server nooit.

import crypto from 'crypto';

export default async function handler(req, res) {
  try {
    const { BYBIT_API_KEY, BYBIT_API_SECRET } = process.env;

    if (!BYBIT_API_KEY || !BYBIT_API_SECRET) {
      return res.status(500).json({
        error: 'Bybit env vars ontbreken. Zet BYBIT_API_KEY en BYBIT_API_SECRET in je Vercel project settings.'
      });
    }

    const base = 'https://api.bybit.com';
    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const accountType = req.query.accountType || 'UNIFIED';
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
