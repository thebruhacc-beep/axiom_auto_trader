/* ============================================================
   BACKTESTENGINE.JS - Simulatie MET fee berekening
   Fees zijn ingebakken in elke gesimuleerde trade
   ============================================================ */
'use strict';

const BacktestEngine = (() => {

  function run(config) {
    const settings = Object.assign({}, Storage.getDefaultSettings(), {
      minScore:             config.minScore    || 65,
      stopLossPercent:      config.sl          || 20,
      takeProfit1Percent:   config.tp1         || 60,
      takeProfit2Percent:   config.tp2         || 200,
      tradeAmount:          config.tradeAmount  || 0.002,
      maxOpenPositions:     3,
      minLiquidityUsd:      5000,
      minHolders:           30,
      maxTopHolderPercent:  25,
    });

    const fees = Storage.getFees();
    const SOL  = 170; // vaste prijs voor simulatie

    const portfolio = {
      startingBalance: config.capital,
      currentBalance:  config.capital,
      totalTrades:     0,
      winningTrades:   0,
      losingTrades:    0,
      bestTrade:       0,
      worstTrade:      0,
      totalFeesPaid:   0,
    };

    const trades        = [];
    const openPositions = [];
    const equityCurve   = [{ time: config.startDate, value: config.capital }];

    const data = _generateData(config);

    for (const point of data) {
      const { token, prices, time } = point;

      const safety = SafetyAnalyzer.analyze(token, settings);
      const score  = ScoreCalculator.calculate(token, safety);

      // ── Open positie ────────────────────────────────────
      if (
        score.total >= settings.minScore &&
        safety.isSafe &&
        openPositions.length < settings.maxOpenPositions &&
        portfolio.currentBalance >= settings.tradeAmount
      ) {
        // Al open in dit token?
        if (!openPositions.find(p => p.symbol === token.symbol)) {
          const entry      = token.priceUsd;
          const buyFee     = settings.tradeAmount * (fees.axiomFeePct + fees.slippagePct) + fees.networkFeeSOL;
          const effectiveEntry = entry * (1 + fees.slippagePct); // instapprijs na slippage
          const tokenAmt   = (settings.tradeAmount * SOL) / effectiveEntry;

          portfolio.currentBalance -= (settings.tradeAmount + buyFee);
          portfolio.totalFeesPaid  += buyFee;
          portfolio.totalTrades++;

          openPositions.push({
            id:        trades.length,
            symbol:    token.symbol,
            entry,
            effectiveEntry,
            amountSol: settings.tradeAmount,
            tokenAmt,
            buyFee,
            entryTime: time,
            isPartial: false,
            sl:        entry * (1 - settings.stopLossPercent   / 100),
            tp1:       entry * (1 + settings.takeProfit1Percent / 100),
            tp2:       entry * (1 + settings.takeProfit2Percent / 100),
            prices,
            score:     score.total,
          });
        }
      }

      // ── Controleer open posities ─────────────────────────
      for (let i = openPositions.length - 1; i >= 0; i--) {
        const pos   = openPositions[i];
        const price = _priceAt(pos.prices, time) || pos.entry;

        // Stop loss
        if (price <= pos.sl) {
          _close(pos, price, 'CLOSED_STOPLOSS', portfolio, fees, SOL, trades);
          openPositions.splice(i, 1);
          continue;
        }

        // TP1 — verkoop 50%
        if (price >= pos.tp1 && !pos.isPartial) {
          pos.isPartial = true;
          const halfSOL    = pos.amountSol * 0.5;
          const sellFee    = halfSOL * (fees.axiomFeePct + fees.slippagePct) + fees.networkFeeSOL;
          const grossRet   = halfSOL * (1 + (price - pos.entry) / pos.entry);
          portfolio.currentBalance += grossRet - sellFee;
          portfolio.totalFeesPaid  += sellFee;
        }

        // TP2 — verkoop rest
        if (price >= pos.tp2 && pos.isPartial) {
          _close(pos, price, 'CLOSED_PROFIT', portfolio, fees, SOL, trades, true);
          openPositions.splice(i, 1);
          continue;
        }

        // Timeout: 6 uur zonder resultaat
        const holdMin = (time - pos.entryTime) / 60000;
        if (holdMin > 360 && !pos.isPartial && price < pos.tp1) {
          _close(pos, price, 'CLOSED_TIMEOUT', portfolio, fees, SOL, trades);
          openPositions.splice(i, 1);
        }
      }

      equityCurve.push({ time, value: Math.max(0, portfolio.currentBalance) });
    }

    // Sluit resterende posities
    for (const pos of openPositions) {
      const last = pos.prices[pos.prices.length - 1]?.price || pos.entry;
      _close(pos, last, last >= pos.entry ? 'CLOSED_PROFIT' : 'CLOSED_LOSS', portfolio, fees, SOL, trades);
    }

    portfolio.totalPnlSol     = portfolio.currentBalance - portfolio.startingBalance;
    portfolio.totalPnlPercent = (portfolio.totalPnlSol / portfolio.startingBalance) * 100;
    portfolio.winRate         = portfolio.totalTrades > 0
      ? (portfolio.winningTrades / portfolio.totalTrades) * 100 : 0;

    return {
      portfolio,
      trades,
      equityCurve,
      metrics: _metrics(trades, portfolio, config),
    };
  }

  // ── SLUIT POSITIE AF ──────────────────────────────────────

  function _close(pos, exitPrice, status, portfolio, fees, SOL, trades, isRemainder = false) {
    const fraction   = isRemainder ? 0.5 : (pos.isPartial ? 0.5 : 1.0);
    const sellAmtSOL = pos.amountSol * fraction;
    const sellFee    = sellAmtSOL * (fees.axiomFeePct + fees.slippagePct) + fees.networkFeeSOL;
    const pricePct   = (exitPrice - pos.entry) / pos.entry;
    const grossRet   = sellAmtSOL * (1 + pricePct);
    const netRet     = grossRet - sellFee;

    portfolio.currentBalance += netRet;
    portfolio.totalFeesPaid  += sellFee;

    const pnlSOL = netRet - sellAmtSOL;
    if (pnlSOL > 0) {
      portfolio.winningTrades++;
      portfolio.bestTrade = Math.max(portfolio.bestTrade, pricePct * 100);
    } else {
      portfolio.losingTrades++;
      portfolio.worstTrade = Math.min(portfolio.worstTrade, pricePct * 100);
    }

    // Netto % na fees
    const totalFeeRt = (fees.axiomFeePct + fees.slippagePct) * 2;
    const netPct     = pricePct * 100 - totalFeeRt * 100;

    trades.push({
      symbol:     pos.symbol,
      entryPrice: pos.entry,
      exitPrice,
      pnlSol:     pnlSOL,
      pnlPercent: pricePct * 100,
      pnlPercentAfterFees: netPct,
      status,
      entryTime:  pos.entryTime,
      score:      pos.score,
      feeSOL:     pos.buyFee + sellFee,
    });
  }

  // ── METRICS ───────────────────────────────────────────────

  function _metrics(trades, portfolio, config) {
    if (!trades.length) return { totalReturn:0,sharpeRatio:0,maxDrawdown:0,winRate:0,profitFactor:0,avgWin:0,avgLoss:0,avgHoldTime:0,totalFeesPaid:portfolio.totalFeesPaid };

    const winners = trades.filter(t => t.pnlSol > 0);
    const losers  = trades.filter(t => t.pnlSol <= 0);
    const gProfit = winners.reduce((s,t) => s + t.pnlSol, 0);
    const gLoss   = Math.abs(losers.reduce((s,t) => s + t.pnlSol, 0));
    const avgWin  = winners.length ? winners.reduce((s,t) => s + t.pnlPercentAfterFees, 0) / winners.length : 0;
    const avgLoss = losers.length  ? losers.reduce((s,t)  => s + t.pnlPercentAfterFees, 0) / losers.length  : 0;

    // Sharpe
    const rets  = trades.map(t => t.pnlPercentAfterFees);
    const mean  = rets.reduce((a,b) => a+b, 0) / rets.length;
    const std   = Math.sqrt(rets.reduce((s,r) => s+(r-mean)**2, 0) / rets.length) || 1;
    const sharpe= (mean / std) * Math.sqrt(252);

    // Max drawdown
    let peak = config.capital, maxDD = 0, bal = config.capital;
    for (const t of trades) {
      bal += t.pnlSol;
      if (bal > peak) peak = bal;
      const dd = ((peak - bal) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      totalReturn:   portfolio.totalPnlPercent,
      sharpeRatio:   +sharpe.toFixed(2),
      maxDrawdown:   +maxDD.toFixed(2),
      winRate:       portfolio.winRate,
      profitFactor:  gLoss > 0 ? +(gProfit/gLoss).toFixed(2) : gProfit > 0 ? 99 : 0,
      avgWin:        +avgWin.toFixed(2),
      avgLoss:       +avgLoss.toFixed(2),
      avgHoldTime:   0,
      totalFeesPaid: portfolio.totalFeesPaid,
    };
  }

  // ── GESIMULEERDE DATA ─────────────────────────────────────
  // Realistische memecoin patronen:
  // 40% pump & dump, 30% langzame stijging, 30% rugpull

  function _generateData(config) {
    const data     = [];
    const interval = 20 * 60 * 1000; // 20 min intervals
    const tokens   = 10;

    for (let t = config.startDate; t < config.endDate; t += interval) {
      for (let i = 0; i < tokens; i++) {
        const seed      = i * 1000 + Math.floor(t / 1e9);
        const pattern   = seed % 10; // 0-9 → verschillende patronen
        const basePrice = 0.000001 * (1 + (seed % 50) * 0.2);

        // Genereer realistisch prijsverloop
        const priceHistory = _genPrices(basePrice, t, interval, pattern);

        // Token karakteristieken gebaseerd op patroon
        const isGood = pattern < 4; // 40% kans op goed token

        data.push({
          time: t,
          token: {
            address:              `TOKEN${i}_${Math.floor(t/1e9)}`.padEnd(44,'x'),
            symbol:               `MEM${i}`,
            name:                 `Memecoin ${i}`,
            marketCap:            5000   + (seed % 100) * 30000,
            liquidity:            6000   + (seed % 50)  * 10000,
            volume24h:            3000   + (seed % 80)  * 20000,
            priceUsd:             basePrice,
            priceChange5m:        isGood ? 5  + (seed%20) : -(5 + (seed%15)),
            priceChange1h:        isGood ? 20 + (seed%60) : -(10 + (seed%30)),
            priceChange24h:       isGood ? 50 + (seed%100): -(20 + (seed%50)),
            holderCount:          40     + (seed % 200),
            topHolderPercent:     isGood ? 15 + (seed%20) : 35 + (seed%30),
            largestHolderPercent: isGood ? 5  + (seed%15) : 20 + (seed%20),
            buyCount24h:          100    + (seed % 500),
            sellCount24h:         isGood ? 40 + (seed%100): 120 + (seed%200),
            buySellRatio:         isGood ? 2  + (seed%30)/10 : 0.5 + (seed%5)/10,
            ageMinutes:           10     + (seed % 200),
            txPerMinute:          2      + (seed % 12),
            isLiquidityLocked:    seed % 3 === 0,
            rugCheckScore:        isGood ? 50 + (seed%50) : 20 + (seed%30),
          },
          prices: priceHistory,
        });
      }
    }
    return data.sort((a,b) => a.time - b.time);
  }

  function _genPrices(base, startTime, interval, pattern) {
    const prices = [];
    let p = base;
    const steps = 72; // 24 uur in 20-min stappen

    for (let i = 0; i < steps; i++) {
      // Patroon 0-3: pump → dump (klassieke memecoin)
      if (pattern < 4) {
        if (i < 12)      p *= 1.05 + Math.random() * 0.05;  // pump fase
        else if (i < 20) p *= 1.10 + Math.random() * 0.10;  // piek
        else if (i < 30) p *= 0.85 + Math.random() * 0.05;  // dump
        else             p *= 0.97 + Math.random() * 0.04;  // stabilisatie
      }
      // Patroon 4-6: langzame stijging
      else if (pattern < 7) {
        p *= 1.01 + (Math.random() - 0.3) * 0.04;
      }
      // Patroon 7-9: rug pull of gewoon verlies
      else {
        if (i < 5)  p *= 1.02 + Math.random() * 0.03;
        else        p *= 0.93 + Math.random() * 0.05;
      }

      prices.push({ time: startTime + i * interval, price: Math.max(p, 1e-12) });
    }
    return prices;
  }

  function _priceAt(history, time) {
    if (!history?.length) return 0;
    return history.reduce((best, p) =>
      Math.abs(p.time - time) < Math.abs(best.time - time) ? p : best
    , history[0]).price;
  }

  return { run };
})();
