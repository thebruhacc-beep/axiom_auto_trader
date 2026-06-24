/* ============================================================
   APP.JS - Hoofd applicatie controller
   Verbindt alle modules en beheert navigatie + events
   ============================================================ */

'use strict';

const App = (() => {

  // ── STATE ─────────────────────────────────────────────────
  let _currentPage  = 'dashboard';
  let _allTokens    = [];
  let _allSignals   = [];
  let _refreshTimer = null;

  // ── INITIALISATIE ─────────────────────────────────────────

  async function init() {
    _setupNavigation();
    _setupScannerButtons();
    _setupWalletButtons();
    _setupModeButtons();
    _setupSettingsPage();
    _setupSignalsPage();
    _setupBacktestPage();
    _setupLogButtons();

    // Scanner callbacks
    Scanner.setCallbacks({
      onSignal:    _onNewSignal,
      onStatus:    _onScannerStatus,
      onNewTokens: _onNewTokens,
    });

    // Laad opgeslagen instellingen in formulier
    UI.loadSettingsIntoForm();

    // Herstel wallet sessie (Phantom eager connect)
    await _tryRestoreWallet();

    // Eerste render
    _refreshUI();

    // Periodieke UI refresh elke 10 seconden
    _refreshTimer = setInterval(_refreshUI, 10000);

    console.log('[App] Axiom Scanner geladen');
  }

  // ── NAVIGATIE ─────────────────────────────────────────────

  function _setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', e => {
        e.preventDefault();
        const page = item.dataset.page;
        if (page) _navigateTo(page);
      });
    });
  }

  function _navigateTo(page) {
    _currentPage = page;

    // Update nav actief
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('nav-item--active', n.dataset.page === page);
    });

    // Toon correcte pagina
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('page--active', p.id === `page-${page}`);
    });

    // Laad pagina-specifieke data
    _loadPageData(page);
  }

  function _loadPageData(page) {
    switch (page) {
      case 'dashboard':
        _refreshDashboard();
        break;
      case 'scanner':
        UI.renderScannerTable(
          _allTokens, _allSignals,
          document.getElementById('scanner-search')?.value || '',
          document.getElementById('scanner-sort')?.value   || 'score',
          document.getElementById('scanner-filter-action')?.value || 'all'
        );
        break;
      case 'signals':
        UI.renderSignalCards(
          Storage.getSignals(100),
          document.getElementById('sig-filter')?.value || 'all',
          document.getElementById('sig-only-safe')?.checked ?? true
        );
        break;
      case 'positions':
        UI.renderOpenPositions(_onClosePosition);
        UI.renderTradeHistory();
        break;
      case 'settings':
        UI.loadSettingsIntoForm();
        break;
      case 'backtest':
        // Stel standaard datums in
        _initBacktestDates();
        break;
    }
  }

  // ── SCANNER KNOPPEN ───────────────────────────────────────

  function _setupScannerButtons() {
    document.getElementById('btn-toggle-scanner')?.addEventListener('click', () => {
      if (Scanner.isRunning()) {
        Scanner.stop();
      } else {
        Scanner.start();
      }
      UI.updateScannerStatus(Scanner.isRunning());
    });

    document.getElementById('btn-scan-once')?.addEventListener('click', () => {
      Scanner.scanOnce();
      UI.toast('Handmatige scan gestart...', 'info');
    });
  }

  // ── SCANNER CALLBACKS ─────────────────────────────────────

  function _onScannerStatus(status) {
    UI.updateScannerStatus(status.isRunning);
    _refreshDashboard();
  }

  function _onNewSignal(signal) {
    // Toon toast bij koopsignaal
    if (signal.action === 'BUY') {
      UI.toast(
        `🚀 Koopsignaal: ${signal.tokenData.symbol} — Score ${signal.scoreResult.total}/100`,
        'success'
      );
    }
    // Refresh actieve pagina
    if (_currentPage === 'dashboard') _refreshDashboard();
    if (_currentPage === 'signals')   _loadPageData('signals');
  }

  function _onNewTokens(tokens, signals) {
    _allTokens  = tokens;
    _allSignals = signals;

    if (_currentPage === 'scanner') _loadPageData('scanner');
    if (_currentPage === 'positions') {
      UI.renderOpenPositions(_onClosePosition);
      UI.renderTradeHistory();
    }
    _refreshDashboard();
  }

  // ── POSITIE SLUITEN ───────────────────────────────────────

  async function _onClosePosition(tradeId) {
    const ok = await TradeManager.manualClose(tradeId);
    if (ok) {
      UI.toast('Positie gesloten', 'success');
      UI.renderOpenPositions(_onClosePosition);
      UI.renderTradeHistory();
      _refreshKPIs();
    } else {
      UI.toast('Kon positie niet sluiten', 'error');
    }
  }

  // ── WALLET ────────────────────────────────────────────────

  function _setupWalletButtons() {
    document.getElementById('btn-connect-wallet')?.addEventListener('click', async () => {
      const wallet = Storage.getWallet();
      if (wallet.isConnected) {
        await Wallet.disconnect();
        UI.updateWalletUI(Storage.getWallet());
        UI.toast('Wallet verbroken', 'info');
      } else {
        try {
          const info = await Wallet.connect();
          UI.updateWalletUI({ isConnected: true, publicKey: info.publicKey, balance: info.balance });
          UI.toast(`👻 Verbonden: ${info.publicKey.slice(0,8)}... | ${info.balance.toFixed(4)} SOL`, 'success');
        } catch (err) {
          UI.toast(err.message, 'error');
        }
      }
    });
  }

  async function _tryRestoreWallet() {
    const stored = Storage.getWallet();
    if (stored.isConnected) {
      // Probeer automatisch te herverbinden
      try {
        const info = await Wallet.tryAutoConnect();
        if (info) {
          UI.updateWalletUI({ isConnected: true, publicKey: info.publicKey, balance: info.balance });
        } else {
          UI.updateWalletUI({ isConnected: false, publicKey: null, balance: null });
        }
      } catch {
        UI.updateWalletUI({ isConnected: false, publicKey: null, balance: null });
      }
    }
  }

  // Externe callback voor wallet wijzigingen (vanuit wallet.js)
  function onWalletChange() {
    UI.updateWalletUI(Storage.getWallet());
  }

  // ── MODE TOGGLE ───────────────────────────────────────────

  function _setupModeButtons() {
    document.getElementById('btn-paper')?.addEventListener('click', () => {
      const s = Storage.getSettings();
      s.tradingMode = 'paper';
      Storage.saveSettings(s);
      UI.updateModeUI('paper');
      UI.toast('Modus: Paper Trading', 'info');
    });

    document.getElementById('btn-live')?.addEventListener('click', () => {
      if (!Wallet.isConnected()) {
        UI.toast('Verbind eerst je Phantom wallet voor live trading', 'warning');
        return;
      }
      if (!confirm(
        '⚠️ WAARSCHUWING\n\n' +
        'Live trading gebruikt ECHT SOL.\n' +
        'U kunt uw volledige inleg verliezen.\n\n' +
        'Zeker weten?'
      )) return;

      const s = Storage.getSettings();
      s.tradingMode = 'live';
      Storage.saveSettings(s);
      UI.updateModeUI('live');
      UI.toast('⚠️ Live Trading geactiveerd — wees voorzichtig!', 'warning');
    });

    // Initiële modus tonen
    const s = Storage.getSettings();
    UI.updateModeUI(s.tradingMode);
  }

  // ── INSTELLINGEN ─────────────────────────────────────────

  function _setupSettingsPage() {
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      const newSettings = UI.readSettingsFromForm();
      Storage.saveSettings(newSettings);
      UI.toast('✅ Instellingen opgeslagen', 'success');

      // Herstart scanner met nieuwe interval als die draait
      if (Scanner.isRunning()) {
        Scanner.stop();
        setTimeout(() => Scanner.start(), 500);
        UI.toast('Scanner herstart met nieuwe instellingen', 'info');
      }
    });
  }

  // ── SIGNALEN PAGINA ───────────────────────────────────────

  function _setupSignalsPage() {
    document.getElementById('sig-filter')?.addEventListener('change', () => _loadPageData('signals'));
    document.getElementById('sig-only-safe')?.addEventListener('change', () => _loadPageData('signals'));
  }

  // ── SCANNER PAGINA ────────────────────────────────────────

  // (Filters lukken via delegatie in _loadPageData)
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('scanner-search')?.addEventListener('input', () => {
      if (_currentPage === 'scanner') _loadPageData('scanner');
    });
    document.getElementById('scanner-sort')?.addEventListener('change', () => {
      if (_currentPage === 'scanner') _loadPageData('scanner');
    });
    document.getElementById('scanner-filter-action')?.addEventListener('change', () => {
      if (_currentPage === 'scanner') _loadPageData('scanner');
    });
  });

  // ── LOG KNOPPEN ───────────────────────────────────────────

  function _setupLogButtons() {
    document.getElementById('btn-clear-log-dash')?.addEventListener('click', () => {
      Storage.clearLogs();
      UI.renderLog('dashboard-log');
      UI.toast('Logs gewist', 'info');
    });
  }

  // ── BACKTEST ─────────────────────────────────────────────

  function _setupBacktestPage() {
    document.getElementById('btn-run-backtest')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-run-backtest');
      btn.disabled    = true;
      btn.textContent = '⏳ Bezig...';

      try {
        const startDate = new Date(document.getElementById('bt-start').value).getTime();
        const endDate   = new Date(document.getElementById('bt-end').value).getTime();

        if (isNaN(startDate) || isNaN(endDate) || endDate <= startDate) {
          UI.toast('Ongeldige datums', 'error');
          return;
        }

        const config = {
          startDate,
          endDate,
          capital:    parseFloat(document.getElementById('bt-capital').value)    || 0.1,
          minScore:   parseInt(document.getElementById('bt-min-score').value)    || 70,
          sl:         parseFloat(document.getElementById('bt-sl').value)         || 15,
          tp1:        parseFloat(document.getElementById('bt-tp1').value)        || 30,
          tp2:        parseFloat(document.getElementById('bt-tp2').value)        || 80,
          tradeAmount:parseFloat(document.getElementById('bt-amount').value)     || 0.01,
        };

        // Run in small timeout zodat UI kan updaten
        await new Promise(resolve => setTimeout(resolve, 50));
        const result = BacktestEngine.run(config);
        UI.renderBacktestResults(result);
        UI.toast(`Backtest klaar: ${result.trades.length} trades, ${result.metrics.totalReturn.toFixed(2)}% rendement`, 'success');

      } catch (err) {
        UI.toast('Backtest fout: ' + err.message, 'error');
        console.error('[Backtest]', err);
      } finally {
        btn.disabled    = false;
        btn.textContent = '▶ Backtest Uitvoeren';
      }
    });
  }

  function _initBacktestDates() {
    const endEl   = document.getElementById('bt-end');
    const startEl = document.getElementById('bt-start');
    if (!endEl.value) {
      const now    = new Date();
      const month  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      endEl.value   = now.toISOString().slice(0, 10);
      startEl.value = month.toISOString().slice(0, 10);
    }
  }

  // ── REFRESH ───────────────────────────────────────────────

  function _refreshUI() {
    _refreshKPIs();
    if (_currentPage === 'dashboard') _refreshDashboard();
  }

  function _refreshKPIs() {
    const portfolio = Storage.getPortfolio();
    const status    = {
      isRunning:    Scanner.isRunning(),
      scannedCount: 0,
      lastScan:     Date.now(),
    };
    UI.updateKPIs(portfolio, status);
    UI.updateScannerStatus(Scanner.isRunning());
  }

  function _refreshDashboard() {
    _refreshKPIs();

    // Recente signalen
    const signals = Storage.getSignals(20);
    UI.renderSignalFeed('dashboard-signals', signals.filter(s => s.action !== 'SKIP'));

    // Log feed
    UI.renderLog('dashboard-log', 60);
  }

  // ── PUBLIC API ────────────────────────────────────────────

  return { init, onWalletChange };

})();

// ── START ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
