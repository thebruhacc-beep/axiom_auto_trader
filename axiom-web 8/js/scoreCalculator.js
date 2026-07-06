/* ============================================================
   SCORECALCULATOR.JS - Aangepast voor realistische data
   Probleem was: holderCount=0 gaf -12 punten onterecht
   Fix: schat holder score op basis van beschikbare data
   BUY threshold verlaagd naar 55 (realistischer zonder Birdeye)
   ============================================================ */
'use strict';

const ScoreCalculator = (() => {

  function calculate(token, safety) {
    var breakdown = [];
    var total     = 0;

    // ── VOLUME & BUY/SELL RATIO (max 28) ──────────────────
    var vol = _volumeScore(token);
    breakdown.push({ category: 'Volume & B/S Ratio', points: vol, maxPoints: 28,
      description: 'Vol: $' + _f(token.volume24h) + ' | B/S: ' + token.buySellRatio.toFixed(2) });
    total += vol;

    // ── MOMENTUM (max 18) ──────────────────────────────────
    var mom = _momentumScore(token);
    breakdown.push({ category: 'Prijs Momentum', points: mom, maxPoints: 18,
      description: '5m: ' + token.priceChange5m.toFixed(1) + '% | 1h: ' + token.priceChange1h.toFixed(1) + '%' });
    total += mom;

    // ── LIQUIDITEIT (max 20) ──────────────────────────────
    var liq = _liquidityScore(token);
    breakdown.push({ category: 'Liquiditeit', points: liq, maxPoints: 20,
      description: '$' + _f(token.liquidity) + (token.isLiquidityLocked ? ' 🔒' : '') });
    total += liq;

    // ── ACTIVITEIT (max 14) ───────────────────────────────
    var act = _activityScore(token);
    breakdown.push({ category: 'Activiteit', points: act, maxPoints: 14,
      description: token.txPerMinute.toFixed(1) + ' tx/min | ' + token.buyCount24h + ' buys' });
    total += act;

    // ── HOLDERS (max 12) ──────────────────────────────────
    // Gebruik beschikbare data — als geen RugCheck, schat op basis van buys
    var hold = _holderScore(token);
    breakdown.push({ category: 'Holders' + (token.hasRealRugCheck ? '' : ' (geschat)'), points: hold, maxPoints: 12,
      description: '~' + token.holderCount + ' holders | top: ' + token.topHolderPercent.toFixed(0) + '%' });
    total += hold;

    // ── RUGCHECK (max 8) ──────────────────────────────────
    var rug = token.hasRealRugCheck
      ? Math.round((Math.max(0, token.rugCheckScore - 20) / 80) * 8)
      : 4; // Neutraal als geen data
    breakdown.push({ category: 'RugCheck' + (token.hasRealRugCheck ? '' : ' (geen data)'), points: rug, maxPoints: 8,
      description: 'Score: ' + token.rugCheckScore + '/100' });
    total += rug;

    // ── NEGATIEF: WHALE PENALTY ───────────────────────────
    if (token.hasRealRugCheck && token.largestHolderPercent > 0) {
      var whaleP = _whalePenalty(token);
      if (whaleP > 0) {
        breakdown.push({ category: 'Whale (-)', points: -whaleP, maxPoints: 0,
          description: 'Grootste holder: ' + token.largestHolderPercent.toFixed(1) + '%' });
        total -= whaleP;
      }
    }

    // ── NEGATIEF: VEILIGHEID ──────────────────────────────
    var safeP = _safetyPenalty(safety);
    if (safeP > 0) {
      breakdown.push({ category: 'Veiligheid (-)', points: -safeP, maxPoints: 0,
        description: safety.flags.length + ' veiligheidsflags' });
      total -= safeP;
    }

    // ── NEGATIEF: LEEFTIJD ────────────────────────────────
    var ageP = _agePenalty(token);
    if (ageP > 0) {
      breakdown.push({ category: 'Leeftijd (-)', points: -ageP, maxPoints: 0,
        description: token.ageMinutes.toFixed(0) + ' minuten oud' });
      total -= ageP;
    }

    total = Math.max(0, Math.min(100, Math.round(total)));

    // ── AANBEVELING ───────────────────────────────────────
    // Threshold 55 (was 65) — realistisch zonder Birdeye API
    var recommendation;
    if (safety.flags.some(function(f) { return f.severity === 'critical'; })) {
      recommendation = 'DANGER';
    } else if (!safety.isSafe) {
      recommendation = 'SKIP';
    } else if (total >= 55) {
      recommendation = 'BUY';
    } else if (total >= 40) {
      recommendation = 'WATCH';
    } else {
      recommendation = 'SKIP';
    }

    return { total: total, breakdown: breakdown, recommendation: recommendation };
  }

  function _volumeScore(t) {
    var s = 0;
    // Volume component (max 14)
    if      (t.volume24h > 500000) s += 14;
    else if (t.volume24h > 100000) s += 11;
    else if (t.volume24h > 50000)  s += 9;
    else if (t.volume24h > 20000)  s += 7;
    else if (t.volume24h > 5000)   s += 4;
    else if (t.volume24h > 2000)   s += 2;

    // Buy/sell ratio (max 14)
    if      (t.buySellRatio > 5)   s += 14;
    else if (t.buySellRatio > 3)   s += 11;
    else if (t.buySellRatio > 2)   s += 8;
    else if (t.buySellRatio > 1.5) s += 5;
    else if (t.buySellRatio > 1.2) s += 3;
    else if (t.buySellRatio > 1)   s += 1;
    return Math.min(28, s);
  }

  function _momentumScore(t) {
    var s = 0;
    // 5m momentum (max 9)
    if      (t.priceChange5m > 20) s += 9;
    else if (t.priceChange5m > 10) s += 7;
    else if (t.priceChange5m > 5)  s += 5;
    else if (t.priceChange5m > 2)  s += 3;
    else if (t.priceChange5m > 0)  s += 1;
    if (t.priceChange5m < -15) s -= 5;

    // 1h momentum (max 9)
    if      (t.priceChange1h > 100) s += 9;
    else if (t.priceChange1h > 50)  s += 7;
    else if (t.priceChange1h > 20)  s += 5;
    else if (t.priceChange1h > 10)  s += 3;
    else if (t.priceChange1h > 0)   s += 1;
    if (t.priceChange1h < -25) s -= 5;

    return Math.max(0, Math.min(18, s));
  }

  function _liquidityScore(t) {
    var s = 0;
    if      (t.liquidity > 200000) s += 18;
    else if (t.liquidity > 100000) s += 15;
    else if (t.liquidity > 50000)  s += 13;
    else if (t.liquidity > 20000)  s += 10;
    else if (t.liquidity > 10000)  s += 8;
    else if (t.liquidity > 5000)   s += 5;
    else if (t.liquidity > 2000)   s += 2;
    if (t.isLiquidityLocked) s += 2;
    return Math.min(20, s);
  }

  function _activityScore(t) {
    var s = 0;
    // tx per minuut (max 6)
    if      (t.txPerMinute > 20) s += 6;
    else if (t.txPerMinute > 10) s += 5;
    else if (t.txPerMinute > 5)  s += 4;
    else if (t.txPerMinute > 2)  s += 3;
    else if (t.txPerMinute > 1)  s += 2;
    else if (t.txPerMinute > 0)  s += 1;

    // Aantal buys 24u (max 8)
    if      (t.buyCount24h > 2000) s += 8;
    else if (t.buyCount24h > 1000) s += 7;
    else if (t.buyCount24h > 500)  s += 6;
    else if (t.buyCount24h > 200)  s += 5;
    else if (t.buyCount24h > 100)  s += 4;
    else if (t.buyCount24h > 50)   s += 3;
    else if (t.buyCount24h > 20)   s += 2;
    else if (t.buyCount24h > 5)    s += 1;
    return Math.min(14, s);
  }

  function _holderScore(t) {
    var s = 0;
    // holderCount (geschat als geen Birdeye)
    if      (t.holderCount > 5000) s += 7;
    else if (t.holderCount > 1000) s += 6;
    else if (t.holderCount > 500)  s += 5;
    else if (t.holderCount > 200)  s += 4;
    else if (t.holderCount > 100)  s += 3;
    else if (t.holderCount > 50)   s += 2;
    else if (t.holderCount > 25)   s += 1;

    // Top holder verdeling (alleen als echte data)
    if (t.hasRealRugCheck && t.topHolderPercent > 0) {
      if      (t.topHolderPercent < 20) s += 5;
      else if (t.topHolderPercent < 30) s += 4;
      else if (t.topHolderPercent < 40) s += 3;
      else if (t.topHolderPercent < 50) s += 1;
    } else {
      s += 3; // Neutraal als geen data
    }
    return Math.min(12, s);
  }

  function _whalePenalty(t) {
    var p = t.largestHolderPercent;
    if (p > 50) return 35;
    if (p > 35) return 22;
    if (p > 25) return 14;
    if (p > 18) return 7;
    if (p > 12) return 3;
    return 0;
  }

  function _safetyPenalty(safety) {
    var p = 0;
    safety.flags.forEach(function(f) {
      if      (f.severity === 'critical') p += 20;
      else if (f.severity === 'high')     p += 12;
      else if (f.severity === 'medium')   p += 4;
      else                                p += 1;
    });
    return Math.min(50, p);
  }

  function _agePenalty(t) {
    if (t.ageMinutes < 3)  return 15;
    if (t.ageMinutes < 5)  return 10;
    if (t.ageMinutes < 10) return 5;
    if (t.ageMinutes < 20) return 2;
    return 0;
  }

  function _f(n) {
    if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
    if (n >= 1e3) return (n/1e3).toFixed(0)+'K';
    return (n||0).toFixed(0);
  }

  return { calculate: calculate };
})();
