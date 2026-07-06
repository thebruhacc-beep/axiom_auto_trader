/* ============================================================
   TRADEMANAGER.JS - Paper & live trades MET fee berekening
   
   Fee structuur (realistisch voor Axiom/Solana):
   BUY:  netwerk fee + 1% Axiom fee + 1-2% slippage = ~2-3%
   SELL: netwerk fee + 1% Axiom fee + 1-2% slippage = ~2-3%
   TOTAAL roundtrip: ~4-6% van trade waarde
   
   Bij €0.34 trade (0.002 SOL):
   - Fees kopen:  ~0.000060 SOL ($0.01)
   - Fees verkopen: ~0.000060 SOL ($0.01)  
   - Totaal fees: ~0.000120 SOL ($0.02) = ~6% van trade
   → Break-even bij +6%, dus TP1 bij +60% heeft ruime marge
   ============================================================ */
'use strict';

const TradeManager = (() => {

  let _solPrice    = 170;
  let _solPriceAt  = 0;

  async function _getSolPrice() {
    if (Date.now() - _solPriceAt < 60000) return _solPrice;
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      if (r.ok) { const d = await r.json(); _solPrice = d.solana?.usd || _solPrice; }
    } catch { /* gebruik cache */ }
    _solPriceAt = Date.now();
    return _solPrice;
  }

  // ── FEE BEREKENING ────────────────────────────────────────

  function _calcFees(amountSol, isBuy) {
    const fees = Storage.getFees();
    // Netwerk fee is vast per transactie
    const networkFee = fees.networkFeeSOL;
    // Platform + slippage fee is % van trade bedrag
    const platformFee = amountSol * (fees.axiomFeePct + fees.slippagePct);
    return networkFee + platformFee;
  }

  function _feeWarning(amountSol, solPrice) {
    const fees   = Storage.getFees();
    const feeSOL = _calcFees(amountSol, true) + _calcFees(amountSol, false);
    const feeUSD = feeSOL * solPrice;
    const feePct = (feeSOL / amountSol) * 100;
    return { feeSOL, feeUSD, feePct };
  }

  // ── OPEN PAPER TRADE ──────────────────────────────────────

  async function openPaperTrade(signal, settings) {
    const portfolio  = Storage.getPortfolio();
    const openTrades = Storage.getOpenTrades();

    // Dubbele positie check (zelfde token al open?)
    // Stil controleren op duplicaat (tokenFetcher filtert al open tokens weg)
    if (openTrades.find(function(t) { return t.tokenAddress === signal.tokenData.address; })) {
      return null;
    }

    if (openTrades.length >= settings.maxOpenPositions) {
      Storage.addLog('warning', `Max posities (${settings.maxOpenPositions}) bereikt`);
      return null;
    }

    const solPrice  = await _getSolPrice();
    const amountSol = settings.tradeAmount;

    // Controleer of we genoeg kapitaal hebben inclusief fees
    const buyFeeSOL = _calcFees(amountSol, true);
    const totalCost = amountSol + buyFeeSOL;

    if (portfolio.currentBalance < totalCost) {
      Storage.addLog('warning',
        `Onvoldoende saldo: ${portfolio.currentBalance.toFixed(5)} SOL ` +
        `(nodig: ${totalCost.toFixed(5)} SOL incl. fees)`
      );
      return null;
    }

    const { feePct } = _feeWarning(amountSol, solPrice);
    if (feePct > 15) {
      Storage.addLog('warning',
        `⚠️ Fees (${feePct.toFixed(1)}%) zijn >15% van trade ${signal.tokenData.symbol} — ` +
        `verhoog tradeAmount voor betere fee ratio`
      );
    }

    const entry      = signal.tokenData.priceUsd;
    const amountUSD  = amountSol * solPrice;
    // Effectieve tokens na slippage bij koop
    const slippageFactor = 1 - Storage.getFees().slippagePct;
    const tokenAmount    = (amountUSD / entry) * slippageFactor;

    // Break-even prijs inclusief alle fees (roundtrip)
    const fees           = Storage.getFees();
    const totalFeePct    = (fees.axiomFeePct + fees.slippagePct) * 2; // heen + terug
    const breakEvenPrice = entry * (1 + totalFeePct + fees.networkFeeSOL / amountSol);

    const trade = {
      id:               'trade_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      tokenAddress:     signal.tokenData.address,
      tokenSymbol:      signal.tokenData.symbol,
      tokenName:        signal.tokenData.name,
      entryPrice:       entry,
      entryPriceAfterFees: entry * (1 + Storage.getFees().slippagePct), // effectieve instapprijs
      currentPrice:     entry,
      amountSol:        amountSol,
      buyFeeSOL:        buyFeeSOL,
      tokenAmount:      tokenAmount,
      entryTime:        Date.now(),
      status:           'OPEN',
      pnlUsd:           0,
      pnlSol:           0,
      pnlPercent:       0,
      pnlPercentAfterFees: 0,
      isPartiallyExited:false,
      isPaper:          true,
      // Take profits hoog genoeg om fees te compenseren
      stopLossPrice:    entry * (1 - settings.stopLossPercent / 100),
      takeProfitPrice1: entry * (1 + settings.takeProfit1Percent / 100),
      takeProfitPrice2: entry * (1 + settings.takeProfit2Percent / 100),
      breakEvenPrice,
      scoreAtEntry:     signal.scoreResult.total,
      dexUrl:           signal.tokenData.dexscreenerUrl,
      pairAddress:      signal.tokenData.pairAddress || signal.tokenData.address,
      marketCapAtEntry: signal.tokenData.marketCap,
      solPriceAtEntry:  solPrice,
      // Fee samenvatting
      feeInfo: {
        buyFeeSOL,
        estimatedSellFeeSOL: _calcFees(amountSol, false),
        totalEstimatedFeeSOL: buyFeeSOL + _calcFees(amountSol, false),
        feePctOfTrade: feePct,
        breakEvenPct:  ((breakEvenPrice - entry) / entry * 100),
      },
    };

    // Trek kosten + fees af van portfolio
    portfolio.currentBalance -= totalCost;
    portfolio.totalFeesPaid   = (portfolio.totalFeesPaid || 0) + buyFeeSOL;
    portfolio.totalTrades++;
    Storage.savePortfolio(portfolio);

    openTrades.push(trade);
    Storage.saveOpenTrades(openTrades);

    Storage.addLog('success',
      `📈 KOOP: ${signal.tokenData.symbol} @ $${_fmtP(entry)} | ` +
      `${amountSol} SOL | Score: ${signal.scoreResult.total} | ` +
      `Fees: ${(buyFeeSOL * solPrice).toFixed(3)}$ | ` +
      `Break-even: +${trade.feeInfo.breakEvenPct.toFixed(1)}%`
    );

    return trade;
  }

  // ── CONTROLEER OPEN POSITIES ──────────────────────────────

  async function checkPositions(priceMap) {
    const settings   = Storage.getSettings();
    const openTrades = Storage.getOpenTrades();
    if (!openTrades.length) return;

    const portfolio = Storage.getPortfolio();
    const solPrice  = await _getSolPrice();
    const toClose   = [];

    for (const trade of openTrades) {
      let current = priceMap.get(trade.tokenAddress);
      // Als geen verse prijs: gebruik laatste bekende prijs (minimaal refreshen)
      if (!current || current <= 0) {
        current = trade.currentPrice || 0;
        if (!current || current <= 0) continue;
      }

      trade.currentPrice   = current;
      trade.pnlPercent     = ((current - trade.entryPrice) / trade.entryPrice) * 100;

      // PnL na fees (realistischer getal)
      const sellFeeSOL     = _calcFees(trade.amountSol, false);
      const grossReturnSOL = trade.amountSol * (trade.pnlPercent / 100);
      const netReturnSOL   = grossReturnSOL - trade.buyFeeSOL - sellFeeSOL;
      trade.pnlSol         = netReturnSOL;
      trade.pnlUsd         = netReturnSOL * solPrice;
      trade.pnlPercentAfterFees = (netReturnSOL / trade.amountSol) * 100;

      // ── STOP LOSS ───────────────────────────────────────
      if (current <= trade.stopLossPrice) {
        // Live trade: voer echte sell uit via Jupiter
        if (!trade.isPaper && typeof Wallet !== 'undefined' && Wallet.isConnected()) {
          Storage.addLog('warning', '🛑 LIVE STOP LOSS: ' + trade.tokenSymbol + ' — verkoop via Jupiter...');
          try {
            await Wallet.executeSell(trade.tokenAddress, trade.tokenAmount, 6, 300);
          } catch(e) {
            Storage.addLog('error', 'Live SL sell mislukt: ' + e.message);
          }
        }
        _executeClose(trade, current, 'CLOSED_STOPLOSS', portfolio, solPrice);
        toClose.push(trade.id);
        const slSettings = Storage.getSettings();
        Storage.addToBlacklist(
          trade.tokenAddress,
          trade.tokenSymbol,
          slSettings.slCooldownMinutes || 90
        );
        Storage.addLog('warning',
          `🛑 STOP LOSS: ${trade.tokenSymbol} | ` +
          `Bruto: ${trade.pnlPercent.toFixed(1)}% | ` +
          `Netto na fees: ${trade.pnlPercentAfterFees.toFixed(1)}% | ` +
          `${trade.pnlSol.toFixed(5)} SOL`
        );
        continue;
      }

      // ── TAKE PROFIT 1: verkoop 50% ───────────────────────
      if (current >= trade.takeProfitPrice1 && !trade.isPartiallyExited) {
        trade.isPartiallyExited   = true;
        trade.partialExitTime     = Date.now();
        trade.partialExitPrice    = current;

        // Live trade: verkoop 50% via Jupiter
        if (!trade.isPaper && typeof Wallet !== 'undefined' && Wallet.isConnected()) {
          Storage.addLog('success', '💰 LIVE TP1 (50%): ' + trade.tokenSymbol + ' — verkoop via Jupiter...');
          try {
            const halfTokens = trade.tokenAmount * 0.5;
            await Wallet.executeSell(trade.tokenAddress, halfTokens, 6, 150);
          } catch(e) {
            Storage.addLog('error', 'Live TP1 sell mislukt: ' + e.message);
          }
        }

        // Bereken opbrengst van 50% positie
        const halfAmountSOL      = trade.amountSol * 0.5;
        const halfSellFee        = _calcFees(halfAmountSOL, false);
        const halfGrossReturn    = halfAmountSOL * (1 + trade.pnlPercent / 100);
        const halfNetReturn      = halfGrossReturn - halfSellFee;

        portfolio.currentBalance  += halfNetReturn;
        portfolio.totalFeesPaid    = (portfolio.totalFeesPaid || 0) + halfSellFee;

        Storage.addLog('success',
          `💰 TP1 (50%): ${trade.tokenSymbol} @ $${_fmtP(current)} | ` +
          `+${trade.pnlPercent.toFixed(1)}% bruto | ` +
          `+${halfNetReturn.toFixed(5)} SOL netto (na fees: ${(halfSellFee*solPrice).toFixed(3)}$)`
        );
      }

      // ── TAKE PROFIT 2: verkoop rest ───────────────────────
      if (current >= trade.takeProfitPrice2 && trade.isPartiallyExited) {
        // Live trade: verkoop resterende 50% via Jupiter
        if (!trade.isPaper && typeof Wallet !== 'undefined' && Wallet.isConnected()) {
          Storage.addLog('success', '🚀 LIVE TP2 (rest): ' + trade.tokenSymbol + ' — verkoop via Jupiter...');
          try {
            const restTokens = trade.tokenAmount * 0.5;
            await Wallet.executeSell(trade.tokenAddress, restTokens, 6, 150);
          } catch(e) {
            Storage.addLog('error', 'Live TP2 sell mislukt: ' + e.message);
          }
        }
        _executeClose(trade, current, 'CLOSED_PROFIT', portfolio, solPrice, true);
        toClose.push(trade.id);
        Storage.addLog('success',
          `🚀 TP2 (rest): ${trade.tokenSymbol} @ $${_fmtP(current)} | ` +
          `+${trade.pnlPercent.toFixed(1)}% bruto | ` +
          `+${trade.pnlSol.toFixed(5)} SOL netto`
        );
        continue;
      }

      // ── TIMEOUT: token doet niets na 4 uur ───────────────
      const holdMinutes = (Date.now() - trade.entryTime) / 60000;
      if (holdMinutes > 240 && !trade.isPartiallyExited && trade.pnlPercent < 10) {
        _executeClose(trade, current, 'CLOSED_TIMEOUT', portfolio, solPrice);
        toClose.push(trade.id);
        Storage.addLog('warning',
          `⏰ TIMEOUT (4u): ${trade.tokenSymbol} | ${trade.pnlPercent.toFixed(1)}% | netto: ${trade.pnlSol.toFixed(5)} SOL`
        );
      }
    }

    // Bewaar alleen nog-open trades
    const remaining = openTrades.filter(t => !toClose.includes(t.id));
    Storage.saveOpenTrades(remaining);
    Storage.savePortfolio(portfolio);
  }

  // ── SLUIT TRADE AF ────────────────────────────────────────

  function _executeClose(trade, exitPrice, status, portfolio, solPrice, isRemainder = false) {
    trade.exitTime  = Date.now();
    trade.exitPrice = exitPrice;
    trade.status    = status;

    // Als TP1 al geraakt was: alleen de resterende 50% afrekenen
    const fraction      = isRemainder ? 0.5 : (trade.isPartiallyExited ? 0.5 : 1.0);
    const sellAmountSOL = trade.amountSol * fraction;
    const sellFeeSOL    = _calcFees(sellAmountSOL, false);

    const grossReturn   = sellAmountSOL * (1 + ((exitPrice - trade.entryPrice) / trade.entryPrice));
    const netReturn     = grossReturn - sellFeeSOL;

    trade.pnlSol        = netReturn - (sellAmountSOL); // profit/loss gedeelte
    trade.pnlPercent    = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
    trade.pnlPercentAfterFees = (trade.pnlSol / sellAmountSOL) * 100;

    portfolio.currentBalance  += netReturn;
    portfolio.totalFeesPaid    = (portfolio.totalFeesPaid || 0) + sellFeeSOL;

    if (trade.pnlSol > 0) {
      portfolio.winningTrades++;
      portfolio.bestTrade = Math.max(portfolio.bestTrade || 0, trade.pnlPercent);
    } else {
      portfolio.losingTrades++;
      portfolio.worstTrade = Math.min(portfolio.worstTrade || 0, trade.pnlPercent);
    }

    portfolio.totalPnlSol     = portfolio.currentBalance - portfolio.startingBalance;
    portfolio.totalPnlPercent = (portfolio.totalPnlSol / portfolio.startingBalance) * 100;
    portfolio.winRate         = portfolio.totalTrades > 0
      ? (portfolio.winningTrades / portfolio.totalTrades) * 100 : 0;

    Storage.addClosedTrade({ ...trade });
  }

  // ── HANDMATIG SLUITEN ─────────────────────────────────────

  async function manualClose(tradeId) {
    const openTrades = Storage.getOpenTrades();
    const idx        = openTrades.findIndex(t => t.id === tradeId);
    if (idx === -1) return false;

    const trade    = openTrades[idx];
    const portfolio= Storage.getPortfolio();
    const solPrice = await _getSolPrice();

    _executeClose(trade, trade.currentPrice, 'CLOSED_MANUAL', portfolio, solPrice);
    openTrades.splice(idx, 1);
    Storage.saveOpenTrades(openTrades);
    Storage.savePortfolio(portfolio);

    Storage.addLog('info',
      `❌ HANDMATIG: ${trade.tokenSymbol} @ $${_fmtP(trade.currentPrice)} | ` +
      `${trade.pnlPercent.toFixed(1)}% bruto | netto na fees: ${trade.pnlSol.toFixed(5)} SOL`
    );
    return true;
  }

  // ── OPEN LIVE TRADE (na succesvolle Jupiter swap) ─────────
  async function openLiveTrade(signal, settings, swapResult) {
    const portfolio  = Storage.getPortfolio();
    const openTrades = Storage.getOpenTrades();
    const solPrice   = 170; // Gebruik vaste prijs als fallback

    // Dubbele positie check
    if (openTrades.find(function(t) { return t.tokenAddress === signal.tokenData.address; })) {
      return null;
    }

    const entry       = signal.tokenData.priceUsd;
    const amountSol   = settings.tradeAmount;
    const fees        = Storage.getFees();
    const buyFeeSOL   = amountSol * (fees.axiomFeePct + fees.slippagePct) + fees.networkFeeSOL;
    const tokenAmount = swapResult.outAmount || ((amountSol * solPrice) / entry);

    const trade = {
      id:               'live_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      tokenAddress:     signal.tokenData.address,
      tokenSymbol:      signal.tokenData.symbol,
      tokenName:        signal.tokenData.name,
      entryPrice:       entry,
      currentPrice:     entry,
      amountSol:        amountSol,
      buyFeeSOL:        buyFeeSOL,
      tokenAmount:      tokenAmount,
      entryTime:        Date.now(),
      status:           'OPEN',
      pnlUsd:           0,
      pnlSol:           0,
      pnlPercent:       0,
      pnlPercentAfterFees: 0,
      isPartiallyExited: false,
      isPaper:          false, // LIVE trade!
      stopLossPrice:    entry * (1 - settings.stopLossPercent   / 100),
      takeProfitPrice1: entry * (1 + settings.takeProfit1Percent / 100),
      takeProfitPrice2: entry * (1 + settings.takeProfit2Percent / 100),
      breakEvenPrice:   entry * (1 + (fees.axiomFeePct + fees.slippagePct) * 2),
      scoreAtEntry:     signal.scoreResult.total,
      dexUrl:           signal.tokenData.dexscreenerUrl,
      pairAddress:      signal.tokenData.pairAddress || signal.tokenData.address,
      txHash:           swapResult.signature,
      feeInfo: {
        buyFeeSOL,
        estimatedSellFeeSOL:   amountSol * (fees.axiomFeePct + fees.slippagePct),
        totalEstimatedFeeSOL:  buyFeeSOL + amountSol * (fees.axiomFeePct + fees.slippagePct),
        feePctOfTrade:         (buyFeeSOL / amountSol) * 100,
        breakEvenPct:          (fees.axiomFeePct + fees.slippagePct) * 2 * 100,
      },
    };

    openTrades.push(trade);
    Storage.saveOpenTrades(openTrades);

    portfolio.currentBalance -= (amountSol + buyFeeSOL);
    portfolio.totalFeesPaid   = (portfolio.totalFeesPaid || 0) + buyFeeSOL;
    portfolio.totalTrades++;
    Storage.savePortfolio(portfolio);

    Storage.addLog('success',
      '🔴 LIVE TRADE OPEN: ' + signal.tokenData.symbol +
      ' | $' + _fmtP(entry) +
      ' | ' + amountSol + ' SOL' +
      ' | Tx: ' + String(swapResult.signature).slice(0,12) + '...'
    );

    return trade;
  }

  function _fmtP(p) {
    if (!p || p <= 0) return '0';
    if (p < 0.000001) return p.toExponential(3);
    if (p < 0.001)    return p.toFixed(8);
    if (p < 1)        return p.toFixed(6);
    return p.toFixed(4);
  }

  return { openPaperTrade, checkPositions, manualClose };
})();
