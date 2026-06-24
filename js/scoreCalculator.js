/* ============================================================
   SCORECALCULATOR.JS - Berekent kwaliteitsscore 0-100
   ============================================================ */

'use strict';

const ScoreCalculator = (() => {

  function calculate(token, safety) {
    const breakdown = [];
    let total = 0;

    // ── POSITIEF ──────────────────────────────────────────

    const vol = _volumeScore(token);
    breakdown.push({ category: 'Volume & Ratio', points: vol, maxPoints: 30, description: `Vol: $${_fmt(token.volume24h)}, B/S: ${token.buySellRatio.toFixed(2)}` });
    total += vol;

    const hold = _holderScore(token);
    breakdown.push({ category: 'Holders', points: hold, maxPoints: 20, description: `${token.holderCount} holders, top-10: ${token.topHolderPercent.toFixed(1)}%` });
    total += hold;

    const liq = _liquidityScore(token);
    breakdown.push({ category: 'Liquiditeit', points: liq, maxPoints: 20, description: `$${_fmt(token.liquidity)}${token.isLiquidityLocked ? ' (vergrendeld)' : ''}` });
    total += liq;

    const mom = _momentumScore(token);
    breakdown.push({ category: 'Momentum', points: mom, maxPoints: 15, description: `5m: ${token.priceChange5m.toFixed(1)}%, 1h: ${token.priceChange1h.toFixed(1)}%` });
    total += mom;

    const act = _activityScore(token);
    breakdown.push({ category: 'Activiteit', points: act, maxPoints: 10, description: `${token.txPerMinute.toFixed(1)} tx/min` });
    total += act;

    const rug = Math.round((token.rugCheckScore / 100) * 5);
    breakdown.push({ category: 'RugCheck', points: rug, maxPoints: 5, description: `Score: ${token.rugCheckScore}/100` });
    total += rug;

    // ── NEGATIEF ──────────────────────────────────────────

    const whaleP = _whalePenalty(token);
    if (whaleP > 0) {
      breakdown.push({ category: 'Whale Bezit (-)', points: -whaleP, maxPoints: 0, description: `Grootste holder: ${token.largestHolderPercent.toFixed(1)}%` });
      total -= whaleP;
    }

    const safeP = _safetyPenalty(safety);
    if (safeP > 0) {
      breakdown.push({ category: 'Veiligheidsrisico (-)', points: -safeP, maxPoints: 0, description: `${safety.flags.length} flags` });
      total -= safeP;
    }

    const ageP = _agePenalty(token);
    if (ageP > 0) {
      breakdown.push({ category: 'Leeftijdsrisico (-)', points: -ageP, maxPoints: 0, description: `${token.ageMinutes.toFixed(0)} minuten oud` });
      total -= ageP;
    }

    total = Math.max(0, Math.min(100, Math.round(total)));
    const recommendation = _rec(total, safety);

    return { total, breakdown, recommendation };
  }

  function _volumeScore(t) {
    let s = 0;
    if      (t.volume24h > 500000) s += 15;
    else if (t.volume24h > 100000) s += 12;
    else if (t.volume24h >  50000) s += 9;
    else if (t.volume24h >  10000) s += 6;
    else if (t.volume24h >   5000) s += 3;

    if      (t.buySellRatio > 3)   s += 15;
    else if (t.buySellRatio > 2)   s += 12;
    else if (t.buySellRatio > 1.5) s += 9;
    else if (t.buySellRatio > 1.2) s += 6;
    else if (t.buySellRatio > 1)   s += 3;

    return Math.min(30, s);
  }

  function _holderScore(t) {
    let s = 0;
    if      (t.holderCount > 5000) s += 12;
    else if (t.holderCount > 1000) s += 10;
    else if (t.holderCount >  500) s += 8;
    else if (t.holderCount >  200) s += 6;
    else if (t.holderCount >  100) s += 4;
    else if (t.holderCount >   50) s += 2;

    if      (t.topHolderPercent < 20) s += 8;
    else if (t.topHolderPercent < 30) s += 6;
    else if (t.topHolderPercent < 40) s += 4;
    else if (t.topHolderPercent < 50) s += 2;

    return Math.min(20, s);
  }

  function _liquidityScore(t) {
    let s = 0;
    if      (t.liquidity > 500000) s += 18;
    else if (t.liquidity > 200000) s += 15;
    else if (t.liquidity > 100000) s += 12;
    else if (t.liquidity >  50000) s += 9;
    else if (t.liquidity >  20000) s += 6;
    else if (t.liquidity >  10000) s += 3;

    if (t.isLiquidityLocked) s += 2;
    return Math.min(20, s);
  }

  function _momentumScore(t) {
    let s = 0;
    if      (t.priceChange5m > 10) s += 8;
    else if (t.priceChange5m >  5) s += 6;
    else if (t.priceChange5m >  2) s += 4;
    else if (t.priceChange5m >  0) s += 2;

    if      (t.priceChange1h > 50) s += 7;
    else if (t.priceChange1h > 20) s += 5;
    else if (t.priceChange1h > 10) s += 3;
    else if (t.priceChange1h >  0) s += 1;

    if (t.priceChange5m < -10) s -= 5;
    if (t.priceChange1h < -20) s -= 5;

    return Math.max(0, Math.min(15, s));
  }

  function _activityScore(t) {
    let s = 0;
    if      (t.txPerMinute > 20) s += 5;
    else if (t.txPerMinute > 10) s += 4;
    else if (t.txPerMinute >  5) s += 3;
    else if (t.txPerMinute >  2) s += 2;
    else if (t.txPerMinute >  1) s += 1;

    if      (t.buyCount24h > 1000) s += 5;
    else if (t.buyCount24h >  500) s += 4;
    else if (t.buyCount24h >  200) s += 3;
    else if (t.buyCount24h >  100) s += 2;
    else if (t.buyCount24h >   50) s += 1;

    return Math.min(10, s);
  }

  function _whalePenalty(t) {
    const p = t.largestHolderPercent;
    if (p > 50) return 40;
    if (p > 40) return 35;
    if (p > 30) return 25;
    if (p > 20) return 15;
    if (p > 15) return 8;
    if (p > 10) return 3;
    return 0;
  }

  function _safetyPenalty(safety) {
    let p = 0;
    for (const f of safety.flags) {
      if      (f.severity === 'critical') p += 20;
      else if (f.severity === 'high')     p += 12;
      else if (f.severity === 'medium')   p += 5;
      else                                p += 2;
    }
    return Math.min(50, p);
  }

  function _agePenalty(t) {
    if (t.ageMinutes <  5) return 15;
    if (t.ageMinutes < 10) return 10;
    if (t.ageMinutes < 20) return 5;
    return 0;
  }

  function _rec(score, safety) {
    if (safety.flags.some(f => f.severity === 'critical')) return 'DANGER';
    if (!safety.isSafe) return 'SKIP';
    if (score >= 70) return 'BUY';
    if (score >= 50) return 'WATCH';
    return 'SKIP';
  }

  function _fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toFixed(0);
  }

  return { calculate };

})();
