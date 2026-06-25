/* ============================================================
   APP.JS - Hoofd controller
   ============================================================ */
'use strict';

const App = (() => {

  let _currentPage  = 'dashboard';
  let _allTokens    = [];
  let _allSignals   = [];
  let _refreshTimer = null;

  async function init() {
    _setupNav();
    _setupScannerBtns();
    _setupWalletBtns();
    _setupModeBtns();
    _setupSettings();
    _setupSignalsPage();
    _setupBacktest();
    _setupLogBtns();

    Scanner.setCallbacks({
      onSignal:    _onSignal,
      onStatus:    _onStatus,
      onNewTokens: _onNewTokens,
    });

    UI.loadSettingsIntoForm();
    await _tryRestoreWallet();
    _refreshUI();
    _refreshTimer = setInterval(_refreshUI, 8000);

    Storage.addLog('info', '🚀 Axiom Scanner geladen — klik Start Scanner');
    console.log('[App] Axiom Scanner klaar');
  }

  // ── NAVIGATIE ─────────────────────────────────────────────
  function _setupNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', e => { e.preventDefault(); _goto(item.dataset.page); });
    });
  }

  function _goto(page) {
    if (!page) return;
    _currentPage = page;
    document.querySelectorAll('.nav-item').forEach(n =>
      n.classList.toggle('nav-item--active', n.dataset.page === page)
    );
    document.querySelectorAll('.page').forEach(p =>
      p.classList.toggle('page--active', p.id === `page-${page}`)
    );
    _loadPage(page);
  }

  function _loadPage(page) {
    switch (page) {
      case 'dashboard': _refreshDash(); break;
      case 'scanner':
        UI.renderScannerTable(_allTokens, _allSignals,
          document.getElementById('scanner-search')?.value || '',
          document.getElementById('scanner-sort')?.value   || 'score',
          document.getElementById('scanner-filter-action')?.value || 'all'
        ); break;
      case 'signals':
        UI.renderSignalCards(
          Storage.getSignals(100),
          document.getElementById('sig-filter')?.value || 'all',
          document.getElementById('sig-only-safe')?.checked ?? true
        ); break;
      case 'positions':
        UI.renderOpenPositions(_onClosePos);
        UI.renderTradeHistory(); break;
      case 'settings':
        UI.loadSettingsIntoForm(); break;
      case 'backtest':
        _initBtDates(); break;
    }
  }

  // ── SCANNER ───────────────────────────────────────────────
  function _setupScannerBtns() {
    document.getElementById('btn-toggle-scanner')?.addEventListener('click', () => {
      if (Scanner.isRunning()) Scanner.stop();
      else Scanner.start();
      UI.updateScannerStatus(Scanner.isRunning());
    });

    document.getElementById('btn-scan-once')?.addEventListener('click', () => {
      Scanner.scanOnce();
      UI.toast('Handmatige scan gestart...', 'info');
    });

    // Scanner filters op scanner pagina
    ['scanner-search','scanner-sort','scanner-filter-action'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        if (_currentPage === 'scanner') _loadPage('scanner');
      });
    });
    document.getElementById('scanner-search')?.addEventListener('input', () => {
      if (_currentPage === 'scanner') _loadPage('scanner');
    });
  }

  function _onStatus(status) {
    UI.updateScannerStatus(status.isRunning);
    _refreshKPIs();
  }

  function _onSignal(signal, trade) {
    if (signal.action === 'BUY') {
      const tradeMsg = trade ? ` → Trade geopend!` : '';
      UI.toast(`🚀 ${signal.tokenData?.symbol} score ${signal.scoreResult?.total}/100${tradeMsg}`, 'success', 6000);
    }
    if (_currentPage === 'dashboard') _refreshDash();
    if (_currentPage === 'signals')   _loadPage('signals');
    if (_currentPage === 'positions') { UI.renderOpenPositions(_onClosePos); UI.renderTradeHistory(); }
  }

  function _onNewTokens(tokens, signals) {
    _allTokens  = tokens;
    _allSignals = signals;
    if (_currentPage === 'scanner')   _loadPage('scanner');
    if (_currentPage === 'positions') { UI.renderOpenPositions(_onClosePos); UI.renderTradeHistory(); }
    _refreshKPIs();
  }

  // ── POSITIE SLUITEN ───────────────────────────────────────
  async function _onClosePos(tradeId) {
    const ok = await TradeManager.manualClose(tradeId);
    if (ok) {
      UI.toast('Positie gesloten', 'success');
      UI.renderOpenPositions(_onClosePos);
      UI.renderTradeHistory();
      _refreshKPIs();
    } else {
      UI.toast('Kon positie niet sluiten', 'error');
    }
  }

  // ── WALLET ────────────────────────────────────────────────
  function _setupWalletBtns() {
    document.getElementById('btn-connect-wallet')?.addEventListener('click', async () => {
      const w = Storage.getWallet();
      if (w.isConnected) {
        await Wallet.disconnect();
        UI.updateWalletUI(Storage.getWallet());
        UI.toast('Wallet verbroken', 'info');
      } else {
        try {
          const info = await Wallet.connect();
          UI.updateWalletUI({ isConnected: true, publicKey: info.publicKey, balance: info.balance });
          UI.toast(`👻 ${info.publicKey.slice(0,8)}... | ${info.balance.toFixed(4)} SOL`, 'success');
        } catch (err) {
          UI.toast(err.message, 'error');
        }
      }
    });
  }

  async function _tryRestoreWallet() {
    const stored = Storage.getWallet();
    UI.updateWalletUI(stored);
    if (stored.isConnected) {
      const info = await Wallet.tryAutoConnect().catch(() => null);
      if (info) UI.updateWalletUI({ isConnected: true, publicKey: info.publicKey, balance: info.balance });
      else      UI.updateWalletUI({ isConnected: false, publicKey: null, balance: null });
    }
  }

  function onWalletChange() { UI.updateWalletUI(Storage.getWallet()); }

  // ── MODUS ─────────────────────────────────────────────────
  function _setupModeBtns() {
    document.getElementById('btn-paper')?.addEventListener('click', () => {
      const s = Storage.getSettings(); s.tradingMode = 'paper'; Storage.saveSettings(s);
      UI.updateModeUI('paper');
      UI.toast('📄 Paper Trading geactiveerd', 'info');
    });

    document.getElementById('btn-live')?.addEventListener('click', () => {
      if (!Wallet.isConnected()) {
        UI.toast('⚠️ Verbind eerst Phantom wallet', 'warning'); return;
      }
      if (!confirm(
        '⚠️ WAARSCHUWING — LIVE TRADING\n\n' +
        'Dit gebruikt ECHT SOL van je wallet.\n' +
        'Fees zijn ~6% per roundtrip.\n' +
        'Bij €1 kapitaal is elke verliezende trade zwaar.\n\n' +
        'Zeker weten dat je live wilt gaan?'
      )) return;
      const s = Storage.getSettings(); s.tradingMode = 'live'; Storage.saveSettings(s);
      UI.updateModeUI('live');
      UI.toast('🔴 LIVE Trading — wees voorzichtig!', 'warning', 7000);
    });

    UI.updateModeUI(Storage.getSettings().tradingMode);
  }

  // ── INSTELLINGEN ─────────────────────────────────────────
  function _setupSettings() {
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      const ns = UI.readSettingsFromForm();
      // Valideer minimum tradeAmount zodat fees niet >25% worden
      const fees = Storage.getFees();
      const minTrade = (fees.networkFeeSOL / 0.25); // fees max 25% van trade
      if (ns.tradeAmount < minTrade) {
        UI.toast(`⚠️ Trade bedrag te laag — fees worden >25%. Min: ${minTrade.toFixed(5)} SOL`, 'warning', 6000);
      }
      Storage.saveSettings(ns);
      UI.loadSettingsIntoForm();
      UI.toast('✅ Instellingen opgeslagen', 'success');
      if (Scanner.isRunning()) { Scanner.stop(); setTimeout(() => Scanner.start(), 300); }
    });

    document.getElementById('btn-reset-portfolio')?.addEventListener('click', () => {
      if (!confirm('Portfolio resetten naar startkapitaal? Alle trades worden gewist.')) return;
      Storage.resetPortfolio();
      UI.toast('Portfolio gereset', 'info');
      _refreshKPIs();
    });
  }

  // ── SIGNALEN PAGINA ───────────────────────────────────────
  function _setupSignalsPage() {
    document.getElementById('sig-filter')?.addEventListener('change',    () => _loadPage('signals'));
    document.getElementById('sig-only-safe')?.addEventListener('change', () => _loadPage('signals'));
  }

  // ── LOGS ─────────────────────────────────────────────────
  function _setupLogBtns() {
    document.getElementById('btn-clear-log-dash')?.addEventListener('click', () => {
      Storage.clearLogs(); UI.renderLog('dashboard-log'); UI.toast('Logs gewist','info');
    });
  }

  // ── BACKTEST ─────────────────────────────────────────────
  function _setupBacktest() {
    document.getElementById('btn-run-backtest')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-run-backtest');
      btn.disabled = true; btn.textContent = '⏳ Bezig...';
      try {
        const start = new Date(document.getElementById('bt-start').value).getTime();
        const end   = new Date(document.getElementById('bt-end').value).getTime();
        if (isNaN(start)||isNaN(end)||end<=start) { UI.toast('Ongeldige datums','error'); return; }

        const config = {
          startDate:  start,
          endDate:    end,
          capital:    parseFloat(document.getElementById('bt-capital').value)    || 0.006,
          minScore:   parseInt(document.getElementById('bt-min-score').value)    || 65,
          sl:         parseFloat(document.getElementById('bt-sl').value)         || 20,
          tp1:        parseFloat(document.getElementById('bt-tp1').value)        || 60,
          tp2:        parseFloat(document.getElementById('bt-tp2').value)        || 200,
          tradeAmount:parseFloat(document.getElementById('bt-amount').value)     || 0.002,
        };

        await new Promise(r => setTimeout(r, 30));
        const result = BacktestEngine.run(config);
        UI.renderBacktestResults(result);
        UI.toast(`Klaar: ${result.trades.length} trades | ${result.metrics.totalReturn.toFixed(1)}% rendement`, 'success');
      } catch(e) {
        UI.toast('Backtest fout: '+e.message,'error');
        console.error(e);
      } finally {
        btn.disabled = false; btn.textContent = '▶ Backtest Uitvoeren';
      }
    });
  }

  function _initBtDates() {
    const endEl = document.getElementById('bt-end');
    if (!endEl?.value) {
      const now = new Date();
      const ago = new Date(now - 30*24*60*60*1000);
      document.getElementById('bt-end').value   = now.toISOString().slice(0,10);
      document.getElementById('bt-start').value = ago.toISOString().slice(0,10);
    }
  }

  // ── REFRESH ───────────────────────────────────────────────
  function _refreshUI() {
    _refreshKPIs();
    if (_currentPage === 'dashboard')  _refreshDash();
    if (_currentPage === 'positions') { UI.renderOpenPositions(_onClosePos); UI.renderTradeHistory(); }
  }

  function _refreshKPIs() {
    const p = Storage.getPortfolio();
    UI.updateKPIs(p, { scannedCount: 0 });
    UI.updateScannerStatus(Scanner.isRunning());
    UI.updateModeUI(Storage.getSettings().tradingMode);
  }

  function _refreshDash() {
    _refreshKPIs();
    const sigs = Storage.getSignals(30).filter(s => s.action !== 'SKIP');
    UI.renderSignalFeed('dashboard-signals', sigs);
    UI.renderLog('dashboard-log', 60);
  }

  return { init, onWalletChange };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
