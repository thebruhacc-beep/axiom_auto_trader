/* ============================================================
   UI.JS - Alle DOM rendering, inclusief fee-weergave
   ============================================================ */
'use strict';

const UI = (() => {

  // ── TOAST ─────────────────────────────────────────────────
  function toast(msg, type = 'info', ms = 4500) {
    const c  = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className   = `toast toast--${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ── KPI UPDATE ────────────────────────────────────────────
  function updateKPIs(portfolio, status) {
    const bal = portfolio.currentBalance || 0;
    const pnl = portfolio.totalPnlPercent || 0;

    _txt('kpi-balance', bal.toFixed(5) + ' SOL');
    _txt('kpi-balance-usd', `≈ $${(bal * 170).toFixed(2)}`);

    const pnlEl = _el('kpi-pnl');
    if (pnlEl) {
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '%';
      pnlEl.className   = 'kpi-value ' + (pnl >= 0 ? 'kpi-value--green' : 'kpi-value--red');
    }

    const pnlSol = portfolio.totalPnlSol || 0;
    const feesSol = portfolio.totalFeesPaid || 0;
    _txt('kpi-pnl-sol',
      (pnlSol >= 0 ? '+' : '') + pnlSol.toFixed(5) + ' SOL' +
      (feesSol > 0 ? ` | fees: ${feesSol.toFixed(5)}` : '')
    );

    _txt('kpi-winrate',      (portfolio.winRate || 0).toFixed(0) + '%');
    _txt('kpi-trades-count', (portfolio.totalTrades || 0) + ' trades');

    const open = Storage.getOpenTrades().length;
    _txt('kpi-open',    open);
    _txt('kpi-scanned', (status?.scannedCount || 0) + ' gescand');
  }

  // ── SCANNER STATUS ────────────────────────────────────────
  function updateScannerStatus(isRunning) {
    const dot = _el('scan-pulse');
    const txt = _el('scan-status-text');
    const btn = _el('btn-toggle-scanner');
    if (dot) dot.className = 'pulse-dot' + (isRunning ? ' pulse-dot--active' : '');
    if (txt) txt.textContent = isRunning ? '🟢 Scanner actief' : '⚫ Gestopt';
    if (btn) {
      btn.textContent = isRunning ? '⏹ Stop Scanner' : '▶ Start Scanner';
      btn.className   = 'btn btn--primary' + (isRunning ? ' btn--stop' : '');
    }
  }

  // ── WALLET UI ─────────────────────────────────────────────
  function updateWalletUI(wallet) {
    const dot   = _el('wallet-dot');
    const label = _el('wallet-label');
    const btn   = _el('btn-connect-wallet');
    if (wallet?.isConnected && wallet.publicKey) {
      const s = wallet.publicKey.slice(0,6) + '…' + wallet.publicKey.slice(-4);
      if (dot)   dot.className   = 'wallet-dot wallet-dot--on';
      if (label) label.textContent = `${s} | ${(wallet.balance||0).toFixed(4)} SOL`;
      if (btn)  { btn.textContent = '🔌 Verbreek'; btn.classList.add('btn--connected'); }
    } else {
      if (dot)   dot.className   = 'wallet-dot wallet-dot--off';
      if (label) label.textContent = 'Niet verbonden';
      if (btn)  { btn.textContent = '👻 Verbind Phantom'; btn.classList.remove('btn--connected'); }
    }
  }

  function updateModeUI(mode) {
    _el('btn-paper')?.classList.toggle('mode-btn--active', mode === 'paper');
    _el('btn-live')?.classList.toggle('mode-btn--active',  mode === 'live');
  }

  // ── LOG FEED ──────────────────────────────────────────────
  function renderLog(containerId, limit = 80) {
    const el = _el(containerId);
    if (!el) return;
    const logs = Storage.getLogs(limit);
    if (!logs.length) { el.innerHTML = '<div class="log-entry log--info"><span class="log-time">--:--:--</span><span>Geen logs</span></div>'; return; }
    el.innerHTML = logs.map(l => {
      const t = new Date(l.timestamp).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      return `<div class="log-entry log--${l.level}"><span class="log-time">${t}</span><span>${_esc(l.message)}</span></div>`;
    }).join('');
  }

  // ── SIGNAL FEED (compact dashboard) ──────────────────────
  function renderSignalFeed(containerId, signals) {
    const el = _el(containerId);
    if (!el) return;
    const list = (signals || []).filter(s => s.action !== 'SKIP').slice(0, 15);
    if (!list.length) { el.innerHTML = '<div class="empty">Geen signalen gevonden door filters</div>'; return; }
    el.innerHTML = list.map(s => {
      const sc  = s.scoreResult?.total || 0;
      const act = (s.action || 'SKIP').toLowerCase();
      const sc_class = sc >= 65 ? 'score-h' : sc >= 48 ? 'score-m' : 'score-l';
      return `<div class="sig-row sig-row--${act}" data-url="${_esc(s.tokenData?.dexscreenerUrl||'#')}">
        <span class="sig-sym">${_esc(s.tokenData?.symbol||'?')}</span>
        <span class="sig-score ${sc_class}">${sc}</span>
        <span class="sig-meta">MC: ${_usd(s.tokenData?.marketCap)} | Liq: ${_usd(s.tokenData?.liquidity)}</span>
        <span class="sig-age">${_ago(s.timestamp)}</span>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-url]').forEach(r =>
      r.addEventListener('click', () => window.open(r.dataset.url,'_blank'))
    );
  }

  // ── SCANNER TABLE ─────────────────────────────────────────
  function renderScannerTable(tokens, signals, search, sortBy, filterAction) {
    const tbody = _el('scanner-tbody');
    if (!tbody) return;

    const sigMap = {};
    (signals||[]).forEach(s => { if (s.tokenData) sigMap[s.tokenData.address] = s; });

    let rows = tokens
      .map(t => ({ token: t, signal: sigMap[t.address] }))
      .filter(r => r.signal);

    if (search)                rows = rows.filter(r => r.token.symbol.toLowerCase().includes(search.toLowerCase()));
    if (filterAction !== 'all') rows = rows.filter(r => r.signal.action === filterAction);

    rows.sort((a,b) => {
      if (sortBy === 'score')     return (b.signal.scoreResult?.total||0) - (a.signal.scoreResult?.total||0);
      if (sortBy === 'volume')    return b.token.volume24h - a.token.volume24h;
      if (sortBy === 'age')       return a.token.ageMinutes - b.token.ageMinutes;
      if (sortBy === 'liquidity') return b.token.liquidity - a.token.liquidity;
      return 0;
    });

    _txt('scanner-total-badge', rows.length + ' tokens');

    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="10" class="empty">Geen tokens — start de scanner</td></tr>'; return; }

    tbody.innerHTML = rows.slice(0, 100).map(({ token: t, signal: s }) => {
      const sc     = s.scoreResult?.total || 0;
      const act    = s.action || 'SKIP';
      const tagCls = act==='BUY'?'tag--buy':act==='WATCH'?'tag--watch':act==='DANGER'?'tag--danger':'tag--skip';
      const chg    = t.priceChange1h || 0;
      const chgCls = chg >= 0 ? 'kpi-value--green' : 'kpi-value--red';
      const scCol  = sc >= 65 ? 'var(--green)' : sc >= 48 ? 'var(--yellow)' : 'var(--text3)';
      return `<tr>
        <td><a href="${_esc(t.dexscreenerUrl)}" target="_blank" style="text-decoration:none">
          <span class="token-sym">${_esc(t.symbol)}</span>
          <span class="token-name">${_esc((t.name||'').slice(0,22))}</span>
        </a></td>
        <td style="font-weight:800;color:${scCol}">${sc}</td>
        <td>${_usd(t.marketCap)}</td>
        <td>${_usd(t.liquidity)}${t.isLiquidityLocked?' 🔒':''}</td>
        <td>${_usd(t.volume24h)}</td>
        <td>${t.holderCount||'?'}</td>
        <td style="color:${t.largestHolderPercent>25?'var(--red)':'var(--text)'}">${(t.largestHolderPercent||0).toFixed(1)}%</td>
        <td style="color:${t.buySellRatio>=1.5?'var(--green)':'var(--text2)'}">${(t.buySellRatio||0).toFixed(2)}</td>
        <td class="${chgCls}">${chg>=0?'+':''}${chg.toFixed(1)}%</td>
        <td><span class="tag ${tagCls}">${act}</span></td>
      </tr>`;
    }).join('');
  }

  // ── SIGNAL CARDS ──────────────────────────────────────────
  function renderSignalCards(signals, filterAction, onlySafe) {
    const el = _el('signal-cards');
    if (!el) return;
    let list = [...(signals||[])];
    if (filterAction !== 'all') list = list.filter(s => s.action === filterAction);
    if (onlySafe)               list = list.filter(s => s.safetyAnalysis?.isSafe);
    if (!list.length) { el.innerHTML = '<div class="empty">Geen signalen gevonden</div>'; return; }

    el.innerHTML = list.slice(0,50).map(s => {
      const t   = s.tokenData || {};
      const sc  = s.scoreResult?.total || 0;
      const act = (s.action||'SKIP').toLowerCase();
      const flags = (s.safetyAnalysis?.flags||[]).slice(0,3)
        .map(f => `<span class="sc-flag">${f.type.replace(/_/g,' ')}</span>`).join('');
      const be = s.scoreResult?.breakdown || [];
      const top2 = be.filter(b=>b.points>0).sort((a,b)=>b.points-a.points).slice(0,2).map(b=>b.category).join(', ');
      return `<div class="signal-card signal-card--${act}" data-url="${_esc(t.dexscreenerUrl||'#')}">
        <div class="sc-header">
          <div>
            <div class="sc-sym">${_esc(t.symbol||'?')}</div>
            <div style="font-size:11px;color:var(--text2)">${_esc((t.name||'').slice(0,26))}</div>
            <div style="font-size:10px;color:var(--text3);margin-top:2px">${_ago(s.timestamp)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:22px;font-weight:900;color:${sc>=65?'var(--green)':sc>=48?'var(--yellow)':'var(--text3)'};">${sc}</div>
            <span class="tag tag--${act}" style="font-size:9px">${s.action}</span>
          </div>
        </div>
        <div class="sc-stats">
          <div><div class="sc-stat-label">Market Cap</div><div class="sc-stat-val">${_usd(t.marketCap)}</div></div>
          <div><div class="sc-stat-label">Liquiditeit</div><div class="sc-stat-val">${_usd(t.liquidity)}</div></div>
          <div><div class="sc-stat-label">Volume 24u</div><div class="sc-stat-val">${_usd(t.volume24h)}</div></div>
          <div><div class="sc-stat-label">Buy/Sell</div><div class="sc-stat-val" style="color:${(t.buySellRatio||0)>=1.5?'var(--green)':'var(--text)'}">${(t.buySellRatio||0).toFixed(2)}</div></div>
          <div><div class="sc-stat-label">Top Holder</div><div class="sc-stat-val" style="color:${(t.largestHolderPercent||0)>25?'var(--red)':'var(--text)'}">${(t.largestHolderPercent||0).toFixed(1)}%</div></div>
          <div><div class="sc-stat-label">Δ 1u</div><div class="sc-stat-val" style="color:${(t.priceChange1h||0)>=0?'var(--green)':'var(--red)'}">${(t.priceChange1h||0)>=0?'+':''}${(t.priceChange1h||0).toFixed(1)}%</div></div>
        </div>
        ${top2 ? `<div style="font-size:10px;color:var(--text3);margin:4px 0">↑ ${_esc(top2)}</div>` : ''}
        ${flags ? `<div class="sc-flags">${flags}</div>` : ''}
      </div>`;
    }).join('');
    el.querySelectorAll('[data-url]').forEach(c =>
      c.addEventListener('click', () => window.open(c.dataset.url,'_blank'))
    );
  }

  // ── OPEN POSITIES ─────────────────────────────────────────
  function renderOpenPositions(onClose) {
    const grid = _el('open-positions-grid');
    if (!grid) return;
    const trades = Storage.getOpenTrades();
    _txt('pos-open-count', trades.length);
    if (!trades.length) { grid.innerHTML = '<div class="empty">Geen open posities — scanner zoekt...</div>'; return; }

    grid.innerHTML = trades.map(t => {
      const pnlCls  = (t.pnlPercent||0) >= 0 ? 'pos-pnl--pos' : 'pos-pnl--neg';
      const sign    = (t.pnlPercent||0) >= 0 ? '+' : '';
      const feeInfo = t.feeInfo || {};
      const bePct   = (feeInfo.breakEvenPct || 6).toFixed(1);
      // Progress bar: van SL tot TP2
      const range   = (t.takeProfitPrice2||0) - (t.stopLossPrice||0);
      const cur     = (t.currentPrice||0)     - (t.stopLossPrice||0);
      const prog    = range > 0 ? Math.max(0, Math.min(100, (cur/range)*100)) : 50;
      const barCol  = (t.pnlPercent||0) >= 0 ? 'var(--green2)' : 'var(--red)';
      const holdMin = Math.round((Date.now() - (t.entryTime||Date.now())) / 60000);

      return `<div class="pos-card">
        <div class="pos-header">
          <div>
            <span class="pos-sym">${_esc(t.tokenSymbol||'?')}</span>
            <span style="font-size:10px;color:var(--text3);margin-left:6px">${t.isPaper?'📄 Paper':'🔴 Live'}</span>
          </div>
          <div style="text-align:right">
            <span class="pos-pnl ${pnlCls}">${sign}${(t.pnlPercent||0).toFixed(1)}%</span>
            <div style="font-size:10px;color:var(--text3)">netto: ${sign}${(t.pnlPercentAfterFees||0).toFixed(1)}%</div>
          </div>
        </div>
        <div class="pos-row">
          <span>${(t.amountSol||0)} SOL</span>
          <span>Instap: $${_p(t.entryPrice)}</span>
          <span>Nu: $${_p(t.currentPrice)}</span>
          <span style="color:var(--text3)">${holdMin}m geleden</span>
        </div>
        <div class="pos-row" style="color:var(--text3);font-size:10px">
          <span>Break-even: +${bePct}%</span>
          <span>Fees betaald: ~$${((feeInfo.totalEstimatedFeeSOL||0)*170).toFixed(3)}</span>
          ${t.isPartiallyExited ? '<span style="color:var(--yellow)">⚡ 50% verkocht @ TP1</span>' : ''}
        </div>
        <div class="pos-levels">
          <div class="pos-level pos-level--sl">
            <div class="pos-level-lbl">Stop Loss (-${_s().stopLossPercent}%)</div>
            <div class="pos-level-val">$${_p(t.stopLossPrice)}</div>
          </div>
          <div class="pos-level pos-level--tp1">
            <div class="pos-level-lbl">TP1 50% (+${_s().takeProfit1Percent}%)</div>
            <div class="pos-level-val">$${_p(t.takeProfitPrice1)}</div>
          </div>
          <div class="pos-level pos-level--tp2">
            <div class="pos-level-lbl">TP2 rest (+${_s().takeProfit2Percent}%)</div>
            <div class="pos-level-val">$${_p(t.takeProfitPrice2)}</div>
          </div>
        </div>
        <div class="pos-bar"><div class="pos-bar-fill" style="width:${prog}%;background:${barCol}"></div></div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
          <button class="btn btn--danger btn-close-pos" data-id="${t.id}">Sluit positie</button>
          <a href="${_esc(t.dexUrl||'#')}" target="_blank" style="font-size:11px;color:var(--purple)">DEX ↗</a>
          <span style="font-size:10px;color:var(--text3)">Score: ${t.scoreAtEntry||'?'}</span>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.btn-close-pos').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Positie nu sluiten?')) return;
        btn.disabled = true; btn.textContent = '...';
        await onClose(btn.dataset.id);
      });
    });
  }

  // ── TRADE GESCHIEDENIS ────────────────────────────────────
  function renderTradeHistory() {
    const tbody = _el('history-tbody');
    if (!tbody) return;
    const trades = Storage.getClosedTrades(100);
    _txt('pos-closed-count', trades.length);
    if (!trades.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty">Nog geen gesloten trades</td></tr>'; return; }
    tbody.innerHTML = trades.map(t => {
      const pnlCls = (t.pnlPercent||0) >= 0 ? 'kpi-value--green' : 'kpi-value--red';
      const sign   = (t.pnlPercent||0) >= 0 ? '+' : '';
      const icon   = t.status==='CLOSED_STOPLOSS'?'🛑':t.status==='CLOSED_TIMEOUT'?'⏰':(t.pnlPercent||0)>=0?'✅':'❌';
      const dur    = t.exitTime ? Math.round((t.exitTime - (t.entryTime||0)) / 60000) + 'm' : '—';
      const feeUSD = ((t.feeInfo?.totalEstimatedFeeSOL||0) * 170).toFixed(3);
      return `<tr>
        <td><span class="token-sym">${_esc(t.tokenSymbol||'?')}</span></td>
        <td>${t.isPaper?'<span style="color:var(--yellow)">Paper</span>':'<span style="color:var(--green)">Live</span>'}</td>
        <td style="font-family:var(--mono)">$${_p(t.entryPrice)}</td>
        <td style="font-family:var(--mono)">$${_p(t.exitPrice)}</td>
        <td class="${pnlCls}" style="font-weight:800;font-family:var(--mono)">${sign}${(t.pnlPercent||0).toFixed(1)}%</td>
        <td class="${pnlCls}" style="font-family:var(--mono)">${sign}${(t.pnlSol||0).toFixed(5)}</td>
        <td style="font-size:10px;color:var(--text3)">-$${feeUSD}</td>
        <td>${icon} ${(t.status||'').replace('CLOSED_','')}</td>
        <td style="color:var(--text3);font-size:11px">${dur}</td>
      </tr>`;
    }).join('');
  }

  // ── BACKTEST RESULTATEN ───────────────────────────────────
  function renderBacktestResults(result) {
    _el('bt-results-placeholder').style.display = 'none';
    _el('bt-results').style.display = 'block';
    const m = result.metrics;
    const s = n => n >= 0 ? '+' : '';
    _txt('bt-r-return',  s(m.totalReturn)  + m.totalReturn.toFixed(2)  + '%');
    _txt('bt-r-wr',      m.winRate.toFixed(1) + '%');
    _txt('bt-r-sharpe',  m.sharpeRatio.toFixed(2));
    _txt('bt-r-dd',      '-' + m.maxDrawdown.toFixed(2) + '%');
    _txt('bt-r-pf',      m.profitFactor.toFixed(2));
    _txt('bt-r-trades',  result.trades.length + '');
    _txt('bt-r-avgwin',  '+' + m.avgWin.toFixed(2)  + '%');
    _txt('bt-r-avgloss', m.avgLoss.toFixed(2) + '%');
    const re = _el('bt-r-return');
    if (re) re.style.color = m.totalReturn >= 0 ? 'var(--green)' : 'var(--red)';
    _drawEquity(result.equityCurve, result.portfolio.startingBalance);
  }

  function _drawEquity(curve, startBal) {
    const canvas = _el('equity-chart');
    if (!canvas || !curve?.length) return;
    const W = canvas.parentElement?.clientWidth || 400;
    const H = 130;
    canvas.width = W; canvas.height = H;
    const ctx  = canvas.getContext('2d');
    const vals = curve.map(p => p.value);
    const min  = Math.min(...vals);
    const max  = Math.max(...vals);
    const rng  = max - min || 1;
    ctx.clearRect(0,0,W,H);

    // Grid lijnen
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i/4) * H;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }

    // Kleur groen als eindbalans > start, anders rood
    const endVal  = vals[vals.length - 1];
    const lineCol = endVal >= startBal ? 'rgba(20,241,149,0.9)' : 'rgba(255,68,85,0.9)';
    const fillCol = endVal >= startBal ? 'rgba(20,241,149,0.12)' : 'rgba(255,68,85,0.12)';

    ctx.beginPath();
    curve.forEach((p,i) => {
      const x = (i/(curve.length-1)) * W;
      const y = H - ((p.value - min) / rng) * (H-12) - 6;
      i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.strokeStyle = lineCol; ctx.lineWidth = 2; ctx.stroke();
    ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
    ctx.fillStyle = fillCol; ctx.fill();

    // Start lijn
    const startY = H - ((startBal - min) / rng) * (H-12) - 6;
    ctx.setLineDash([4,4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,startY); ctx.lineTo(W,startY); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── INSTELLINGEN LADEN/LEZEN ──────────────────────────────
  function loadSettingsIntoForm() {
    const s = Storage.getSettings();
    _val('s-capital',        s.startingCapital);
    _val('s-amount',         s.tradeAmount);
    _val('s-max-pos',        s.maxOpenPositions);
    _val('s-interval',       s.scanIntervalSeconds);
    _val('s-sl',             s.stopLossPercent);
    _val('s-tp1',            s.takeProfit1Percent);
    _val('s-tp2',            s.takeProfit2Percent);
    _val('s-min-score',      s.minScore);
    _val('s-min-liq',        s.minLiquidityUsd);
    _val('s-min-holders',    s.minHolders);
    _val('s-max-holder-pct', s.maxTopHolderPercent);
    _val('s-min-vol',        s.minVolume24h);
    _val('s-min-age',        s.minAgeMinutes);
    _val('s-max-age',        s.maxAgeMinutes);
    _val('s-helius',         s.heliusApiKey);
    _val('s-birdeye',        s.birdeyeApiKey);

    // Fee info tonen
    const fees = Storage.getFees();
    const feeEl = _el('fee-info-box');
    if (feeEl) {
      const tp1 = s.takeProfit1Percent;
      const sl  = s.stopLossPercent;
      const be  = ((fees.axiomFeePct + fees.slippagePct) * 2 * 100).toFixed(1);
      feeEl.innerHTML =
        `<strong>Fee berekening bij ${s.tradeAmount} SOL trade:</strong><br>` +
        `• Axiom fee (koop): ~${(fees.axiomFeePct*100).toFixed(0)}%<br>` +
        `• Slippage (koop): ~${(fees.slippagePct*100).toFixed(0)}%<br>` +
        `• Axiom fee (verkoop): ~${(fees.axiomFeePct*100).toFixed(0)}%<br>` +
        `• Slippage (verkoop): ~${(fees.slippagePct*100).toFixed(0)}%<br>` +
        `• Netwerk fees: ~$0.002<br>` +
        `<strong>• Break-even punt: +${be}%</strong><br>` +
        `<strong>• TP1 (+${tp1}%) netto: ~+${(tp1 - parseFloat(be)).toFixed(1)}%</strong><br>` +
        `<strong>• SL (-${sl}%) netto: ~-${(sl + parseFloat(be)).toFixed(1)}%</strong>`;
    }
  }

  function readSettingsFromForm() {
    const cur = Storage.getSettings();
    return Object.assign(cur, {
      startingCapital:      _num('s-capital'),
      tradeAmount:          _num('s-amount'),
      maxOpenPositions:     _num('s-max-pos'),
      scanIntervalSeconds:  _num('s-interval'),
      stopLossPercent:      _num('s-sl'),
      takeProfit1Percent:   _num('s-tp1'),
      takeProfit2Percent:   _num('s-tp2'),
      minScore:             _num('s-min-score'),
      minLiquidityUsd:      _num('s-min-liq'),
      minHolders:           _num('s-min-holders'),
      maxTopHolderPercent:  _num('s-max-holder-pct'),
      minVolume24h:         _num('s-min-vol'),
      minAgeMinutes:        _num('s-min-age'),
      maxAgeMinutes:        _num('s-max-age'),
      heliusApiKey:         _str('s-helius'),
      birdeyeApiKey:        _str('s-birdeye'),
    });
  }

  // ── HELPERS ───────────────────────────────────────────────
  function _el(id)      { return document.getElementById(id); }
  function _txt(id, v)  { const e = _el(id); if (e) e.textContent = v; }
  function _val(id, v)  { const e = _el(id); if (e) e.value = v; }
  function _num(id)     { return parseFloat(_el(id)?.value||'0') || 0; }
  function _str(id)     { return (_el(id)?.value||'').trim(); }
  function _s()         { return Storage.getSettings(); }
  function _esc(s)      { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _usd(n)      { n=n||0; if(n>=1e6)return '$'+(n/1e6).toFixed(1)+'M'; if(n>=1e3)return '$'+(n/1e3).toFixed(0)+'K'; return '$'+n.toFixed(0); }
  function _p(p)        { p=p||0; if(p<1e-8)return '0'; if(p<0.000001)return p.toExponential(3); if(p<0.001)return p.toFixed(8); if(p<1)return p.toFixed(6); return p.toFixed(4); }
  function _ago(ts)     { const s=Math.floor((Date.now()-(ts||0))/1000); if(s<60)return s+'s'; if(s<3600)return Math.floor(s/60)+'m'; return Math.floor(s/3600)+'u'; }

  return {
    toast, updateKPIs, updateScannerStatus, updateWalletUI, updateModeUI,
    renderLog, renderSignalFeed, renderScannerTable, renderSignalCards,
    renderOpenPositions, renderTradeHistory, renderBacktestResults,
    loadSettingsIntoForm, readSettingsFromForm,
  };
})();
