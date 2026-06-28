/* ============================================================
   STORAGE.JS - localStorage wrapper
   €1 Challenge met fee-bewust risicobeheer
   
   SOLANA FEES (realistisch):
   - Netwerk fee:     ~0.000005 SOL per tx (~$0.001)
   - Axiom fee:       1% van trade waarde
   - Slippage small:  1-3% bij kleine liquiditeit
   - TOTAAL per trade roundtrip: ~2-4% van trade waarde
   ============================================================ */
'use strict';

const Storage = (() => {

  const KEYS = {
    SETTINGS:      'axiom_settings',
    PORTFOLIO:     'axiom_portfolio',
    OPEN_TRADES:   'axiom_open_trades',
    CLOSED_TRADES: 'axiom_closed_trades',
    LOGS:          'axiom_logs',
    SIGNALS:       'axiom_signals',
    WALLET:        'axiom_wallet',
  };

  const MAX_LOGS    = 300;
  const MAX_SIGNALS = 200;
  const MAX_CLOSED  = 500;

  // ── FEE CONSTANTEN ────────────────────────────────────────
  // Worden gebruikt door tradeManager voor realistische simulatie
  const FEES = {
    networkFeeSOL:    0.000005, // ~$0.001 vaste Solana tx fee
    axiomFeePct:      0.01,     // 1% Axiom platform fee
    slippagePct:      0.02,     // 2% slippage (conservatief voor kleine liquidity)
    totalRoundtripPct:0.06,     // ~6% totaal heen+terug (buy+sell fees+slippage)
  };

  // 0.01 SOL → 200x challenge
  // 0.01 SOL ≈ $1.70 bij SOL = $170
  // Doel: 0.01 SOL groeien naar 2 SOL (200x)
  // Per trade 0.003 SOL — fees ~6% roundtrip = $0.03 per trade (acceptabel)
  // 0.01 SOL → 200x challenge
  // 0.01 SOL ≈ $1.70 bij SOL=$170
  // 0.01 SOL → 200x challenge - verbeterde instellingen na analyse
  // 0.01 SOL → 200x challenge - winstgevende instellingen
  // Doel: winrate 35%+ zodat expectancy positief is
  const DEFAULT_SETTINGS = {
    tradingMode:          'paper',
    startingCapital:      0.01,
    tradeAmount:          0.003,
    maxOpenPositions:     2,
    stopLossPercent:      15,
    takeProfit1Percent:   60,
    takeProfit2Percent:   200,
    // STRENGER: hogere kwaliteitsbalk voor betere winrate
    minScore:             62,
    minLiquidityUsd:      8000,    // $8K min — minder rug pulls, eerlijkere prijs
    minHolders:           0,
    maxTopHolderPercent:  25,
    minVolume24h:         5000,    // $5K min — actieve markt
    minMarketCap:         50000,   // $50K min — voorkomt rug pulls zoals BULLIEVE
    maxMarketCap:         10000000,
    minAgeMinutes:        5,
    maxAgeMinutes:        2880,
    minBuySellRatio:      1.5,     // NIEUW: meer kopers dan verkopers verplicht
    slCooldownMinutes:    120,     // 120 min cooldown (was 90)
    requirePositiveTrend: true,
    heliusApiKey:         '',
    birdeyeApiKey:        '',
    scanIntervalSeconds:  30,
  };





  function _get(key) {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
    catch { return null; }
  }

  function _set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch(e) { console.warn('[Storage] vol:', e); }
  }

  function getSettings()        { return Object.assign({}, DEFAULT_SETTINGS, _get(KEYS.SETTINGS) || {}); }
  function saveSettings(s)      { _set(KEYS.SETTINGS, s); }
  function getDefaultSettings() { return Object.assign({}, DEFAULT_SETTINGS); }
  function getFees()            { return Object.assign({}, FEES); }

  function getPortfolio() {
    const s = getSettings();
    return Object.assign({
      startingBalance: s.startingCapital,
      currentBalance:  s.startingCapital,
      totalPnlSol:     0,
      totalPnlPercent: 0,
      winRate:         0,
      totalTrades:     0,
      winningTrades:   0,
      losingTrades:    0,
      bestTrade:       0,
      worstTrade:      0,
      totalFeesPaid:   0,
    }, _get(KEYS.PORTFOLIO) || {});
  }

  function savePortfolio(p)  { _set(KEYS.PORTFOLIO, p); }

  function resetPortfolio() {
    const s = getSettings();
    _set(KEYS.PORTFOLIO, {
      startingBalance: s.startingCapital,
      currentBalance:  s.startingCapital,
      totalPnlSol:     0,
      totalPnlPercent: 0,
      winRate:         0,
      totalTrades:     0,
      winningTrades:   0,
      losingTrades:    0,
      bestTrade:       0,
      worstTrade:      0,
      totalFeesPaid:   0,
    });
    _set(KEYS.OPEN_TRADES,   []);
    _set(KEYS.CLOSED_TRADES, []);
    _set(KEYS.SIGNALS,       []);
    _set(KEYS.LOGS,          []);
  }

  function getOpenTrades()   { return _get(KEYS.OPEN_TRADES) || []; }
  function saveOpenTrades(t) { _set(KEYS.OPEN_TRADES, t); }

  function getClosedTrades(limit) {
    const all = _get(KEYS.CLOSED_TRADES) || [];
    return limit ? all.slice(0, limit) : all;
  }

  function addClosedTrade(trade) {
    const all = _get(KEYS.CLOSED_TRADES) || [];
    all.unshift(trade);
    if (all.length > MAX_CLOSED) all.splice(MAX_CLOSED);
    _set(KEYS.CLOSED_TRADES, all);
  }

  function getLogs(limit) {
    const all = _get(KEYS.LOGS) || [];
    return limit ? all.slice(0, limit) : all;
  }

  function addLog(level, message, extra) {
    const all = _get(KEYS.LOGS) || [];
    all.unshift(Object.assign({ id: 'l'+Date.now(), timestamp: Date.now(), level, message }, extra || {}));
    if (all.length > MAX_LOGS) all.splice(MAX_LOGS);
    _set(KEYS.LOGS, all);
    const fn = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
    fn(`[Axiom][${level}] ${message}`);
  }

  function clearLogs() { _set(KEYS.LOGS, []); }

  function getSignals(limit) {
    const all = _get(KEYS.SIGNALS) || [];
    return limit ? all.slice(0, limit) : all;
  }

  function addSignal(signal) {
    const all = _get(KEYS.SIGNALS) || [];
    const recent = all.find(s =>
      s.tokenData && signal.tokenData &&
      s.tokenData.address === signal.tokenData.address &&
      (signal.timestamp - s.timestamp) < 30000
    );
    if (recent) return;
    all.unshift(signal);
    if (all.length > MAX_SIGNALS) all.splice(MAX_SIGNALS);
    _set(KEYS.SIGNALS, all);
  }

  function clearSignals() { _set(KEYS.SIGNALS, []); }

  // ── BLACKLIST (cooldown na stop loss) ─────────────────────
  // Slaat op: { address: string, unlocksAt: number }
  function getBlacklist() { return _get('axiom_blacklist') || []; }

  function addToBlacklist(tokenAddress, tokenSymbol, cooldownMinutes) {
    var bl = getBlacklist().filter(function(b) { return b.address !== tokenAddress; });
    bl.push({
      address:   tokenAddress,
      symbol:    tokenSymbol,
      unlocksAt: Date.now() + cooldownMinutes * 60 * 1000,
    });
    _set('axiom_blacklist', bl);
    addLog('warning', '⏳ COOLDOWN: ' + tokenSymbol + ' geblokkeerd voor ' + cooldownMinutes + ' min na stop loss');
  }

  function isBlacklisted(tokenAddress) {
    var now = Date.now();
    var bl  = getBlacklist().filter(function(b) { return b.unlocksAt > now; });
    _set('axiom_blacklist', bl); // Schoon verlopen entries op
    return bl.some(function(b) { return b.address === tokenAddress; });
  }

  function clearBlacklist() { _set('axiom_blacklist', []); }

  function getWallet() {
    return _get(KEYS.WALLET) || { isConnected: false, publicKey: null, balance: null };
  }

  function saveWallet(info) {
    _set(KEYS.WALLET, {
      isConnected: !!info.isConnected,
      publicKey:   info.publicKey || null,
      balance:     info.balance   || null,
    });
  }

  return {
    getSettings, saveSettings, getDefaultSettings, getFees,
    getPortfolio, savePortfolio, resetPortfolio,
    getOpenTrades, saveOpenTrades,
    getClosedTrades, addClosedTrade,
    getLogs, addLog, clearLogs,
    getSignals, addSignal, clearSignals,
    getWallet, saveWallet,
    getBlacklist, addToBlacklist, isBlacklisted, clearBlacklist,
  };
})();
