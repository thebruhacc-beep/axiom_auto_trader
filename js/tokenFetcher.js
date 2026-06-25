/* ============================================================
   TOKENFETCHER.JS - Werkende DexScreener endpoints (2025)
   Gebruikt alleen stabiele, gratis API endpoints
   ============================================================ */
'use strict';

const TokenFetcher = (() => {

  let _solPrice   = 170;
  let _solPriceAt = 0;

  // Maak fetch met timeout + CORS-vriendelijke headers
  function _ft(url, ms = 6000) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, {
      signal:  ctrl.signal,
      headers: { 'Accept': 'application/json' },
      mode:    'cors',
    }).finally(() => clearTimeout(timer));
  }

  // ── SOL PRIJS ─────────────────────────────────────────────
  async function getSolPrice() {
    if (Date.now() - _solPriceAt < 90000) return _solPrice;
    try {
      // Gebruik DexScreener zelf voor SOL prijs (geen CORS issues)
      const r = await _ft('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111112', 5000);
      if (r.ok) {
        const d = await r.json();
        const sol = (d.pairs || []).find(p => p.quoteToken?.symbol === 'USDC' || p.quoteToken?.symbol === 'USDT');
        if (sol?.priceUsd) _solPrice = parseFloat(sol.priceUsd);
      }
    } catch { /* gebruik cache */ }
    _solPriceAt = Date.now();
    return _solPrice;
  }

  // ── DEXSCREENER ENDPOINTS ─────────────────────────────────
  // Endpoint 1: Zoek op "solana" met verschillende queries
  async function _fetchByQuery(query) {
    try {
      const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
      const r   = await _ft(url, 7000);
      if (!r.ok) return [];
      const d = await r.json();
      return (d.pairs || []).filter(p =>
        p.chainId === 'solana' &&
        (p.liquidity?.usd || 0) > 1000 &&
        parseFloat(p.priceUsd || '0') > 0
      );
    } catch (e) {
      console.warn('[TokenFetcher] query fout:', query, e.name);
      return [];
    }
  }

  // Endpoint 2: Haal pairs op via token adres (betrouwbaarst)
  async function _fetchByAddress(address) {
    try {
      const r = await _ft(`https://api.dexscreener.com/latest/dex/tokens/${address}`, 5000);
      if (!r.ok) return null;
      const d = await r.json();
      if (!d.pairs?.length) return null;
      // Neem de pair met hoogste liquiditeit
      return d.pairs
        .filter(p => p.chainId === 'solana' && (p.liquidity?.usd || 0) > 0)
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;
    } catch { return null; }
  }

  // Bekende actieve Solana meme token adressen als fallback
  // Dit zorgt ervoor dat er altijd iets te scannen is
  const KNOWN_TOKENS = [
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
    'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
    'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5',  // MEW
    'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
    '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
    'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82',  // BOME
    'A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump',  // FWOG
    'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump',  // CHILLGUY
  ];

  // ── RUGCHECK ──────────────────────────────────────────────
  async function _fetchRugCheck(address) {
    try {
      const r = await _ft(
        `https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`,
        3500
      );
      if (!r.ok) return _defaultRug();
      const d       = await r.json();
      const holders = (d.topHolders || []).sort((a, b) => b.pct - a.pct);
      return {
        score:                d.score                || 50,
        largestHolderPercent: holders[0]?.pct        || 0,
        topHolderPercent:     holders.slice(0,10).reduce((s,h) => s + (h.pct||0), 0),
        isLiquidityLocked:    (d.markets||[]).some(m => (m.lpLockedPct||0) > 80),
      };
    } catch { return _defaultRug(); }
  }

  function _defaultRug() {
    return { score: 50, largestHolderPercent: 15, topHolderPercent: 35, isLiquidityLocked: false };
  }

  // ── PAIR → TOKEN OBJECT ───────────────────────────────────
  function _pairToToken(pair, rug) {
    const addr    = pair.baseToken?.address;
    if (!addr) return null;

    const buys24  = pair.txns?.h24?.buys  || 0;
    const sells24 = pair.txns?.h24?.sells || 0;
    const buys5m  = pair.txns?.m5?.buys   || 0;
    const sells5m = pair.txns?.m5?.sells  || 0;
    const created = pair.pairCreatedAt    || (Date.now() - 2 * 60 * 60 * 1000);
    const ageMins = Math.max(0, (Date.now() - created) / 60000);
    const txPerMin= buys5m + sells5m > 0 ? (buys5m + sells5m) / Math.min(ageMins || 5, 5) : 0;
    const bsRatio = sells24 > 0 ? buys24 / sells24 : buys24 > 0 ? 5 : 1;
    const price   = parseFloat(pair.priceUsd || '0');

    if (price <= 0) return null;

    return {
      address:              addr,
      symbol:               (pair.baseToken?.symbol || '???').toUpperCase().slice(0, 10),
      name:                 (pair.baseToken?.name   || 'Unknown').slice(0, 30),
      marketCap:            pair.marketCap    || pair.fdv           || 0,
      liquidity:            pair.liquidity?.usd                     || 0,
      volume24h:            pair.volume?.h24                        || 0,
      volume5m:             pair.volume?.m5                         || 0,
      priceUsd:             price,
      priceChange5m:        pair.priceChange?.m5                    || 0,
      priceChange1h:        pair.priceChange?.h1                    || 0,
      priceChange24h:       pair.priceChange?.h24                   || 0,
      holderCount:          rug.largestHolderPercent > 0
                              ? Math.round(100 / Math.max(rug.largestHolderPercent, 0.5)) * 3
                              : 100,
      topHolderPercent:     rug.topHolderPercent,
      largestHolderPercent: rug.largestHolderPercent,
      buyCount24h:          buys24,
      sellCount24h:         sells24,
      buySellRatio:         Math.min(Math.max(bsRatio, 0), 20),
      createdAt:            created,
      ageMinutes:           ageMins,
      txPerMinute:          txPerMin,
      isLiquidityLocked:    rug.isLiquidityLocked,
      rugCheckScore:        rug.score,
      dexscreenerUrl:       pair.url || `https://dexscreener.com/solana/${addr}`,
      pairAddress:          pair.pairAddress || addr,
    };
  }

  // ── HOOFD SCANFUNCTIE ─────────────────────────────────────
  async function scanAll() {
    const t0 = Date.now();

    // Haal pairs op via meerdere queries parallel
    const queries = ['solana meme', 'pump fun', 'solana new'];
    const [q1, q2, q3, knownPairs] = await Promise.allSettled([
      _fetchByQuery(queries[0]),
      _fetchByQuery(queries[1]),
      _fetchByQuery(queries[2]),
      // Haal ook bekende tokens op als baseline
      Promise.all(KNOWN_TOKENS.slice(0, 4).map(addr => _fetchByAddress(addr))),
    ]);

    const allPairs = [
      ...(q1.status === 'fulfilled' ? q1.value : []),
      ...(q2.status === 'fulfilled' ? q2.value : []),
      ...(q3.status === 'fulfilled' ? q3.value : []),
      ...(knownPairs.status === 'fulfilled' ? knownPairs.value.filter(Boolean) : []),
    ];

    // Dedupliceer op adres
    const seen   = new Set();
    const unique = allPairs.filter(p => {
      const a = p.baseToken?.address;
      if (!a || seen.has(a)) return false;
      seen.add(a);
      return true;
    });

    if (unique.length === 0) {
      Storage.addLog('warning', 'Geen pairs gevonden — DexScreener mogelijk tijdelijk onbereikbaar');
      return [];
    }

    Storage.addLog('info', `${unique.length} unieke pairs gevonden (${Date.now()-t0}ms)`);

    // Haal RugCheck data parallel op (max 3 sec per token)
    const rugResults = await Promise.allSettled(
      unique.map(p => _fetchRugCheck(p.baseToken?.address || ''))
    );

    // Verwerk naar token objecten
    const tokens = [];
    for (let i = 0; i < unique.length; i++) {
      const rug   = rugResults[i].status === 'fulfilled' && rugResults[i].value
        ? rugResults[i].value
        : _defaultRug();
      const token = _pairToToken(unique[i], rug);
      if (token) tokens.push(token);
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    Storage.addLog('info', `Scan klaar: ${tokens.length} tokens verwerkt in ${elapsed}s`);

    return tokens;
  }

  return { scanAll, getSolPrice };
})();
