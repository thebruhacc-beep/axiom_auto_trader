/* ============================================================
   TRADEMANAGER.JS - Paper & live trade logica
   ============================================================ */

'use strict';

const TradeManager = (() => {

  // ── OPEN PAPER TRADE ──────────────────────────────────────

  async function openPaperTrade(signal, settings) {
    const portfolio   = Storage.getPortfolio();
    const openTrades  = Storage.getOpenTrades();

    if (openTrades.length >= settings.maxOpenPositions) {
      Storage.addLog('warning', `Max posities bereikt (${settings.maxOpenPositions}), skip`, { tokenSymbol: signal.tokenData.symbol });
      return null;
    }

    if (portfolio.currentBalance < settings.tradeAmount) {
      Storage.addLog('warning', `Onvoldoende saldo: ${portfolio.currentBalance.toFixed(4)} SOL`);
      return null;
    }

    const solPrice   = await TokenFetcher.getSolPrice();
    const entry      = signal.tokenData.priceUsd;
    const amountUsd  = settings.tradeAmount * solPrice;
    const tokens     = amountUsd / entry;

    const trade = {
      id:              'trade_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
      tokenAddress:    signal.tokenData.address,
      tokenSymbol:     signal.tokenData.symbol,
      tokenName:       signal.tokenData.name,
      entryPrice:      entry,
      currentPrice:    entry,
      amountSol:       settings.tradeAmount,
      tokenAmount:     tokens,
      entryTime:       Date.now(),
      status:          'OPEN',
      pnlUsd:          0,
      pnlSol:          0,
      pnlPercent:      0,
      isPartiallyExited: false,
      isPaper:         true,
      stopLossPrice:   entry * (1 - settings.stopLossPercent   / 100),
      takeProfitPrice1:entry * (1 + settings.takeProfit1Percent / 100),
      takeProfitPrice2:entry * (1 + settings.takeProfit2Percent / 100),
      scoreAtEntry:    signal.scoreResult.total,
      dexUrl:          signal.tokenData.dexscreenerUrl,
    };

    openTrades.push(trade);
    Storage.saveOpenTrades(openTrades);

    portfolio.currentBalance -= settings.tradeAmount;
    portfolio.totalTrades++;
    Storage.savePortfolio(portfolio);

    Storage.addLog('success',
      `PAPER KOOP: ${signal.tokenData.symbol} @ $${_fmtPrice(entry)} (${settings.tradeAmount} SOL) | Score: ${signal.scoreResult.total}`,
      { tokenSymbol: signal.tokenData.symbol, tokenAddress: signal.tokenData.address }
    );

    return trade;
  }

  // ── CONTROLEER OPEN POSITIES ──────────────────────────────

  async function checkPositions(priceMap) {
    const settings   = Storage.getSettings();
    const openTrades = Storage.getOpenTrades();
    const portfolio  = Storage.getPortfolio();
    const solPrice   = await TokenFetcher.getSolPrice();

    const toClose = [];
    const updated = [];

    for (const trade of openTrades) {
      const current = priceMap.get(trade.tokenAddress) || trade.currentPrice;
      trade.currentPrice = current;
      trade.pnlPercent   = ((current - trade.entryPrice) / trade.entryPrice) * 100;
      trade.pnlUsd       = (current - trade.entryPrice) * trade.tokenAmount;
      trade.pnlSol       = trade.pnlUsd / solPrice;

      // ── STOP LOSS ─────────────────────────────────────
      if (current <= trade.stopLossPrice) {
        await _closeTrade(trade, current, 'CLOSED_STOPLOSS', portfolio, solPrice);
        toClose.push(trade.id);
        Storage.addLog('warning',
          `STOP LOSS: ${trade.tokenSymbol} @ $${_fmtPrice(current)} (${trade.pnlPercent.toFixed(1)}%)`,
          { tokenSymbol: trade.tokenSymbol }
        );
        continue;
      }

      // ── TAKE PROFIT 1: verkoop 50% bij +TP1 ───────────
      if (current >= trade.takeProfitPrice1 && !trade.isPartiallyExited) {
        trade.isPartiallyExited  = true;
        trade.partialExitPercent = 50;
        const returnedSol        = (trade.amountSol * 0.5) * (1 + settings.takeProfit1Percent / 100);
        portfolio.currentBalance += returnedSol;
        Storage.addLog('success',
          `TAKE PROFIT 1 (50%): ${trade.tokenSymbol} @ $${_fmtPrice(current)} (+${trade.pnlPercent.toFixed(1)}%)`,
          { tokenSymbol: trade.tokenSymbol }
        );
      }

      // ── TAKE PROFIT 2: verkoop rest bij +TP2 ──────────
      if (current >= trade.takeProfitPrice2 && trade.isPartiallyExited) {
        await _closeTrade(trade, current, 'CLOSED_PROFIT', portfolio, solPrice);
        toClose.push(trade.id);
        Storage.addLog('success',
          `TAKE PROFIT 2: ${trade.tokenSymbol} @ $${_fmtPrice(current)} (+${trade.pnlPercent.toFixed(1)}%) VOLLEDIG GESLOTEN`,
          { tokenSymbol: trade.tokenSymbol }
        );
        continue;
      }

      updated.push(trade);
    }

    const remaining = updated.filter(t => !toClose.includes(t.id));
    Storage.saveOpenTrades(remaining);
    Storage.savePortfolio(portfolio);
  }

  // ── HANDMATIG SLUITEN ─────────────────────────────────────

  async function manualClose(tradeId) {
    const settings   = Storage.getSettings();
    const openTrades = Storage.getOpenTrades();
    const idx        = openTrades.findIndex(t => t.id === tradeId);
    if (idx === -1) return false;

    const trade    = openTrades[idx];
    const portfolio= Storage.getPortfolio();
    const solPrice = await TokenFetcher.getSolPrice();

    await _closeTrade(trade, trade.currentPrice, 'CLOSED_PROFIT', portfolio, solPrice);

    openTrades.splice(idx, 1);
    Storage.saveOpenTrades(openTrades);
    Storage.savePortfolio(portfolio);

    Storage.addLog('info',
      `HANDMATIG GESLOTEN: ${trade.tokenSymbol} @ $${_fmtPrice(trade.currentPrice)} (${trade.pnlPercent.toFixed(1)}%)`,
      { tokenSymbol: trade.tokenSymbol }
    );
    return true;
  }

  // ── INTERN: sluit trade af ────────────────────────────────

  async function _closeTrade(trade, exitPrice, status, portfolio, solPrice) {
    trade.exitTime    = Date.now();
    trade.exitPrice   = exitPrice;
    trade.status      = status;

    const fraction   = trade.isPartiallyExited ? 0.5 : 1.0;
    const remaining  = trade.tokenAmount * fraction;
    const exitUsd    = remaining * exitPrice;
    const exitSol    = exitUsd / solPrice;
    const entryUsd   = remaining * trade.entryPrice;
    const entrySol   = entryUsd / solPrice;

    trade.pnlSol     = exitSol - entrySol;
    trade.pnlUsd     = exitUsd - entryUsd;
    trade.pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;

    portfolio.currentBalance += exitSol;

    if (trade.pnlSol > 0) {
      portfolio.winningTrades++;
      portfolio.bestTrade = Math.max(portfolio.bestTrade, trade.pnlPercent);
    } else {
      portfolio.losingTrades++;
      portfolio.worstTrade = Math.min(portfolio.worstTrade, trade.pnlPercent);
    }

    portfolio.totalPnlSol     = portfolio.currentBalance - portfolio.startingBalance;
    portfolio.totalPnlPercent = (portfolio.totalPnlSol / portfolio.startingBalance) * 100;
    portfolio.winRate         = portfolio.totalTrades > 0
      ? (portfolio.winningTrades / portfolio.totalTrades) * 100
      : 0;

    Storage.addClosedTrade({ ...trade });
  }

  function _fmtPrice(p) {
    if (p < 0.000001) return p.toExponential(2);
    if (p < 0.001) return p.toFixed(7);
    if (p < 1)     return p.toFixed(5);
    return p.toFixed(4);
  }

  return { openPaperTrade, checkPositions, manualClose };

})();
