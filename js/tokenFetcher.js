/* ============================================================
   TOKENFETCHER.JS - Parallelle API calls met timeout
   Gebruikt DexScreener (gratis) + RugCheck (gratis)
   ============================================================ */
'use strict';

const TokenFetcher = (() => {

  let _solPrice   = 170;
  let _solPriceAt = 0;

  function _fetchTimeout(url, ms = 5000) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
      .finally(() => clearTimeout(timer));
  }

  async function getSolPrice() {
    if (Date.now() - _solPriceAt < 60000) return _solPrice;
    try {
      const r = await _fetchTimeout('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', 4000);
      if (r.ok) { const d = await r.json(); _solPrice = d.solana?.usd || _solPrice; }
    } catch { /* cache */ }
    _solPriceAt = Date.now();
    return _solPrice;
  }

  // ── DEXSCREENER ───────────────────────────────────────────

  async function _fetchTrending() {
    try {
      const r = await _fetchTimeout('https://api.dexscreener.com/latest/dex/search?q=solana+meme', 6000);
      if (!r.ok) return [];
      const d = await r.json();
      return (d.pairs || []).filter(p => p.chainId === 'solana' && p.liquidity?.usd > 0);
    } catch { return []; }
  }

  async function _fetchNew() {
    try {
      const r = await _fetchTimeout('https://api.dexscreener.com/token-profiles/latest/v1', 6000);
      if (!r.ok) return [];
      const items    = await r.json();
      const solItems = Array.isArray(items)
        ? items.filter(i => i.chainId === 'solana').slice(0, 12)
        : [];

      // Alle token lookups parallel
      const results = await Promise.allSettled(
        solItems.map(item =>
          _fetchTimeout(`https://api.dexscreener.com/latest/dex/tokens/${item.tokenAddress}`, 5000)
            .then(r => r.ok ? r.json() : null)
        )
      );

      const pairs = [];
      for (const res of results) {
        if (res.status !== 'fulfilled' || !res.value?.pairs?.length) continue;
        const best = res.value.pairs
          .filter(p => p.chainId === 'solana' && (p.liquidity?.usd || 0) > 0)
          .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
        if (best) pairs.push(best);
      }
      return pairs;
    } catch { return []; }
  }

  // ── RUGCHECK ──────────────────────────────────────────────

  async function _fetchRugCheck(address) {
    try {
      const r = await _fetchTimeout(`https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`, 4000);
      if (!r.ok) return null;
      const d       = await r.json();
      const holders = (d.topHolders || []).sort((a, b) => b.pct - a.pct);
      return {
        score:                d.score               || 50,
        largestHolderPercent: holders[0]?.pct       || 0,
        topHolderPercent:     holders.slice(0,10).reduce((s, h) => s + (h.pct || 0), 0),
        isLiquidityLocked:    (d.markets || []).some(m => (m.lpLockedPct || 0) > 80),
      };
    } catch { return null; }
  }

  // ── VERWERK PAIRS NAAR TOKENS ─────────────────────────────

  async function _processPairs(pairs) {
    // Alle RugCheck calls parallel (met timeout per stuk)
    const rugResults = await Promise.allSettled(
      pairs.map(p => _fetchRugCheck(p.baseToken?.address || ''))
    );

    const tokens = [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const addr = pair.baseToken?.address;
      if (!addr || !pair.priceUsd) continue;

      const rug = (rugResults[i].status === 'fulfilled' && rugResults[i].value)
        ? rugResults[i].value
        : { score: 50, largestHolderPercent: 15, topHolderPercent: 30, isLiquidityLocked: false };

      const buys24   = pair.txns?.h24?.buys  || 0;
      const sells24  = pair.txns?.h24?.sells || 0;
      const buys5m   = pair.txns?.m5?.buys   || 0;
      const sells5m  = pair.txns?.m5?.sells  || 0;
      const created  = pair.pairCreatedAt    || (Date.now() - 60 * 60 * 1000);
      const ageMins  = (Date.now() - created) / 60000;
      const txPerMin = ageMins > 0 ? (buys5m + sells5m) / Math.min(ageMins, 5) : 0;
      const bsRatio  = sells24 > 0 ? buys24 / sells24 : buys24 > 0 ? 5 : 1;

      tokens.push({
        address:              addr,
        symbol:               (pair.baseToken?.symbol || '???').toUpperCase(),
        name:                 pair.baseToken?.name    || 'Unknown',
        marketCap:            pair.marketCap           || pair.fdv                || 0,
        liquidity:            pair.liquidity?.usd      || 0,
        volume24h:            pair.volume?.h24         || 0,
        volume5m:             pair.volume?.m5          || 0,
        priceUsd:             parseFloat(pair.priceUsd || '0'),
        priceChange5m:        pair.priceChange?.m5     || 0,
        priceChange1h:        pair.priceChange?.h1     || 0,
        priceChange24h:       pair.priceChange?.h24    || 0,
        holderCount:          rug.topHolderPercent > 0 ? Math.round(100 / Math.max(rug.largestHolderPercent, 1)) * 5 : 50,
        topHolderPercent:     rug.topHolderPercent,
        largestHolderPercent: rug.largestHolderPercent,
        buyCount24h:          buys24,
        sellCount24h:         sells24,
        buySellRatio:         Math.min(bsRatio, 20),
        createdAt:            created,
        ageMinutes:           ageMins,
        txPerMinute:          txPerMin,
        isLiquidityLocked:    rug.isLiquidityLocked,
        rugCheckScore:        rug.score,
        dexscreenerUrl:       pair.url || `https://dexscreener.com/solana/${addr}`,
        pairAddress:          pair.pairAddress || addr,
      });
    }
    return tokens;
  }

  // ── HOOFD SCAN ────────────────────────────────────────────

  async function scanAll() {
    const t0 = Date.now();

    const [tRes, nRes] = await Promise.allSettled([_fetchTrending(), _fetchNew()]);
    const all = [
      ...(tRes.status === 'fulfilled' ? tRes.value : []),
      ...(nRes.status === 'fulfilled' ? nRes.value : []),
    ];

    // Dedupliceer
    const seen   = new Set();
    const unique = all.filter(p => {
      const a = p.baseToken?.address;
      if (!a || seen.has(a)) return false;
      seen.add(a); return true;
    });

    Storage.addLog('info', `DexScreener: ${unique.length} unieke pairs (${Date.now()-t0}ms)`);

    const tokens = await _processPairs(unique);
    Storage.addLog('info', `Verwerkt: ${tokens.length} tokens (${((Date.now()-t0)/1000).toFixed(1)}s)`);

    return tokens;
  }

  return { scanAll, getSolPrice };
})();
