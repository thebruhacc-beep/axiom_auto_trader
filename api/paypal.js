// /api/paypal.js
// Vercel serverless function - draait server-side, PAYPAL_CLIENT_ID en PAYPAL_SECRET
// komen uit environment variables (Vercel dashboard -> Settings -> Environment Variables).
// Worden NOOIT naar de browser gestuurd.

export default async function handler(req, res) {
  try {
    const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_ENV } = process.env;

    if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
      return res.status(500).json({
        error: 'PayPal env vars ontbreken. Zet PAYPAL_CLIENT_ID en PAYPAL_SECRET in je Vercel project settings (of .env lokaal).'
      });
    }

    const base = PAYPAL_ENV === 'sandbox'
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';

    // Stap 1: OAuth access token ophalen via Client Credentials flow
    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok) {
      return res.status(tokenRes.status).json({ error: 'PayPal token ophalen mislukt', details: tokenData });
    }

    // Stap 2: transacties opvragen (max 31 dagen per call, PayPal limiet)
    const end = req.query.end_date ? new Date(req.query.end_date) : new Date();
    const start = req.query.start_date
      ? new Date(req.query.start_date)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      fields: 'all',
      page_size: '100',
      page: req.query.page || '1'
    });

    const txRes = await fetch(`${base}/v1/reporting/transactions?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const txData = await txRes.json();

    if (!txRes.ok) {
      return res.status(txRes.status).json({
        error: 'PayPal transacties ophalen mislukt. Let op: Transaction Search API vereist een Business account met reporting-rechten.',
        details: txData
      });
    }

    const transactions = (txData.transaction_details || []).map(t => ({
      id: t.transaction_info?.transaction_id,
      date: t.transaction_info?.transaction_initiation_date,
      amount: t.transaction_info?.transaction_amount?.value,
      currency: t.transaction_info?.transaction_amount?.currency_code,
      status: t.transaction_info?.transaction_status,
      note: t.transaction_info?.transaction_subject || t.transaction_info?.transaction_note || '',
      payer: t.payer_info?.email_address || ''
    }));

    res.status(200).json({
      transactions,
      total_pages: txData.total_pages || 1,
      total_items: txData.total_items || transactions.length,
      range: { start: start.toISOString(), end: end.toISOString() }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
