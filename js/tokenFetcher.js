/* ============================================================
   TOKENFETCHER.JS - Haalt live token data op via gratis API's
   DexScreener (geen key nodig) + RugCheck (geen key nodig)
   ============================================================ */

'use strict';

const TokenFetcher = (() => {

  // Cache SOL prijs 1 minuut
  let _solPrice = 150;
  let _solPriceAt = 0;

  async function getSolPrice() {
    if (Date.now() - _solPriceAt < 60000) return _solPrice;
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      if (r.ok) { const d = await r.json(); _solPrice = d.solana.usd; }
    } catch { /* gebruik cache */ }
    _solPriceAt = Date.now();
    return _solPrice;
  }

  // ── DEXSCREENER ───────────────────────────────────────────

  async function fetchTrending() {
    try {
      // Nieuwste Solana token pairs via DexScreener
      const r = await fetch('https://api.dexscreener.com/latest/dex/search?q=solana+meme', {
        headers: { 'Accept': 'application/json' },
      });
      if (!r.ok) return [];
      const data = await r.json();
      return (data.pairs || []).filter(p => p.chainId === 'solana');
    } catch (e) {
      console.warn('[TokenFetcher] trending fout:', e);
      return [];
    }
  }

  async function fetchNewPairs() {
    try {
      // Alternatief endpoint - boosted / nieuwe tokens
      const r = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
        headers: { 'Accept': 'application/json' },
      });
      if (!r.ok) return [];
      const items = await r.json();
      const solItems = items.filter(i => i.chainId === 'solana').slice(0, 15);

      const pairs = [];
      for (const item of solItems) {
        try {
          const pr = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${item.tokenAddress}`);
          if (!pr.ok) continue;
          const pd = await pr.json();
          if (pd.pairs && pd.pairs.length > 0) {
            const best = pd.pairs
              .filter(p => p.chainId === 'solana')
              .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
            if (best) pairs.push(best);
          }
        } catch { /* skip */ }
      }
      return pairs;
    } catch (e) {
      console.warn('[TokenFetcher] newPairs fout:', e);
      return [];
    }
  }

  // ── RUGCHECK ──────────────────────────────────────────────

  async function fetchRugCheck(address) {
    try {
      const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`);
      if (!r.ok) return _defaultRugCheck();
      const d = await r.json();

      const holders = (d.topHolders || []).sort((a, b) => b.pct - a.pct);
      return {
        score:                d.score || 50,
        largestHolderPercent: holders[0]?.pct || 0,
        topHolderPercent:     holders.slice(0, 10).reduce((s, h) => s + h.pct, 0),
        isLiquidityLocked:    (d.markets || []).some(m => m.lpLockedPct > 80),
      };
    } catch {
      return _defaultRugCheck();
    }
  }

  function _defaultRugCheck() {
    return { score: 50, largestHolderPercent: 0, topHolderPercent: 0, isLiquidityLocked: false };
  }

  // ── VERWERK PAIR NAAR TOKEN OBJECT ────────────────────────

  async function processPair(pair) {
    const addr   = pair.baseToken?.address;
    if (!addr) return null;

    const rug = await fetchRugCheck(addr);

    const buys24  = pair.txns?.h24?.buys  || 0;
    const sells24 = pair.txns?.h24?.sells || 0;
    const buys5m  = pair.txns?.m5?.buys   || 0;
    const sells5m = pair.txns?.m5?.sells  || 0;

    const createdAt  = pair.pairCreatedAt || Date.now();
    const ageMinutes = (Date.now() - createdAt) / 60000;
    const txPerMin   = ((buys5m + sells5m) / 5) || 0;
    const buySellRatio = sells24 > 0 ? buys24 / sells24 : buys24 > 0 ? 10 : 1;

    return {
      address:              addr,
      symbol:               pair.baseToken?.symbol || '???',
      name:                 pair.baseToken?.name   || 'Unknown',
      marketCap:            pair.marketCap  || pair.fdv || 0,
      liquidity:            pair.liquidity?.usd || 0,
      volume24h:            pair.volume?.h24 || 0,
      priceUsd:             parseFloat(pair.priceUsd || '0'),
      priceChange5m:        pair.priceChange?.m5 || 0,
      priceChange1h:        pair.priceChange?.h1 || 0,
      priceChange24h:       pair.priceChange?.h24 || 0,
      holderCount:          0, // Birdeye nodig voor echte count
      topHolderPercent:     rug.topHolderPercent,
      largestHolderPercent: rug.largestHolderPercent,
      buyCount24h:          buys24,
      sellCount24h:         sells24,
      buySellRatio,
      createdAt,
      ageMinutes,
      txPerMinute:          txPerMin,
      isLiquidityLocked:    rug.isLiquidityLocked,
      rugCheckScore:        rug.score,
      dexscreenerUrl:       pair.url || `https://dexscreener.com/solana/${addr}`,
      pairAddress:          pair.pairAddress || '',
    };
  }

  // ── HOOFD SCANFUNCTIE ─────────────────────────────────────

  async function scanAll() {
    const [trending, newPairs] = await Promise.allSettled([fetchTrending(), fetchNewPairs()]);

    const allPairs = [
      ...(trending.status === 'fulfilled' ? trending.value : []),
      ...(newPairs.status  === 'fulfilled' ? newPairs.value  : []),
    ];

    // Dedupliceer
    const seen = new Set();
    const unique = allPairs.filter(p => {
      const a = p.baseToken?.address;
      if (!a || seen.has(a)) return false;
      seen.add(a);
      return true;
    });

    Storage.addLog('info', `${unique.length} tokens gevonden via DexScreener`);

    const tokens = [];
    for (const pair of unique) {
      const t = await processPair(pair);
      if (t) tokens.push(t);
    }

    return tokens;
  }

  return { scanAll, getSolPrice };

})();
