/* ============================================================
   STORAGE.JS - localStorage wrapper met defaults
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

  const MAX_LOGS    = 500;
  const MAX_SIGNALS = 200;
  const MAX_CLOSED  = 500;

  const DEFAULT_SETTINGS = {
    tradingMode:        'paper',
    startingCapital:    0.1,
    tradeAmount:        0.01,
    maxOpenPositions:   5,
    stopLossPercent:    15,
    takeProfit1Percent: 30,
    takeProfit2Percent: 80,
    minScore:           70,
    minLiquidityUsd:    10000,
    minHolders:         50,
    maxTopHolderPercent:20,
    minVolume24h:       5000,
    minMarketCap:       5000,
    maxMarketCap:       10000000,
    minAgeMinutes:      5,
    maxAgeMinutes:      1440,
    heliusApiKey:       '',
    birdeyeApiKey:      '',
    scanIntervalSeconds:30,
  };

  // ── LOW-LEVEL ──────────────────────────────────────────────

  function _get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function _set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage vol */ }
  }

  // ── SETTINGS ──────────────────────────────────────────────

  function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, _get(KEYS.SETTINGS) || {});
  }

  function saveSettings(s) {
    _set(KEYS.SETTINGS, s);
  }

  function getDefaultSettings() { return Object.assign({}, DEFAULT_SETTINGS); }

  // ── PORTFOLIO ─────────────────────────────────────────────

  function getPortfolio() {
    const s = getSettings();
    return _get(KEYS.PORTFOLIO) || {
      startingBalance:  s.startingCapital,
      currentBalance:   s.startingCapital,
      totalPnlSol:      0,
      totalPnlPercent:  0,
      winRate:          0,
      totalTrades:      0,
      winningTrades:    0,
      losingTrades:     0,
      bestTrade:        0,
      worstTrade:       0,
    };
  }

  function savePortfolio(p) { _set(KEYS.PORTFOLIO, p); }

  function resetPortfolio() {
    const s = getSettings();
    savePortfolio({
      startingBalance:  s.startingCapital,
      currentBalance:   s.startingCapital,
      totalPnlSol:      0,
      totalPnlPercent:  0,
      winRate:          0,
      totalTrades:      0,
      winningTrades:    0,
      losingTrades:     0,
      bestTrade:        0,
      worstTrade:       0,
    });
    _set(KEYS.OPEN_TRADES, []);
    _set(KEYS.CLOSED_TRADES, []);
  }

  // ── TRADES ────────────────────────────────────────────────

  function getOpenTrades()  { return _get(KEYS.OPEN_TRADES)  || []; }
  function saveOpenTrades(t){ _set(KEYS.OPEN_TRADES, t); }

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

  // ── LOGS ──────────────────────────────────────────────────

  function getLogs(limit) {
    const all = _get(KEYS.LOGS) || [];
    return limit ? all.slice(0, limit) : all;
  }

  function addLog(level, message, extra) {
    const all = _get(KEYS.LOGS) || [];
    all.unshift({
      id:        'log_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
      timestamp: Date.now(),
      level,
      message,
      ...extra,
    });
    if (all.length > MAX_LOGS) all.splice(MAX_LOGS);
    _set(KEYS.LOGS, all);
  }

  function clearLogs() { _set(KEYS.LOGS, []); }

  // ── SIGNALS ───────────────────────────────────────────────

  function getSignals(limit) {
    const all = _get(KEYS.SIGNALS) || [];
    return limit ? all.slice(0, limit) : all;
  }

  function addSignal(signal) {
    const all = _get(KEYS.SIGNALS) || [];
    all.unshift(signal);
    if (all.length > MAX_SIGNALS) all.splice(MAX_SIGNALS);
    _set(KEYS.SIGNALS, all);
  }

  function clearSignals() { _set(KEYS.SIGNALS, []); }

  // ── WALLET ────────────────────────────────────────────────

  function getWallet() {
    return _get(KEYS.WALLET) || { isConnected: false, publicKey: null, balance: null };
  }

  // NOOIT private keys opslaan - alleen publieke wallet info
  function saveWallet(info) {
    _set(KEYS.WALLET, {
      isConnected: !!info.isConnected,
      publicKey:   info.publicKey || null,
      balance:     info.balance   || null,
    });
  }

  // ── PUBLIC API ────────────────────────────────────────────

  return {
    getSettings, saveSettings, getDefaultSettings,
    getPortfolio, savePortfolio, resetPortfolio,
    getOpenTrades, saveOpenTrades,
    getClosedTrades, addClosedTrade,
    getLogs, addLog, clearLogs,
    getSignals, addSignal, clearSignals,
    getWallet, saveWallet,
  };

})();
