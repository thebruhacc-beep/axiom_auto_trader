/* ============================================================
   PRICEREFRESHER.JS - Haalt live prijzen op voor open posities
   Dit is de kern fix voor "posities blijven op 0%"
   Roept DexScreener aan voor elk open token apart
   ============================================================ */
'use strict';

const PriceRefresher = (() => {

  // Cache: adres → { price, fetchedAt }
  var _cache = new Map();
  var CACHE_TTL = 20000; // 20 seconden cache

  // Haal prijs op voor één token via DexScreener
  async function _fetchPrice(tokenAddress) {
    // Check cache eerst
    var cached = _cache.get(tokenAddress);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL) {
      return cached.price;
    }

    try {
      var ctrl  = new AbortController();
      var timer = setTimeout(function() { ctrl.abort(); }, 5000);

      var r = await fetch(
        'https://api.dexscreener.com/latest/dex/tokens/' + tokenAddress,
        { signal: ctrl.signal, headers: { 'Accept': 'application/json' } }
      ).finally(function() { clearTimeout(timer); });

      if (!r.ok) return null;

      var d = await r.json();
      if (!d.pairs || !d.pairs.length) return null;

      // Neem pair met hoogste liquiditeit op Solana
      var best = d.pairs
        .filter(function(p) { return p.chainId === 'solana' && parseFloat(p.priceUsd || '0') > 0; })
        .sort(function(a, b) { return (b.liquidity && b.liquidity.usd || 0) - (a.liquidity && a.liquidity.usd || 0); })[0];

      if (!best) return null;

      var price = parseFloat(best.priceUsd || '0');
      if (price > 0) {
        _cache.set(tokenAddress, { price: price, fetchedAt: Date.now() });
      }
      return price > 0 ? price : null;

    } catch(e) {
      return null;
    }
  }

  // Haal prijzen op voor ALLE open posities parallel
  // Geeft een Map terug: tokenAddress → currentPrice
  async function refreshOpenPositions() {
    var openTrades = Storage.getOpenTrades();
    if (!openTrades.length) return new Map();

    // Parallel alle prijzen ophalen
    var results = await Promise.allSettled(
      openTrades.map(function(trade) {
        return _fetchPrice(trade.tokenAddress);
      })
    );

    var priceMap = new Map();
    var updated  = 0;

    for (var i = 0; i < openTrades.length; i++) {
      var trade  = openTrades[i];
      var result = results[i];
      var price  = (result.status === 'fulfilled' && result.value) ? result.value : null;

      if (price && price > 0) {
        priceMap.set(trade.tokenAddress, price);
        updated++;
      } else {
        // Fallback: gebruik laatste bekende prijs zodat UI niet bevriest
        if (trade.currentPrice > 0) {
          priceMap.set(trade.tokenAddress, trade.currentPrice);
        }
      }
    }

    if (updated > 0) {
      console.log('[PriceRefresher] ' + updated + '/' + openTrades.length + ' prijzen geüpdatet');
    }

    return priceMap;
  }

  // Update open posities in storage met verse prijzen (zonder full scan)
  async function updatePositionPrices() {
    var openTrades = Storage.getOpenTrades();
    if (!openTrades.length) return;

    var priceMap = await refreshOpenPositions();
    if (!priceMap.size) return;

    // Update elke trade in storage met nieuwe prijs
    var changed = false;
    for (var i = 0; i < openTrades.length; i++) {
      var trade = openTrades[i];
      var price = priceMap.get(trade.tokenAddress);

      if (price && price !== trade.currentPrice) {
        trade.currentPrice        = price;
        trade.pnlPercent          = ((price - trade.entryPrice) / trade.entryPrice) * 100;

        // Netto PnL schatting (fees worden meegenomen)
        var fees        = Storage.getFees();
        var sellFeeEst  = trade.amountSol * (fees.axiomFeePct + fees.slippagePct);
        var grossReturn = trade.amountSol * (trade.pnlPercent / 100);
        var netReturn   = grossReturn - (trade.buyFeeSOL || 0) - sellFeeEst;
        trade.pnlSol    = netReturn;
        trade.pnlPercentAfterFees = (netReturn / trade.amountSol) * 100;

        changed = true;
      }
    }

    if (changed) {
      Storage.saveOpenTrades(openTrades);
    }

    // Laat tradeManager ook TP/SL checken met verse prijzen
    await TradeManager.checkPositions(priceMap);
  }

  return {
    refreshOpenPositions: refreshOpenPositions,
    updatePositionPrices: updatePositionPrices,
  };
})();
