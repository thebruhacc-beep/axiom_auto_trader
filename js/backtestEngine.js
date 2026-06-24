/* ============================================================
   BACKTESTENGINE.JS - Simuleer strategie op historische data
   ============================================================ */

'use strict';

const BacktestEngine = (() => {

  function run(config) {
    const settings = Object.assign({}, Storage.getDefaultSettings(), {
      minScore:           config.minScore   || 70,
      stopLossPercent:    config.sl         || 15,
      takeProfit1Percent: config.tp1        || 30,
      takeProfit2Percent: config.tp2        || 80,
      tradeAmount:        config.tradeAmount|| 0.01,
      maxOpenPositions:   5,
    });

    const portfolio = {
      startingBalance: config.capital,
      currentBalance:  config.capital,
      totalTrades:     0,
      winningTrades:   0,
      losingTrades:    0,
      bestTrade:       0,
      worstTrade:      0,
    };

    const trades        = [];
    const openPositions = [];
    const equityCurve   = [{ time: config.startDate, value: config.capital }];
    const SOL_PRICE     = 150; // Vaste prijs voor simulatie

    const data = _generateData(config);

    for (const point of data) {
      const { token, prices } = point;

      const safety = SafetyAnalyzer.analyze(token, settings);
      const score  = ScoreCalculator.calculate(token, safety);

      // Open positie als score hoog genoeg en veilig
      if (
        score.total >= settings.minScore &&
        safety.isSafe &&
        openPositions.length < settings.maxOpenPositions &&
        portfolio.currentBalance >= settings.tradeAmount
      ) {
        const entry = token.priceUsd;
        portfolio.currentBalance -= settings.tradeAmount;
        portfolio.totalTrades++;

        openPositions.push({
          id:              trades.length,
          symbol:          token.symbol,
          entryPrice:      entry,
          amountSol:       settings.tradeAmount,
          tokenAmount:     (settings.tradeAmount * SOL_PRICE) / entry,
          entryTime:       point.time,
          status:          'OPEN',
          isPartiallyExited: false,
          stopLoss:        entry * (1 - settings.stopLossPercent   / 100),
          tp1:             entry * (1 + settings.takeProfit1Percent / 100),
          tp2:             entry * (1 + settings.takeProfit2Percent / 100),
          priceHistory:    prices,
          scoreAtEntry:    score.total,
        });
      }

      // Controleer open posities op exit condities
      for (let i = openPositions.length - 1; i >= 0; i--) {
        const pos   = openPositions[i];
        const price = _getPriceAt(pos.priceHistory, point.time) || pos.entryPrice;

        // Stop loss
        if (price <= pos.stopLoss) {
          _closePosition(pos, price, 'CLOSED_STOPLOSS', portfolio, SOL_PRICE, trades);
          openPositions.splice(i, 1);
          continue;
        }

        // TP1
        if (price >= pos.tp1 && !pos.isPartiallyExited) {
          pos.isPartiallyExited = true;
          const returnedSol     = (pos.amountSol * 0.5) * (1 + settings.takeProfit1Percent / 100);
          portfolio.currentBalance += returnedSol;
        }

        // TP2
        if (price >= pos.tp2 && pos.isPartiallyExited) {
          _closePosition(pos, price, 'CLOSED_PROFIT', portfolio, SOL_PRICE, trades);
          openPositions.splice(i, 1);
        }
      }

      equityCurve.push({ time: point.time, value: portfolio.currentBalance });
    }

    // Sluit resterende posities
    for (const pos of openPositions) {
      const lastPrice = pos.priceHistory[pos.priceHistory.length - 1]?.price || pos.entryPrice;
      _closePosition(pos, lastPrice, lastPrice >= pos.entryPrice ? 'CLOSED_PROFIT' : 'CLOSED_LOSS', portfolio, SOL_PRICE, trades);
    }

    portfolio.totalPnlSol     = portfolio.currentBalance - portfolio.startingBalance;
    portfolio.totalPnlPercent = (portfolio.totalPnlSol / portfolio.startingBalance) * 100;
    portfolio.winRate         = portfolio.totalTrades > 0 ? (portfolio.winningTrades / portfolio.totalTrades) * 100 : 0;

    const metrics = _metrics(trades, portfolio, config);
    return { portfolio, trades, equityCurve, metrics };
  }

  // ── INTERN ────────────────────────────────────────────────

  function _closePosition(pos, exitPrice, status, portfolio, solPrice, trades) {
    const fraction = pos.isPartiallyExited ? 0.5 : 1.0;
    const exitUsd  = pos.tokenAmount * fraction * exitPrice;
    const exitSol  = exitUsd / solPrice;
    const entryUsd = pos.tokenAmount * fraction * pos.entryPrice;
    const entrySol = entryUsd / solPrice;
    const pnlSol   = exitSol - entrySol;
    const pnlPct   = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;

    portfolio.currentBalance += exitSol;

    if (pnlSol > 0) {
      portfolio.winningTrades++;
      portfolio.bestTrade = Math.max(portfolio.bestTrade, pnlPct);
    } else {
      portfolio.losingTrades++;
      portfolio.worstTrade = Math.min(portfolio.worstTrade, pnlPct);
    }

    trades.push({
      symbol:     pos.symbol,
      entryPrice: pos.entryPrice,
      exitPrice,
      pnlSol,
      pnlPercent: pnlPct,
      status,
      entryTime:  pos.entryTime,
      score:      pos.scoreAtEntry,
    });
  }

  function _getPriceAt(history, time) {
    const close = history.reduce((best, p) => {
      return Math.abs(p.time - time) < Math.abs(best.time - time) ? p : best;
    }, history[0] || { time: 0, price: 0 });
    return close.price;
  }

  function _metrics(trades, portfolio, config) {
    if (!trades.length) {
      return { totalReturn: 0, sharpeRatio: 0, maxDrawdown: 0, winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, avgHoldTime: 0 };
    }

    const winners = trades.filter(t => t.pnlSol > 0);
    const losers  = trades.filter(t => t.pnlSol <= 0);

    const grossProfit = winners.reduce((s, t) => s + t.pnlSol, 0);
    const grossLoss   = Math.abs(losers.reduce((s, t) => s + t.pnlSol, 0));

    const avgWin  = winners.length ? winners.reduce((s, t) => s + t.pnlPercent, 0) / winners.length : 0;
    const avgLoss = losers.length  ? losers.reduce((s, t)  => s + t.pnlPercent, 0) / losers.length  : 0;

    // Sharpe (vereenvoudigd)
    const rets   = trades.map(t => t.pnlPercent);
    const mean   = rets.reduce((a, b) => a + b, 0) / rets.length;
    const std    = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    // Max drawdown
    let peak = config.capital, maxDD = 0, balance = config.capital;
    for (const t of trades) {
      balance += t.pnlSol;
      if (balance > peak) peak = balance;
      const dd = ((peak - balance) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      totalReturn:  portfolio.totalPnlPercent,
      sharpeRatio:  +sharpe.toFixed(2),
      maxDrawdown:  +maxDD.toFixed(2),
      winRate:      portfolio.winRate,
      profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 999 : 0,
      avgWin:       +avgWin.toFixed(2),
      avgLoss:      +avgLoss.toFixed(2),
      avgHoldTime:  0,
    };
  }

  function _generateData(config) {
    const data     = [];
    const interval = 30 * 60 * 1000; // 30 min
    const tokens   = 8;

    for (let t = config.startDate; t < config.endDate; t += interval) {
      for (let i = 0; i < tokens; i++) {
        const basePrice = 0.000001 * (1 + Math.random() * 9);
        const trend     = Math.random() > 0.45 ? 1.015 : 0.985; // Licht bullish

        const priceHistory = [];
        let p = basePrice;
        for (let pt = t; pt < t + interval * 60; pt += interval) {
          p *= trend * (0.9 + Math.random() * 0.2);
          priceHistory.push({ time: pt, price: Math.max(p, 1e-10) });
        }

        data.push({
          time: t,
          token: {
            address:              `SIM${i}${Math.floor(t/1e6)}`.padEnd(44, '1'),
            symbol:               `SIM${i}`,
            name:                 `Simulated ${i}`,
            marketCap:            50000   + Math.random() * 500000,
            liquidity:            12000   + Math.random() * 200000,
            volume24h:            8000    + Math.random() * 300000,
            priceUsd:             basePrice,
            priceChange5m:        (Math.random() - 0.4) * 20,
            priceChange1h:        (Math.random() - 0.4) * 50,
            priceChange24h:       (Math.random() - 0.4) * 100,
            holderCount:          80 + Math.floor(Math.random() * 2000),
            topHolderPercent:     10 + Math.random() * 35,
            largestHolderPercent: 5  + Math.random() * 20,
            buyCount24h:          80  + Math.floor(Math.random() * 500),
            sellCount24h:         40  + Math.floor(Math.random() * 300),
            buySellRatio:         0.8 + Math.random() * 2.5,
            ageMinutes:           10  + Math.random() * 1440,
            txPerMinute:          1   + Math.random() * 15,
            isLiquidityLocked:    Math.random() > 0.4,
            rugCheckScore:        40  + Math.floor(Math.random() * 60),
          },
          prices: priceHistory,
        });
      }
    }

    return data.sort((a, b) => a.time - b.time);
  }

  return { run };

})();
