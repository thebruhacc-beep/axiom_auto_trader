/* ============================================================
   SCANNER.JS - Hoofd scan loop met interval timing
   ============================================================ */

'use strict';

const Scanner = (() => {

  let _running  = false;
  let _timer    = null;
  let _scanCount= 0;
  let _priceMap = new Map();

  // Callbacks (ingesteld door App)
  let _onSignal   = null;
  let _onStatus   = null;
  let _onNewTokens= null;

  function setCallbacks(cb) {
    _onSignal    = cb.onSignal;
    _onStatus    = cb.onStatus;
    _onNewTokens = cb.onNewTokens;
  }

  // ── START / STOP ──────────────────────────────────────────

  function start() {
    if (_running) return;
    _running = true;
    Storage.addLog('success', 'Scanner gestart');
    _notify();
    _runCycle(); // Directe eerste scan
    const s = Storage.getSettings();
    _timer = setInterval(_runCycle, s.scanIntervalSeconds * 1000);
  }

  function stop() {
    if (!_running) return;
    _running = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    Storage.addLog('info', 'Scanner gestopt');
    _notify();
  }

  function isRunning() { return _running; }

  function scanOnce() { _runCycle(); }

  // ── SCAN CYCLUS ───────────────────────────────────────────

  async function _runCycle() {
    const settings = Storage.getSettings();
    Storage.addLog('info', 'Scan cyclus gestart...');

    try {
      // 1. Haal tokens op
      const tokens = await TokenFetcher.scanAll();
      _scanCount += tokens.length;

      // 2. Update prijsmap voor positiebeheer
      for (const t of tokens) { _priceMap.set(t.address, t.priceUsd); }

      // 3. Analyseer elk token
      const signals = [];
      for (const token of tokens) {

        // Filter op basis van instellingen
        if (token.marketCap   < settings.minMarketCap)   continue;
        if (token.marketCap   > settings.maxMarketCap)   continue;
        if (token.ageMinutes  < settings.minAgeMinutes)  continue;
        if (token.ageMinutes  > settings.maxAgeMinutes)  continue;

        const safety = SafetyAnalyzer.analyze(token, settings);
        const score  = ScoreCalculator.calculate(token, safety);

        const action = score.recommendation;

        const signal = {
          id:          'sig_' + Date.now() + '_' + Math.random().toString(36).slice(2,4),
          timestamp:   Date.now(),
          tokenData:   token,
          safetyAnalysis: safety,
          scoreResult: score,
          action,
          reason:      _reason(score, safety),
        };

        Storage.addSignal(signal);
        signals.push(signal);

        // 4. Trade als score hoog genoeg en veilig
        if (action === 'BUY' && score.total >= settings.minScore && safety.isSafe) {
          if (settings.tradingMode === 'paper') {
            await TradeManager.openPaperTrade(signal, settings);
          } else {
            // Live trading
            if (Wallet.isConnected()) {
              Storage.addLog('info', `Live trade: ${token.symbol} — open Axiom.trade om te bevestigen`);
              // Redirect naar Axiom met token adres
              // window.open(`https://axiom.trade/meme/${token.pairAddress}`, '_blank');
            } else {
              Storage.addLog('warning', `Live signaal ${token.symbol} maar wallet niet verbonden`);
            }
          }
        }

        if (_onSignal) _onSignal(signal);
      }

      // 5. Controleer open posities op TP/SL
      await TradeManager.checkPositions(_priceMap);

      Storage.addLog('info', `Scan klaar: ${tokens.length} tokens, ${signals.filter(s => s.action === 'BUY').length} koopsignalen`);

      if (_onNewTokens) _onNewTokens(tokens, signals);

    } catch (err) {
      Storage.addLog('error', `Scan fout: ${err.message || err}`);
    }

    _notify();
  }

  function _notify() {
    if (_onStatus) _onStatus({
      isRunning:  _running,
      scannedCount: _scanCount,
      lastScan:   Date.now(),
    });
  }

  function _reason(score, safety) {
    if (!safety.isSafe) return `Onveilig: ${safety.flags.slice(0,2).map(f => f.type).join(', ')}`;
    if (score.total >= 70) {
      return score.breakdown.filter(b => b.points > 0).sort((a,b) => b.points - a.points).slice(0,2).map(b => b.category).join(', ');
    }
    return `Score ${score.total}/100`;
  }

  return { start, stop, isRunning, scanOnce, setCallbacks };

})();
