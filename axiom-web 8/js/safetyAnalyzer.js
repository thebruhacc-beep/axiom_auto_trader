/* ============================================================
   SAFETYANALYZER.JS - Veiligheidscontroles
   Aangepast voor €1 challenge: iets ruimere limieten
   maar de kritische checks blijven hard
   ============================================================ */
'use strict';

const SafetyAnalyzer = (() => {

  function analyze(token, settings) {
    const flags    = [];
    const warnings = [];

    // ── HARDE KILLS ───────────────────────────────────────
    // Deze zijn altijd disqualificerend, ongeacht instellingen

    if (token.largestHolderPercent > settings.maxTopHolderPercent) {
      flags.push({
        type:     'TOP_HOLDER_TOO_HIGH',
        severity: token.largestHolderPercent > 40 ? 'critical' : 'high',
        description: `Grootste holder: ${token.largestHolderPercent.toFixed(1)}% (max ${settings.maxTopHolderPercent}%)`,
        value: token.largestHolderPercent,
      });
    }

    if (token.topHolderPercent > 60) {
      flags.push({
        type:     'WHALE_CONCENTRATION',
        severity: token.topHolderPercent > 80 ? 'critical' : 'high',
        description: `Top-10 bezitten ${token.topHolderPercent.toFixed(1)}%`,
        value: token.topHolderPercent,
      });
    }

    if (token.liquidity < settings.minLiquidityUsd) {
      flags.push({
        type:     'LOW_LIQUIDITY',
        severity: token.liquidity < settings.minLiquidityUsd * 0.5 ? 'critical' : 'high',
        description: `Liquiditeit $${_f(token.liquidity)} (min $${_f(settings.minLiquidityUsd)})`,
        value: token.liquidity,
      });
    }

    // Verdachte honeypot: veel buys maar haast geen sells
    if (token.buyCount24h > 50 && token.sellCount24h < 3) {
      flags.push({
        type:     'HONEYPOT_SUSPECTED',
        severity: 'critical',
        description: `${token.buyCount24h} buys vs ${token.sellCount24h} sells — mogelijk honeypot`,
      });
    }

    if (token.rugCheckScore < 20) {
      flags.push({
        type:     'RUG_RISK',
        severity: 'critical',
        description: `RugCheck score: ${token.rugCheckScore}/100`,
        value: token.rugCheckScore,
      });
    }

    // ── WAARSCHUWINGEN ────────────────────────────────────

    if (token.holderCount < settings.minHolders) {
      flags.push({
        type:     'TOO_FEW_HOLDERS',
        severity: token.holderCount < 10 ? 'high' : 'medium',
        description: `${token.holderCount} holders (min ${settings.minHolders})`,
        value: token.holderCount,
      });
    }

    if (!token.isLiquidityLocked && token.ageMinutes < 30) {
      flags.push({
        type:     'LIQUIDITY_NOT_LOCKED',
        severity: 'medium',
        description: 'Liquiditeit niet vergrendeld en token < 30 min oud',
      });
      warnings.push('Liquiditeit niet vergrendeld');
    }

    if (token.buySellRatio < 0.4) {
      flags.push({
        type:     'HIGH_SELL_PRESSURE',
        severity: token.buySellRatio < 0.2 ? 'high' : 'medium',
        description: `Buy/sell ratio: ${token.buySellRatio.toFixed(2)} — hoge verkoopdruk`,
        value: token.buySellRatio,
      });
    }

    if (token.rugCheckScore < 40 && token.rugCheckScore >= 20) {
      flags.push({
        type:     'LOW_RUGCHECK',
        severity: 'medium',
        description: `RugCheck ${token.rugCheckScore}/100 — laag`,
        value: token.rugCheckScore,
      });
      warnings.push('Lage RugCheck score');
    }

    // ── EINDOORDEEL ───────────────────────────────────────
    const criticals = flags.filter(f => f.severity === 'critical').length;
    const highs     = flags.filter(f => f.severity === 'high').length;
    // Veilig als: geen criticals EN max 1 high
    const isSafe    = criticals === 0 && highs <= 1;

    return { isSafe, flags, warnings };
  }

  function _f(n) {
    if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
    if (n >= 1e3) return (n/1e3).toFixed(0)+'K';
    return (n||0).toFixed(0);
  }

  return { analyze };
})();
