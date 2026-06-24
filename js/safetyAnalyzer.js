/* ============================================================
   SAFETYANALYZER.JS - Detecteert rug pulls en gevaarlijke tokens
   ============================================================ */

'use strict';

const SafetyAnalyzer = (() => {

  function analyze(token, settings) {
    const flags    = [];
    const warnings = [];

    // ── KRITISCH: disqualificerend ────────────────────────

    if (token.largestHolderPercent > settings.maxTopHolderPercent) {
      flags.push({
        type:        'TOP_HOLDER_TOO_HIGH',
        severity:    token.largestHolderPercent > 40 ? 'critical' : 'high',
        description: `Grootste holder bezit ${token.largestHolderPercent.toFixed(1)}%`,
        value:        token.largestHolderPercent,
      });
    }

    if (token.topHolderPercent > 50) {
      flags.push({
        type:        'WHALE_CONCENTRATION',
        severity:    token.topHolderPercent > 70 ? 'critical' : 'high',
        description: `Top-10 holders bezitten ${token.topHolderPercent.toFixed(1)}%`,
        value:        token.topHolderPercent,
      });
    }

    if (token.liquidity < settings.minLiquidityUsd) {
      flags.push({
        type:        'LOW_LIQUIDITY',
        severity:    token.liquidity < settings.minLiquidityUsd / 2 ? 'critical' : 'high',
        description: `Liquiditeit $${_fmt(token.liquidity)} (min $${_fmt(settings.minLiquidityUsd)})`,
        value:        token.liquidity,
      });
    }

    if (token.holderCount < settings.minHolders) {
      flags.push({
        type:        'TOO_FEW_HOLDERS',
        severity:    token.holderCount < settings.minHolders / 2 ? 'critical' : 'high',
        description: `Slechts ${token.holderCount} holders (min ${settings.minHolders})`,
        value:        token.holderCount,
      });
    }

    if (!token.isLiquidityLocked && token.ageMinutes < 60) {
      flags.push({
        type:        'LIQUIDITY_NOT_LOCKED',
        severity:    'high',
        description: 'Liquiditeit niet vergrendeld — deployer kan pool legen',
      });
    }

    // ── WAARSCHUWINGEN ────────────────────────────────────

    if (token.buySellRatio < 0.5) {
      flags.push({
        type:        'HIGH_SELL_PRESSURE',
        severity:    token.buySellRatio < 0.3 ? 'high' : 'medium',
        description: `Buy/sell ratio: ${token.buySellRatio.toFixed(2)}`,
        value:        token.buySellRatio,
      });
      warnings.push('Hoge verkoopdruk');
    }

    if (token.rugCheckScore < 30) {
      flags.push({
        type:        'RUG_RISK',
        severity:    token.rugCheckScore < 15 ? 'critical' : 'high',
        description: `RugCheck score: ${token.rugCheckScore}/100`,
        value:        token.rugCheckScore,
      });
    }

    if (token.ageMinutes < settings.minAgeMinutes) {
      flags.push({
        type:        'TOO_NEW',
        severity:    'medium',
        description: `Token is ${token.ageMinutes.toFixed(1)} minuten oud`,
        value:        token.ageMinutes,
      });
    }

    if (token.volume24h < settings.minVolume24h) {
      flags.push({
        type:        'LOW_VOLUME',
        severity:    'medium',
        description: `24u volume $${_fmt(token.volume24h)} te laag`,
        value:        token.volume24h,
      });
    }

    // Honeypot detectie
    if (token.buyCount24h > 100 && token.sellCount24h < 5) {
      flags.push({
        type:        'HONEYPOT_SUSPECTED',
        severity:    'critical',
        description: `${token.buyCount24h} buys maar slechts ${token.sellCount24h} sells — mogelijk honeypot`,
      });
    }

    // ── EINDOORDEEL ───────────────────────────────────────
    const criticals = flags.filter(f => f.severity === 'critical').length;
    const highs     = flags.filter(f => f.severity === 'high').length;
    const isSafe    = criticals === 0 && highs <= 1;

    return { isSafe, flags, warnings };
  }

  function _fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return n.toFixed(0);
  }

  return { analyze };

})();
