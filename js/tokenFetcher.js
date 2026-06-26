/* ============================================================
   TOKENFETCHER.JS - Fix: betere endpoints voor NIEUWE tokens
   Pump.fun tokens via de juiste DexScreener endpoints
   ============================================================ */
'use strict';

const TokenFetcher = (() => {

  let _solPrice   = 170;
  let _solPriceAt = 0;

  function _ft(url, ms) {
    ms = ms || 6000;
    var ctrl  = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, ms);
    return fetch(url, {
      signal:  ctrl.signal,
      headers: { 'Accept': 'application/json' },
    }).finally(function() { clearTimeout(timer); });
  }

  async function getSolPrice() {
    if (Date.now() - _solPriceAt < 120000) return _solPrice;
    try {
      // Simpele SOL prijs via DexScreener USDC pair
      var r = await _ft('https://api.dexscreener.com/latest/dex/pairs/solana/58oQChx4yWmvKn3NeRJBb7drN5Gj1M1tBQKwcHDRPsc4', 4000);
      if (r.ok) {
        var d = await r.json();
        if (d.pair && d.pair.priceUsd) {
          _solPrice = parseFloat(d.pair.priceUsd);
        }
      }
    } catch(e) { /* gebruik cache */ }
    _solPriceAt = Date.now();
    return _solPrice;
  }

  // ── DEXSCREENER: haal NIEUWE pairs op gesorteerd op aanmaakdatum ──
  // Dit is het sleutel endpoint voor verse pump.fun tokens
  async function _fetchNewPumpFunPairs() {
    try {
      // Zoek specifiek op "pump" voor pump.fun tokens
      var r = await _ft('https://api.dexscreener.com/latest/dex/search?q=pump', 8000);
      if (!r.ok) return [];
      var d = await r.json();
      var pairs = (d.pairs || []).filter(function(p) {
        return p.chainId === 'solana' &&
               (p.liquidity && p.liquidity.usd > 0) &&
               parseFloat(p.priceUsd || '0') > 0 &&
               p.pairCreatedAt && (Date.now() - p.pairCreatedAt) < 24 * 60 * 60 * 1000;
      });
      // Sorteer op nieuwste eerst
      pairs.sort(function(a, b) { return (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0); });
      return pairs.slice(0, 30);
    } catch(e) {
      console.warn('[TokenFetcher] pump query fout:', e.name);
      return [];
    }
  }

  // Zoek op trending Solana tokens
  async function _fetchTrendingSolana() {
    try {
      var r = await _ft('https://api.dexscreener.com/latest/dex/search?q=solana', 8000);
      if (!r.ok) return [];
      var d = await r.json();
      return (d.pairs || []).filter(function(p) {
        return p.chainId === 'solana' &&
               (p.liquidity && p.liquidity.usd > 2000) &&
               parseFloat(p.priceUsd || '0') > 0 &&
               // Alleen tokens jonger dan 48 uur
               p.pairCreatedAt && (Date.now() - p.pairCreatedAt) < 48 * 60 * 60 * 1000;
      }).slice(0, 20);
    } catch(e) { return []; }
  }

  // Haal boosted/trending tokens op (gratis endpoint)
  async function _fetchBoosted() {
    try {
      var r = await _ft('https://api.dexscreener.com/token-boosts/latest/v1', 6000);
      if (!r.ok) return [];
      var items = await r.json();
      if (!Array.isArray(items)) return [];
      
      var solItems = items
        .filter(function(i) { return i.chainId === 'solana'; })
        .slice(0, 10);
      
      // Haal pair data op voor elk token (parallel)
      var results = await Promise.allSettled(
        solItems.map(function(item) {
          return _ft('https://api.dexscreener.com/latest/dex/tokens/' + item.tokenAddress, 5000)
            .then(function(r) { return r.ok ? r.json() : null; });
        })
      );
      
      var pairs = [];
      results.forEach(function(res) {
        if (res.status !== 'fulfilled' || !res.value || !res.value.pairs) return;
        var best = res.value.pairs
          .filter(function(p) { return p.chainId === 'solana' && (p.liquidity && p.liquidity.usd > 0); })
          .sort(function(a, b) { return (b.liquidity.usd || 0) - (a.liquidity.usd || 0); })[0];
        if (best) pairs.push(best);
      });
      return pairs;
    } catch(e) { return []; }
  }

  // ── RUGCHECK (met kortere timeout) ────────────────────────
  async function _fetchRugCheck(address) {
    try {
      var r = await _ft('https://api.rugcheck.xyz/v1/tokens/' + address + '/report/summary', 3000);
      if (!r.ok) return null;
      var d = await r.json();
      if (!d) return null;
      var holders = (d.topHolders || []).sort(function(a, b) { return b.pct - a.pct; });
      return {
        score:                d.score || 50,
        largestHolderPercent: holders[0] ? holders[0].pct : 0,
        topHolderPercent:     holders.slice(0,10).reduce(function(s, h) { return s + (h.pct || 0); }, 0),
        isLiquidityLocked:    (d.markets || []).some(function(m) { return (m.lpLockedPct || 0) > 80; }),
      };
    } catch(e) { return null; }
  }

  // ── PAIR → TOKEN OBJECT ───────────────────────────────────
  function _pairToToken(pair, rug) {
    var addr  = pair.baseToken && pair.baseToken.address;
    if (!addr) return null;
    var price = parseFloat(pair.priceUsd || '0');
    if (price <= 0) return null;

    var buys24  = (pair.txns && pair.txns.h24 && pair.txns.h24.buys)  || 0;
    var sells24 = (pair.txns && pair.txns.h24 && pair.txns.h24.sells) || 0;
    var buys5m  = (pair.txns && pair.txns.m5  && pair.txns.m5.buys)   || 0;
    var sells5m = (pair.txns && pair.txns.m5  && pair.txns.m5.sells)  || 0;
    var created = pair.pairCreatedAt || (Date.now() - 60 * 60 * 1000);
    var ageMins = Math.max(0.1, (Date.now() - created) / 60000);
    var txPerMin= (buys5m + sells5m) / Math.min(ageMins, 5);
    var bsRatio = sells24 > 0 ? buys24 / sells24 : (buys24 > 0 ? 5 : 1);

    // Als RugCheck beschikbaar is, gebruik die data
    // Anders: schat holder data op basis van andere metrics
    var largestHolder = rug ? rug.largestHolderPercent : 0;
    var topHolder     = rug ? rug.topHolderPercent     : 0;
    var rugScore      = rug ? rug.score                : 50;
    var liqLocked     = rug ? rug.isLiquidityLocked    : false;

    // Schat holderCount als we geen data hebben
    // Basis: meer buys = meer holders (ruwe schatting)
    var estHolderCount = rug && largestHolder > 0
      ? Math.round(100 / Math.max(largestHolder, 0.5)) * 3
      : Math.max(30, Math.round(buys24 / 3));

    return {
      address:              addr,
      symbol:               ((pair.baseToken && pair.baseToken.symbol) || '???').toUpperCase().slice(0,12),
      name:                 ((pair.baseToken && pair.baseToken.name)   || 'Unknown').slice(0,30),
      marketCap:            pair.marketCap || pair.fdv || 0,
      liquidity:            (pair.liquidity && pair.liquidity.usd) || 0,
      volume24h:            (pair.volume && pair.volume.h24) || 0,
      volume5m:             (pair.volume && pair.volume.m5)  || 0,
      priceUsd:             price,
      priceChange5m:        (pair.priceChange && pair.priceChange.m5)  || 0,
      priceChange1h:        (pair.priceChange && pair.priceChange.h1)  || 0,
      priceChange24h:       (pair.priceChange && pair.priceChange.h24) || 0,
      holderCount:          estHolderCount,
      topHolderPercent:     topHolder,
      largestHolderPercent: largestHolder,
      buyCount24h:          buys24,
      sellCount24h:         sells24,
      buySellRatio:         Math.min(Math.max(bsRatio, 0), 20),
      createdAt:            created,
      ageMinutes:           ageMins,
      txPerMinute:          txPerMin,
      isLiquidityLocked:    liqLocked,
      rugCheckScore:        rugScore,
      hasRealRugCheck:      !!rug, // flag of we echte data hebben
      dexscreenerUrl:       pair.url || ('https://dexscreener.com/solana/' + addr),
      pairAddress:          pair.pairAddress || addr,
    };
  }

  // ── HOOFD SCANFUNCTIE ─────────────────────────────────────
  async function scanAll() {
    var t0 = Date.now();

    // Haal 3 type endpoints parallel op
    var results = await Promise.allSettled([
      _fetchNewPumpFunPairs(),
      _fetchTrendingSolana(),
      _fetchBoosted(),
    ]);

    var allPairs = [];
    results.forEach(function(res) {
      if (res.status === 'fulfilled' && res.value) {
        allPairs = allPairs.concat(res.value);
      }
    });

    // Dedupliceer op adres
    var seen   = new Set();
    var unique = allPairs.filter(function(p) {
      var a = p.baseToken && p.baseToken.address;
      if (!a || seen.has(a)) return false;
      seen.add(a);
      return true;
    });

    Storage.addLog('info', unique.length + ' unieke pairs gevonden (' + (Date.now()-t0) + 'ms)');

    if (!unique.length) {
      Storage.addLog('warning', 'DexScreener gaf 0 pairs terug — API mogelijk tijdelijk down');
      return [];
    }

    // RugCheck PARALLEL voor alle tokens (met timeout)
    var rugResults = await Promise.allSettled(
      unique.map(function(p) {
        return _fetchRugCheck(p.baseToken && p.baseToken.address || '');
      })
    );

    // Bouw token objecten
    var tokens = [];
    for (var i = 0; i < unique.length; i++) {
      var rug   = (rugResults[i].status === 'fulfilled') ? rugResults[i].value : null;
      var token = _pairToToken(unique[i], rug);
      if (token) tokens.push(token);
    }

    Storage.addLog('info', 'Verwerkt: ' + tokens.length + ' tokens in ' + ((Date.now()-t0)/1000).toFixed(1) + 's | RugCheck: ' + rugResults.filter(function(r){ return r.status === 'fulfilled' && r.value; }).length + '/' + unique.length);

    return tokens;
  }

  return { scanAll, getSolPrice };
})();
