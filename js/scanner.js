/* ============================================================
   SCANNER.JS - Robuuste scan loop
   Fix: betere error handling, duidelijke logging, 
   garanteert trade uitvoering bij match
   ============================================================ */
'use strict';

const Scanner = (() => {

  let _running   = false;
  let _timer     = null;
  let _scanning  = false;
  let _scanCount = 0;
  let _priceMap  = new Map();

  let _onSignal    = null;
  let _onStatus    = null;
  let _onNewTokens = null;

  function setCallbacks(cb) {
    _onSignal    = cb.onSignal    || null;
    _onStatus    = cb.onStatus    || null;
    _onNewTokens = cb.onNewTokens || null;
  }

  // ── START ─────────────────────────────────────────────────
  function start() {
    if (_running) {
      Storage.addLog('warning', 'Scanner al actief');
      return;
    }
    _running = true;
    _notify();
    Storage.addLog('success', '🟢 Scanner gestart — eerste scan over enkele seconden...');

    // Directe eerste scan na 1 seconde (geeft UI tijd te updaten)
    setTimeout(() => { if (_running) _runCycle(); }, 1000);

    const s = Storage.getSettings();
    _timer = setInterval(() => {
      if (_running && !_scanning) _runCycle();
    }, s.scanIntervalSeconds * 1000);
  }

  // ── STOP ──────────────────────────────────────────────────
  function stop() {
    _running = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    _scanning = false;
    Storage.addLog('info', '⏹ Scanner gestopt');
    _notify();
  }

  function isRunning() { return _running; }

  function scanOnce() {
    if (_scanning) {
      Storage.addLog('info', '⏳ Scan al bezig, even geduld...');
      return;
    }
    Storage.addLog('info', '🔍 Handmatige scan gestart...');
    _runCycle();
  }

  // ── HOOFD SCAN CYCLUS ─────────────────────────────────────
  async function _runCycle() {
    if (_scanning) return;
    _scanning = true;
    _notify();

    const settings = Storage.getSettings();
    const t0       = Date.now();

    try {
      // STAP 1: Controleer bestaande posities met bekende prijzen
      if (_priceMap.size > 0) {
        try {
          await TradeManager.checkPositions(_priceMap);
        } catch(e) {
          Storage.addLog('warning', 'Positiecheck fout: ' + e.message);
        }
      }

      // STAP 2: Haal verse tokens op van DexScreener
      let tokens = [];
      try {
        tokens = await TokenFetcher.scanAll();
      } catch(e) {
        Storage.addLog('error', 'TokenFetcher fout: ' + e.message);
        _scanning = false;
        _notify();
        return;
      }

      if (!tokens.length) {
        Storage.addLog('warning', '⚠️ Geen tokens ontvangen — DexScreener tijdelijk traag? Volgende scan over ' + settings.scanIntervalSeconds + 's');
        _scanning = false;
        _notify();
        return;
      }

      _scanCount += tokens.length;

      // Update prijsmap met verse prijzen
      for (const t of tokens) {
        if (t.priceUsd > 0) _priceMap.set(t.address, t.priceUsd);
      }

      // Haal verse prijzen op voor open posities die niet in scan zaten
      // PriceRefresher doet dit via aparte DexScreener calls per token
      if (typeof PriceRefresher !== 'undefined') {
        var freshPrices = await PriceRefresher.refreshOpenPositions();
        freshPrices.forEach(function(price, addr) {
          _priceMap.set(addr, price);
        });
      } else {
        // Fallback: gebruik laatste bekende prijs
        const openNow = Storage.getOpenTrades();
        for (const ot of openNow) {
          if (!_priceMap.has(ot.tokenAddress) && ot.currentPrice > 0) {
            _priceMap.set(ot.tokenAddress, ot.currentPrice);
          }
        }
      }

      // STAP 3: Analyseer elk token
      const signals    = [];
      const buySignals = [];
      let   skipped    = 0;

      for (const token of tokens) {
        // Snelle pre-filter (geen API nodig)
        if (!token.priceUsd || token.priceUsd <= 0)               { skipped++; continue; }
        if (token.liquidity   < settings.minLiquidityUsd)  { skipped++; continue; }
        if (token.volume24h   < settings.minVolume24h)     { skipped++; continue; }
        if (token.marketCap > 0 && token.marketCap < settings.minMarketCap) { skipped++; continue; }
        if (token.marketCap > 0 && token.marketCap > settings.maxMarketCap) { skipped++; continue; }
        if (token.ageMinutes  > settings.maxAgeMinutes)    { skipped++; continue; }
        // Buy/sell ratio filter — alleen coins met meer kopers dan verkopers
        var minBS = settings.minBuySellRatio || 1.2;
        if (token.buySellRatio < minBS) { skipped++; continue; }

        // Veiligheidsanalyse
        let safety;
        try {
          safety = SafetyAnalyzer.analyze(token, settings);
        } catch(e) {
          console.warn('[Scanner] SafetyAnalyzer fout voor', token.symbol, e);
          continue;
        }

        // Score berekening
        let score;
        try {
          score = ScoreCalculator.calculate(token, safety);
        } catch(e) {
          console.warn('[Scanner] ScoreCalculator fout voor', token.symbol, e);
          continue;
        }

        const signal = {
          id:             'sig_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
          timestamp:      Date.now(),
          tokenData:      token,
          safetyAnalysis: safety,
          scoreResult:    score,
          action:         score.recommendation,
          reason:         _buildReason(score, safety),
        };

        Storage.addSignal(signal);
        signals.push(signal);

        // STAP 4: Voer trade uit als criterium gehaald
        // Check 1: Blacklist (cooldown na stop loss — voorkomt herhaald kopen dalende coin)
        var blCheck = Storage.isBlacklisted(token.address);

        // Check 2: Trend filter — alleen blokkeren bij sterke neerwaartse trend
        // -5% was te streng voor memecoins, -25% is realistischer
        var trendOk = !settings.requirePositiveTrend || token.priceChange1h > -25;

        if (!blCheck && score.recommendation === 'BUY' && score.total >= settings.minScore && safety.isSafe && trendOk) {
          buySignals.push(signal);

          if (settings.tradingMode === 'paper') {
            try {
              const trade = await TradeManager.openPaperTrade(signal, settings);
              if (trade) {
                Storage.addLog('success',
                  `✅ PAPER TRADE GEOPEND: ${token.symbol} | ` +
                  `Score: ${score.total} | ` +
                  `$${_fmtP(token.priceUsd)} | ` +
                  `${settings.tradeAmount} SOL`
                );
                if (_onSignal) _onSignal(signal, trade);
              }
            } catch(e) {
              Storage.addLog('error', 'Trade open fout: ' + e.message);
            }
          } else {
            // Live trading
            if (typeof Wallet !== 'undefined' && Wallet.isConnected()) {
              Storage.addLog('info',
                `🔴 LIVE SIGNAAL: ${token.symbol} score ${score.total} — ` +
                `open Axiom voor uitvoering`
              );
              // Open Axiom.trade op dit token
              try {
                window.open(`https://axiom.trade/meme/${token.pairAddress}`, '_blank');
              } catch(e) { /* popup geblokkeerd */ }
            } else {
              Storage.addLog('warning',
                `⚠️ Koopsignaal ${token.symbol} (${score.total}) — ` +
                `verbind wallet voor live trading`
              );
            }
            if (_onSignal) _onSignal(signal, null);
          }
        }
      }

      // STAP 5: Nogmaals positiecheck met verse prijzen
      if (_priceMap.size > 0) {
        try {
          await TradeManager.checkPositions(_priceMap);
        } catch(e) {
          Storage.addLog('warning', 'Positiecheck 2 fout: ' + e.message);
        }
      }

      const elapsed  = ((Date.now() - t0) / 1000).toFixed(1);
      const openPos  = Storage.getOpenTrades().length;
      Storage.addLog('info',
        `📊 Scan: ${tokens.length} tokens | ${skipped} gefilterd | ` +
        `${buySignals.length} koopsignalen | ` +
        `${openPos} open posities | ${elapsed}s`
      );

      if (_onNewTokens) _onNewTokens(tokens, signals);

    } catch (err) {
      Storage.addLog('error', `❌ Scan mislukt: ${err.message || String(err)}`);
      console.error('[Scanner] onverwachte fout:', err);
    }

    _scanning = false;
    _notify();
  }

  function _notify() {
    if (_onStatus) _onStatus({
      isRunning:    _running,
      scannedCount: _scanCount,
      lastScan:     Date.now(),
    });
  }

  function _buildReason(score, safety) {
    if (!safety.isSafe) {
      const flags = safety.flags.slice(0,2).map(f =>
        f.type.replace(/_/g,' ').toLowerCase()
      ).join(', ');
      return `Onveilig: ${flags}`;
    }
    if (score.total >= 62) {
      return score.breakdown
        .filter(b => b.points > 0)
        .sort((a,b) => b.points - a.points)
        .slice(0, 2)
        .map(b => b.category)
        .join(' + ');
    }
    return `Score ${score.total}/100`;
  }

  function _fmtP(p) {
    if (!p) return '0';
    if (p < 0.000001) return p.toExponential(3);
    if (p < 0.001)    return p.toFixed(8);
    if (p < 1)        return p.toFixed(6);
    return p.toFixed(4);
  }

  return { start, stop, isRunning, scanOnce, setCallbacks };
})();
