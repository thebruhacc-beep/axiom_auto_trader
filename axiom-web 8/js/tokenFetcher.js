/* ============================================================
   TOKENFETCHER.JS - Roterende queries voor verse tokens
   Fix: elke scan gebruikt andere zoektermen zodat we nooit
   dezelfde 40 tokens blijven zien
   ============================================================ */
'use strict';

const TokenFetcher = (() => {

  var _solPrice    = 170;
  var _solPriceAt  = 0;
  var _scanIndex   = 0; // Rotatieteller

  // Grote lijst van zoektermen — elke scan pakt andere subset
  var QUERY_POOL = [
    'pump',     'fun',      'moon',     'dog',      'cat',
    'pepe',     'sol',      'meme',     'inu',      'baby',
    'shib',     'doge',     'wojak',    'chad',     'based',
    'ai',       'grok',     'elon',     'trump',    'biden',
    'frog',     'bear',     'bull',     'ape',      'monkey',
    'pizza',    'burger',   'tendies',  'bonk',     'wif',
    'nft',      'dao',      'defi',     'yield',    'farm',
    'king',     'queen',    'god',      'epic',     'ultra',
  ];

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
      var r = await _ft(
        'https://api.dexscreener.com/latest/dex/pairs/solana/58oQChx4yWmvKn3NeRJBb7drN5Gj1M1tBQKwcHDRPsc4',
        4000
      );
      if (r.ok) {
        var d = await r.json();
        if (d.pair && d.pair.priceUsd) _solPrice = parseFloat(d.pair.priceUsd);
      }
    } catch(e) { /* gebruik cache */ }
    _solPriceAt = Date.now();
    return _solPrice;
  }

  // ── ROTERENDE QUERY ───────────────────────────────────────
  // Elke aanroep pakt 2 andere zoektermen uit de pool
  async function _fetchByRotatingQuery() {
    var i1 = _scanIndex % QUERY_POOL.length;
    var i2 = (_scanIndex + 1) % QUERY_POOL.length;
    var q1 = QUERY_POOL[i1];
    var q2 = QUERY_POOL[i2];
    _scanIndex += 2; // Volgende scan: andere termen

    Storage.addLog('info', 'Zoeken: "' + q1 + '" + "' + q2 + '" (scan #' + Math.floor(_scanIndex/2) + ')');

    var results = await Promise.allSettled([
      _fetchQuery(q1),
      _fetchQuery(q2),
    ]);

    var pairs = [];
    results.forEach(function(res) {
      if (res.status === 'fulfilled') pairs = pairs.concat(res.value);
    });
    return pairs;
  }

  async function _fetchQuery(query) {
    try {
      var url = 'https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(query);
      var r   = await _ft(url, 7000);
      if (!r.ok) return [];
      var d = await r.json();
      return (d.pairs || []).filter(function(p) {
        return p.chainId === 'solana' &&
               p.liquidity && p.liquidity.usd > 500 &&
               parseFloat(p.priceUsd || '0') > 0;
      });
    } catch(e) { return []; }
  }

  // ── NIEUWSTE PAIRS (gesorteerd op aanmaakdatum) ───────────
  async function _fetchNewest() {
    try {
      // Gebruik een random query zodat we variatie krijgen
      var randomQ = QUERY_POOL[Math.floor(Math.random() * QUERY_POOL.length)];
      var r = await _ft(
        'https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(randomQ),
        7000
      );
      if (!r.ok) return [];
      var d = await r.json();
      var pairs = (d.pairs || []).filter(function(p) {
        return p.chainId === 'solana' &&
               p.pairCreatedAt &&
               (Date.now() - p.pairCreatedAt) < 48 * 60 * 60 * 1000 &&
               p.liquidity && p.liquidity.usd > 500;
      });
      // Sorteer: nieuwste eerst
      pairs.sort(function(a, b) { return (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0); });
      return pairs.slice(0, 20);
    } catch(e) { return []; }
  }

  // ── BOOSTED TOKENS ────────────────────────────────────────
  async function _fetchBoosted() {
    try {
      var r = await _ft('https://api.dexscreener.com/token-boosts/latest/v1', 6000);
      if (!r.ok) return [];
      var items = await r.json();
      if (!Array.isArray(items)) return [];

      var solItems = items
        .filter(function(i) { return i.chainId === 'solana'; })
        .slice(0, 8);

      var results = await Promise.allSettled(
        solItems.map(function(item) {
          return _ft(
            'https://api.dexscreener.com/latest/dex/tokens/' + item.tokenAddress,
            5000
          ).then(function(r) { return r.ok ? r.json() : null; });
        })
      );

      var pairs = [];
      results.forEach(function(res) {
        if (res.status !== 'fulfilled' || !res.value || !res.value.pairs) return;
        var best = res.value.pairs
          .filter(function(p) {
            return p.chainId === 'solana' && p.liquidity && p.liquidity.usd > 0;
          })
          .sort(function(a, b) {
            return (b.liquidity.usd || 0) - (a.liquidity.usd || 0);
          })[0];
        if (best) pairs.push(best);
      });
      return pairs;
    } catch(e) { return []; }
  }

  // ── RUGCHECK ──────────────────────────────────────────────
  async function _fetchRugCheck(address) {
    try {
      var r = await _ft(
        'https://api.rugcheck.xyz/v1/tokens/' + address + '/report/summary',
        3000
      );
      if (!r.ok) return null;
      var d = await r.json();
      if (!d) return null;
      var holders = (d.topHolders || []).sort(function(a, b) { return b.pct - a.pct; });
      return {
        score:                d.score || 50,
        largestHolderPercent: holders[0] ? holders[0].pct : 0,
        topHolderPercent:     holders.slice(0,10).reduce(function(s,h) { return s+(h.pct||0); }, 0),
        isLiquidityLocked:    (d.markets || []).some(function(m) { return (m.lpLockedPct||0) > 80; }),
      };
    } catch(e) { return null; }
  }

  // ── PAIR → TOKEN ──────────────────────────────────────────
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

    var largestHolder = rug ? rug.largestHolderPercent : 0;
    var topHolder     = rug ? rug.topHolderPercent     : 0;
    var rugScore      = rug ? rug.score                : 50;
    var liqLocked     = rug ? rug.isLiquidityLocked    : false;

    // Schat holderCount als geen echte data
    var estHolders = (rug && largestHolder > 0)
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
      holderCount:          estHolders,
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
      hasRealRugCheck:      !!rug,
      dexscreenerUrl:       pair.url || ('https://dexscreener.com/solana/' + addr),
      pairAddress:          pair.pairAddress || addr,
    };
  }

  // ── HOOFD SCAN ────────────────────────────────────────────
  async function scanAll() {
    var t0 = Date.now();

    // 3 verschillende bronnen parallel
    var results = await Promise.allSettled([
      _fetchByRotatingQuery(),
      _fetchNewest(),
      _fetchBoosted(),
    ]);

    var allPairs = [];
    results.forEach(function(res) {
      if (res.status === 'fulfilled' && res.value) {
        allPairs = allPairs.concat(res.value);
      }
    });

    // Dedupliceer
    var seen   = new Set();
    var unique = allPairs.filter(function(p) {
      var a = p.baseToken && p.baseToken.address;
      if (!a || seen.has(a)) return false;
      seen.add(a);
      return true;
    });

    if (!unique.length) {
      Storage.addLog('warning', 'Geen pairs gevonden — DexScreener tijdelijk traag');
      return [];
    }

    // Filter al-open posities meteen weg — niet opnieuw analyseren
    var openTrades  = Storage.getOpenTrades();
    var openAddrs   = new Set(openTrades.map(function(t) { return t.tokenAddress; }));
    var newPairs    = unique.filter(function(p) {
      return !openAddrs.has(p.baseToken && p.baseToken.address);
    });

    Storage.addLog('info',
      unique.length + ' unieke pairs | ' +
      (unique.length - newPairs.length) + ' al open | ' +
      newPairs.length + ' nieuw te analyseren'
    );

    if (!newPairs.length) {
      Storage.addLog('info', 'Alle gevonden tokens al in portfolio — volgende scan: nieuwe zoektermen');
      return [];
    }

    // RugCheck parallel voor nieuwe tokens
    var rugResults = await Promise.allSettled(
      newPairs.map(function(p) {
        return _fetchRugCheck(p.baseToken && p.baseToken.address || '');
      })
    );

    var tokens = [];
    for (var i = 0; i < newPairs.length; i++) {
      var rug   = (rugResults[i].status === 'fulfilled') ? rugResults[i].value : null;
      var token = _pairToToken(newPairs[i], rug);
      if (token) tokens.push(token);
    }

    var elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    var rugHits = rugResults.filter(function(r) { return r.status === 'fulfilled' && r.value; }).length;
    Storage.addLog('info',
      tokens.length + ' tokens verwerkt in ' + elapsed + 's | RugCheck: ' + rugHits + '/' + newPairs.length
    );

    return tokens;
  }

  return { scanAll: scanAll, getSolPrice: getSolPrice };
})();
