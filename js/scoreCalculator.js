/* ============================================================
   SCORECALCULATOR.JS - Score 0-100
   Fee-bewust: bonus voor hoge liquiditeit (minder slippage)
   ============================================================ */
'use strict';

const ScoreCalculator = (() => {

  function calculate(token, safety) {
    const breakdown = [];
    let total = 0;

    // ── POSITIEF ──────────────────────────────────────────

    const vol = _volumeScore(token);
    breakdown.push({ category: 'Volume & Ratio', points: vol, maxPoints: 25,
      description: `Vol: $${_f(token.volume24h)} | B/S: ${token.buySellRatio.toFixed(2)}` });
    total += vol;

    const hold = _holderScore(token);
    breakdown.push({ category: 'Holders', points: hold, maxPoints: 20,
      description: `~${token.holderCount} holders | top10: ${token.topHolderPercent.toFixed(0)}%` });
    total += hold;

    const liq = _liquidityScore(token);
    breakdown.push({ category: 'Liquiditeit', points: liq, maxPoints: 20,
      description: `$${_f(token.liquidity)}${token.isLiquidityLocked?' 🔒':''}` });
    total += liq;

    const mom = _momentumScore(token);
    breakdown.push({ category: 'Momentum', points: mom, maxPoints: 15,
      description: `5m: ${token.priceChange5m.toFixed(1)}% | 1h: ${token.priceChange1h.toFixed(1)}%` });
    total += mom;

    const act = _activityScore(token);
    breakdown.push({ category: 'Activiteit', points: act, maxPoints: 10,
      description: `${token.txPerMinute.toFixed(1)} tx/min | ${token.buyCount24h} buys` });
    total += act;

    const rug = Math.round((Math.max(0, token.rugCheckScore - 20) / 80) * 10);
    breakdown.push({ category: 'RugCheck', points: rug, maxPoints: 10,
      description: `Score: ${token.rugCheckScore}/100` });
    total += rug;

    // ── NEGATIEF ──────────────────────────────────────────

    const whaleP = _whalePenalty(token);
    if (whaleP > 0) {
      breakdown.push({ category: 'Whale (-)', points: -whaleP, maxPoints: 0,
        description: `Grootste: ${token.largestHolderPercent.toFixed(1)}%` });
      total -= whaleP;
    }

    const safeP = _safetyPenalty(safety);
    if (safeP > 0) {
      breakdown.push({ category: 'Veiligheid (-)', points: -safeP, maxPoints: 0,
        description: `${safety.flags.length} flags` });
      total -= safeP;
    }

    const ageP = _agePenalty(token);
    if (ageP > 0) {
      breakdown.push({ category: 'Leeftijd (-)', points: -ageP, maxPoints: 0,
        description: `${token.ageMinutes.toFixed(0)} min oud` });
      total -= ageP;
    }

    // Fee penalty: lage liquiditeit = hogere slippage
    const feeP = token.liquidity < 10000 ? 5 : token.liquidity < 5000 ? 10 : 0;
    if (feeP > 0) {
      breakdown.push({ category: 'Hoge slippage (-)', points: -feeP, maxPoints: 0,
        description: `Liquiditeit $${_f(token.liquidity)} → hoge fees` });
      total -= feeP;
    }

    total = Math.max(0, Math.min(100, Math.round(total)));

    // Aanbeveling
    let recommendation;
    if (safety.flags.some(f => f.severity === 'critical')) recommendation = 'DANGER';
    else if (!safety.isSafe)  recommendation = 'SKIP';
    else if (total >= 65)     recommendation = 'BUY';
    else if (total >= 48)     recommendation = 'WATCH';
    else                      recommendation = 'SKIP';

    return { total, breakdown, recommendation };
  }

  function _volumeScore(t) {
    let s = 0;
    if      (t.volume24h > 200000) s += 13;
    else if (t.volume24h > 50000)  s += 10;
    else if (t.volume24h > 20000)  s += 7;
    else if (t.volume24h > 5000)   s += 4;
    else if (t.volume24h > 2000)   s += 2;

    if      (t.buySellRatio > 4)   s += 12;
    else if (t.buySellRatio > 2.5) s += 9;
    else if (t.buySellRatio > 1.8) s += 7;
    else if (t.buySellRatio > 1.3) s += 5;
    else if (t.buySellRatio > 1)   s += 2;
    return Math.min(25, s);
  }

  function _holderScore(t) {
    let s = 0;
    if      (t.holderCount > 2000) s += 12;
    else if (t.holderCount > 500)  s += 9;
    else if (t.holderCount > 200)  s += 7;
    else if (t.holderCount > 100)  s += 5;
    else if (t.holderCount > 50)   s += 3;
    else if (t.holderCount > 25)   s += 1;

    if      (t.topHolderPercent < 20) s += 8;
    else if (t.topHolderPercent < 30) s += 6;
    else if (t.topHolderPercent < 40) s += 4;
    else if (t.topHolderPercent < 50) s += 2;
    return Math.min(20, s);
  }

  function _liquidityScore(t) {
    let s = 0;
    if      (t.liquidity > 200000) s += 18;
    else if (t.liquidity > 50000)  s += 14;
    else if (t.liquidity > 20000)  s += 11;
    else if (t.liquidity > 10000)  s += 8;
    else if (t.liquidity > 5000)   s += 5;
    else if (t.liquidity > 3000)   s += 2;
    if (t.isLiquidityLocked) s += 2;
    return Math.min(20, s);
  }

  function _momentumScore(t) {
    let s = 0;
    if      (t.priceChange5m > 15) s += 8;
    else if (t.priceChange5m > 7)  s += 6;
    else if (t.priceChange5m > 3)  s += 4;
    else if (t.priceChange5m > 0)  s += 2;
    if (t.priceChange5m < -15) s -= 6;

    if      (t.priceChange1h > 50) s += 7;
    else if (t.priceChange1h > 20) s += 5;
    else if (t.priceChange1h > 10) s += 3;
    else if (t.priceChange1h > 0)  s += 1;
    if (t.priceChange1h < -25) s -= 5;

    return Math.max(0, Math.min(15, s));
  }

  function _activityScore(t) {
    let s = 0;
    if      (t.txPerMinute > 15) s += 5;
    else if (t.txPerMinute > 8)  s += 4;
    else if (t.txPerMinute > 4)  s += 3;
    else if (t.txPerMinute > 1)  s += 1;

    if      (t.buyCount24h > 500)  s += 5;
    else if (t.buyCount24h > 200)  s += 4;
    else if (t.buyCount24h > 100)  s += 3;
    else if (t.buyCount24h > 50)   s += 2;
    else if (t.buyCount24h > 20)   s += 1;
    return Math.min(10, s);
  }

  function _whalePenalty(t) {
    const p = t.largestHolderPercent;
    if (p > 50) return 40;
    if (p > 35) return 28;
    if (p > 25) return 18;
    if (p > 18) return 10;
    if (p > 12) return 4;
    return 0;
  }

  function _safetyPenalty(safety) {
    let p = 0;
    for (const f of safety.flags) {
      if      (f.severity === 'critical') p += 22;
      else if (f.severity === 'high')     p += 13;
      else if (f.severity === 'medium')   p += 5;
      else                                p += 2;
    }
    return Math.min(55, p);
  }

  function _agePenalty(t) {
    if (t.ageMinutes < 2)  return 18;
    if (t.ageMinutes < 5)  return 12;
    if (t.ageMinutes < 10) return 6;
    if (t.ageMinutes < 20) return 2;
    return 0;
  }

  function _f(n) {
    if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
    if (n >= 1e3) return (n/1e3).toFixed(0)+'K';
    return (n||0).toFixed(0);
  }

  return { calculate };
})();
