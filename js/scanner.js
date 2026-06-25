/* ============================================================
   SCANNER.JS - Scan loop die trades ECHT uitvoert
   ============================================================ */
'use strict';

const Scanner = (() => {

  let _running  = false;
  let _timer    = null;
  let _scanning = false;
  let _scanCount= 0;
  let _priceMap = new Map();

  let _onSignal    = null;
  let _onStatus    = null;
  let _onNewTokens = null;

  function setCallbacks(cb) {
    _onSignal    = cb.onSignal    || null;
    _onStatus    = cb.onStatus    || null;
    _onNewTokens = cb.onNewTokens || null;
  }

  function start() {
    if (_running) return;
    _running = true;
    _notify();
    Storage.addLog('success', '🟢 Scanner gestart — zoekt koopkansen...');
    _runCycle();
    const s = Storage.getSettings();
    _timer = setInterval(() => { if (!_scanning) _runCycle(); }, s.scanIntervalSeconds * 1000);
  }

  function stop() {
    if (!_running) return;
    _running = false;
    clearInterval(_timer);
    _timer = null;
    Storage.addLog('info', '⏹ Scanner gestopt');
    _notify();
  }

  function isRunning() { return _running; }

  function scanOnce() {
    if (_scanning) {
      Storage.addLog('info', 'Scan al bezig, wacht...');
      return;
    }
    _runCycle();
  }

  async function _runCycle() {
    if (_scanning) return;
    _scanning = true;
    _notify();

    const settings = Storage.getSettings();
    const t0       = Date.now();

    try {
      // 1. Controleer ook open posities met bekende prijzen
      if (_priceMap.size > 0) {
        await TradeManager.checkPositions(_priceMap);
      }

      // 2. Haal nieuwe tokens op
      const tokens = await TokenFetcher.scanAll();
      _scanCount += tokens.length;

      // Update prijsmap
      for (const t of tokens) {
        if (t.priceUsd > 0) _priceMap.set(t.address, t.priceUsd);
      }

      // 3. Analyseer elk token en genereer signalen
      const signals  = [];
      const buySignals = [];

      for (const token of tokens) {
        // ── Basisfilters (goedkoop, geen API) ──
        if (token.priceUsd        <= 0)                          continue;
        if (token.liquidity        < settings.minLiquidityUsd)   continue;
        if (token.volume24h        < settings.minVolume24h)      continue;
        if (token.marketCap        < settings.minMarketCap)      continue;
        if (token.marketCap        > settings.maxMarketCap)      continue;
        if (token.ageMinutes       < settings.minAgeMinutes)     continue;
        if (token.ageMinutes       > settings.maxAgeMinutes)     continue;
        if (token.largestHolderPercent > settings.maxTopHolderPercent) continue;

        const safety = SafetyAnalyzer.analyze(token, settings);
        const score  = ScoreCalculator.calculate(token, safety);

        const signal = {
          id:             'sig_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
          timestamp:      Date.now(),
          tokenData:      token,
          safetyAnalysis: safety,
          scoreResult:    score,
          action:         score.recommendation,
          reason:         _reason(score, safety),
        };

        Storage.addSignal(signal);
        signals.push(signal);

        // 4. KOOP als score hoog genoeg EN veilig
        if (score.recommendation === 'BUY' && score.total >= settings.minScore && safety.isSafe) {
          buySignals.push(signal);

          if (settings.tradingMode === 'paper') {
            // Paper trade uitvoeren
            const trade = await TradeManager.openPaperTrade(signal, settings);
            if (trade && _onSignal) _onSignal(signal, trade);
          } else {
            // Live trading
            if (Wallet.isConnected()) {
              Storage.addLog('info',
                `🔴 LIVE signaal: ${token.symbol} (score ${score.total}) — ` +
                `open Axiom.trade voor handmatige bevestiging`
              );
              window.open(`https://axiom.trade/meme/${token.pairAddress}`, '_blank');
            } else {
              Storage.addLog('warning', `Live signaal ${token.symbol} maar wallet niet verbonden`);
            }
            if (_onSignal) _onSignal(signal, null);
          }
        }
      }

      // 5. Controleer posities opnieuw met verse prijzen
      if (_priceMap.size > 0) {
        await TradeManager.checkPositions(_priceMap);
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const open    = Storage.getOpenTrades().length;
      Storage.addLog('info',
        `✅ Scan: ${tokens.length} tokens | ${buySignals.length} koopsignalen | ` +
        `${open} open posities | ${elapsed}s`
      );

      if (_onNewTokens) _onNewTokens(tokens, signals);

    } catch (err) {
      Storage.addLog('error', `Scan fout: ${err.message || String(err)}`);
      console.error('[Scanner]', err);
    }

    _scanning = false;
    _notify();
  }

  function _notify() {
    if (_onStatus) _onStatus({ isRunning: _running, scannedCount: _scanCount, lastScan: Date.now() });
  }

  function _reason(score, safety) {
    if (!safety.isSafe) {
      return 'Onveilig: ' + safety.flags.slice(0,2).map(f =>
        f.type.replace(/_/g,' ').toLowerCase()
      ).join(', ');
    }
    if (score.total >= 65) {
      return score.breakdown
        .filter(b => b.points > 0)
        .sort((a,b) => b.points - a.points)
        .slice(0,2)
        .map(b => b.category)
        .join(' + ');
    }
    return `Score ${score.total}/100`;
  }

  return { start, stop, isRunning, scanOnce, setCallbacks };
})();
