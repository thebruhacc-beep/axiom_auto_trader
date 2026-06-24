/* ============================================================
   UI.JS - Alle DOM rendering functies
   ============================================================ */

'use strict';

const UI = (() => {

  // ── TOAST NOTIFICATIES ────────────────────────────────────

  function toast(msg, type = 'info', duration = 4000) {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  // ── KPI KAARTEN ───────────────────────────────────────────

  function updateKPIs(portfolio, status) {
    const sol = portfolio.currentBalance;
    const pnl = portfolio.totalPnlPercent || 0;

    _setText('kpi-balance', sol.toFixed(4) + ' SOL');
    _setText('kpi-balance-usd', '');

    const pnlEl = document.getElementById('kpi-pnl');
    if (pnlEl) {
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '%';
      pnlEl.className = 'kpi-value ' + (pnl >= 0 ? 'kpi-value--green' : 'kpi-value--red');
    }

    const pnlSolEl = document.getElementById('kpi-pnl-sol');
    if (pnlSolEl) {
      const pnlSol = portfolio.totalPnlSol || 0;
      pnlSolEl.textContent = (pnlSol >= 0 ? '+' : '') + pnlSol.toFixed(4) + ' SOL';
    }

    _setText('kpi-winrate', (portfolio.winRate || 0).toFixed(0) + '%');
    _setText('kpi-trades-count', (portfolio.totalTrades || 0) + ' trades');

    const open = Storage.getOpenTrades();
    _setText('kpi-open', open.length);
    if (status) _setText('kpi-scanned', status.scannedCount + ' gescand');
  }

  // ── SCANNER STATUS ────────────────────────────────────────

  function updateScannerStatus(isRunning) {
    const dot   = document.getElementById('scan-pulse');
    const txt   = document.getElementById('scan-status-text');
    const btn   = document.getElementById('btn-toggle-scanner');

    if (dot) dot.className = 'pulse-dot' + (isRunning ? ' pulse-dot--active' : '');
    if (txt) txt.textContent = isRunning ? 'Scanner actief' : 'Gestopt';
    if (btn) {
      btn.textContent = isRunning ? '⏹ Stop Scanner' : '▶ Start Scanner';
      btn.className   = 'btn btn--primary' + (isRunning ? ' btn--stop' : '');
    }
  }

  // ── WALLET UI ─────────────────────────────────────────────

  function updateWalletUI(wallet) {
    const dot   = document.getElementById('wallet-dot');
    const label = document.getElementById('wallet-label');
    const btn   = document.getElementById('btn-connect-wallet');

    if (wallet.isConnected && wallet.publicKey) {
      const short = wallet.publicKey.slice(0,6) + '...' + wallet.publicKey.slice(-4);
      if (dot)   dot.className   = 'wallet-dot wallet-dot--on';
      if (label) label.textContent = short;
      if (btn) {
        btn.textContent = '🔌 Verbreek';
        btn.classList.add('btn--connected');
      }
    } else {
      if (dot)   dot.className   = 'wallet-dot wallet-dot--off';
      if (label) label.textContent = 'Niet verbonden';
      if (btn) {
        btn.textContent = '👻 Verbind Phantom';
        btn.classList.remove('btn--connected');
      }
    }
  }

  // ── MODE TOGGLE ───────────────────────────────────────────

  function updateModeUI(mode) {
    document.getElementById('btn-paper').classList.toggle('mode-btn--active', mode === 'paper');
    document.getElementById('btn-live').classList.toggle('mode-btn--active', mode === 'live');
  }

  // ── LOG FEED ──────────────────────────────────────────────

  function renderLog(containerId, limit = 80) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const logs = Storage.getLogs(limit);
    if (!logs.length) { el.innerHTML = '<div class="log-entry log--info"><span class="log-time">--:--:--</span><span>Geen logs</span></div>'; return; }

    el.innerHTML = logs.map(l => {
      const t = new Date(l.timestamp).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `<div class="log-entry log--${l.level}"><span class="log-time">${t}</span><span>${_esc(l.message)}</span></div>`;
    }).join('');
  }

  // ── SIGNAL FEED (compact) ─────────────────────────────────

  function renderSignalFeed(containerId, signals) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!signals.length) { el.innerHTML = '<div class="empty">Geen signalen...</div>'; return; }

    el.innerHTML = signals.slice(0,20).map(s => {
      const sc    = s.scoreResult.total;
      const sClass= sc >= 70 ? 'score-h' : sc >= 50 ? 'score-m' : 'score-l';
      const act   = s.action.toLowerCase();
      const mc    = _fmtUsd(s.tokenData.marketCap);
      const liq   = _fmtUsd(s.tokenData.liquidity);
      const age   = _ago(s.timestamp);

      return `<div class="sig-row sig-row--${act}" data-url="${_esc(s.tokenData.dexscreenerUrl)}" style="cursor:pointer">
        <span class="sig-sym">${_esc(s.tokenData.symbol)}</span>
        <span class="sig-score ${sClass}">${sc}</span>
        <span class="sig-meta">MC: ${mc} | Liq: ${liq}</span>
        <span class="sig-age">${age}</span>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-url]').forEach(el => {
      el.addEventListener('click', () => window.open(el.dataset.url, '_blank'));
    });
  }

  // ── SCANNER TABLE ─────────────────────────────────────────

  function renderScannerTable(tokens, signals, search, sortBy, filterAction) {
    const tbody = document.getElementById('scanner-tbody');
    if (!tbody) return;

    // Map signals per adres
    const sigMap = {};
    signals.forEach(s => { sigMap[s.tokenData.address] = s; });

    let rows = tokens.map(t => ({ token: t, signal: sigMap[t.address] })).filter(r => r.signal);

    // Filter
    if (search) rows = rows.filter(r => r.token.symbol.toLowerCase().includes(search.toLowerCase()));
    if (filterAction !== 'all') rows = rows.filter(r => r.signal.action === filterAction);

    // Sort
    rows.sort((a, b) => {
      if (sortBy === 'score')     return b.signal.scoreResult.total - a.signal.scoreResult.total;
      if (sortBy === 'volume')    return b.token.volume24h - a.token.volume24h;
      if (sortBy === 'age')       return a.token.ageMinutes - b.token.ageMinutes;
      if (sortBy === 'liquidity') return b.token.liquidity - a.token.liquidity;
      return 0;
    });

    _setText('scanner-total-badge', rows.length + ' tokens');

    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="10" class="empty">Geen tokens gevonden...</td></tr>'; return; }

    tbody.innerHTML = rows.slice(0, 100).map(({ token: t, signal: s }) => {
      const sc  = s.scoreResult.total;
      const act = s.action;
      const tagCls = act === 'BUY' ? 'tag--buy' : act === 'WATCH' ? 'tag--watch' : act === 'DANGER' ? 'tag--danger' : 'tag--skip';
      const chg = t.priceChange1h || 0;
      const chgCls = chg >= 0 ? 'kpi-value--green' : 'kpi-value--red';

      return `<tr>
        <td>
          <a href="${_esc(t.dexscreenerUrl)}" target="_blank" style="text-decoration:none">
            <span class="token-sym">${_esc(t.symbol)}</span>
            <span class="token-name">${_esc(t.name.slice(0,20))}</span>
          </a>
        </td>
        <td style="font-weight:800;color:${sc>=70?'var(--green)':sc>=50?'var(--yellow)':'var(--text3)'}">${sc}</td>
        <td>${_fmtUsd(t.marketCap)}</td>
        <td>${_fmtUsd(t.liquidity)}${t.isLiquidityLocked ? ' 🔒' : ''}</td>
        <td>${_fmtUsd(t.volume24h)}</td>
        <td>${t.holderCount || '?'}</td>
        <td style="color:${t.largestHolderPercent>20?'var(--red)':'var(--text)'}">${t.largestHolderPercent.toFixed(1)}%</td>
        <td style="color:${t.buySellRatio>=1.2?'var(--green)':'var(--text2)'}">${t.buySellRatio.toFixed(2)}</td>
        <td class="${chgCls}">${chg>=0?'+':''}${chg.toFixed(1)}%</td>
        <td><span class="tag ${tagCls}">${act}</span></td>
      </tr>`;
    }).join('');
  }

  // ── SIGNAL CARDS ──────────────────────────────────────────

  function renderSignalCards(signals, filterAction, onlySafe) {
    const el = document.getElementById('signal-cards');
    if (!el) return;

    let list = [...signals];
    if (filterAction !== 'all') list = list.filter(s => s.action === filterAction);
    if (onlySafe) list = list.filter(s => s.safetyAnalysis.isSafe);

    if (!list.length) { el.innerHTML = '<div class="empty">Geen signalen gevonden...</div>'; return; }

    el.innerHTML = list.slice(0, 50).map(s => {
      const t   = s.tokenData;
      const sc  = s.scoreResult.total;
      const pct = Math.round(sc / 100 * 360);
      const act = s.action.toLowerCase();
      const flags = s.safetyAnalysis.flags.slice(0,3).map(f =>
        `<span class="sc-flag">${f.type.replace(/_/g,' ')}</span>`
      ).join('');

      return `<div class="signal-card signal-card--${act}" data-url="${_esc(t.dexscreenerUrl)}">
        <div class="sc-header">
          <div>
            <div class="sc-sym">${_esc(t.symbol)}</div>
            <div style="font-size:11px;color:var(--text2)">${_esc(t.name.slice(0,24))}</div>
          </div>
          <div class="sc-score-ring" style="--pct:${pct}deg">
            <span>${sc}</span>
          </div>
        </div>
        <div class="sc-stats">
          <div><div class="sc-stat-label">Market Cap</div><div class="sc-stat-val">${_fmtUsd(t.marketCap)}</div></div>
          <div><div class="sc-stat-label">Liquiditeit</div><div class="sc-stat-val">${_fmtUsd(t.liquidity)}</div></div>
          <div><div class="sc-stat-label">Volume 24u</div><div class="sc-stat-val">${_fmtUsd(t.volume24h)}</div></div>
          <div><div class="sc-stat-label">Buy/Sell</div><div class="sc-stat-val">${t.buySellRatio.toFixed(2)}</div></div>
          <div><div class="sc-stat-label">Top Holder</div><div class="sc-stat-val" style="color:${t.largestHolderPercent>20?'var(--red)':'var(--text)'}">${t.largestHolderPercent.toFixed(1)}%</div></div>
          <div><div class="sc-stat-label">Prijs Δ 1u</div><div class="sc-stat-val" style="color:${t.priceChange1h>=0?'var(--green)':'var(--red)'}">${t.priceChange1h>=0?'+':''}${t.priceChange1h.toFixed(1)}%</div></div>
        </div>
        ${flags ? `<div class="sc-flags">${flags}</div>` : ''}
        <div class="sc-footer">
          <span class="tag tag--${act}">${s.action}</span>
          <span style="font-size:11px;color:var(--text3)">${_ago(s.timestamp)}</span>
        </div>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-url]').forEach(card => {
      card.addEventListener('click', () => window.open(card.dataset.url, '_blank'));
    });
  }

  // ── OPEN POSITIES ─────────────────────────────────────────

  function renderOpenPositions(onClose) {
    const grid = document.getElementById('open-positions-grid');
    if (!grid) return;

    const trades = Storage.getOpenTrades();
    _setText('pos-open-count', trades.length);

    if (!trades.length) { grid.innerHTML = '<div class="empty">Geen open posities</div>'; return; }

    grid.innerHTML = trades.map(t => {
      const pnlCls = t.pnlPercent >= 0 ? 'pos-pnl--pos' : 'pos-pnl--neg';
      const sign   = t.pnlPercent >= 0 ? '+' : '';
      const progress = Math.max(0, Math.min(100,
        t.isPartiallyExited ? 55 :
        ((t.currentPrice - t.stopLossPrice) / (t.takeProfitPrice2 - t.stopLossPrice)) * 100
      ));
      const barColor = t.pnlPercent >= 0 ? 'var(--green2)' : 'var(--red)';

      return `<div class="pos-card">
        <div class="pos-header">
          <span class="pos-sym">${_esc(t.tokenSymbol)}</span>
          <span class="pos-pnl ${pnlCls}">${sign}${t.pnlPercent.toFixed(1)}%</span>
        </div>
        <div class="pos-row">
          <span>${t.amountSol} SOL</span>
          <span>Instap: $${_fmtPrice(t.entryPrice)}</span>
          <span>Nu: $${_fmtPrice(t.currentPrice)}</span>
          ${t.isPartiallyExited ? '<span style="color:var(--yellow)">⚡ TP1 geraakt</span>' : ''}
        </div>
        <div class="pos-levels">
          <div class="pos-level pos-level--sl">
            <div class="pos-level-lbl">Stop Loss</div>
            <div class="pos-level-val">$${_fmtPrice(t.stopLossPrice)}</div>
          </div>
          <div class="pos-level pos-level--tp1">
            <div class="pos-level-lbl">TP 1 (50%)</div>
            <div class="pos-level-val">$${_fmtPrice(t.takeProfitPrice1)}</div>
          </div>
          <div class="pos-level pos-level--tp2">
            <div class="pos-level-lbl">TP 2</div>
            <div class="pos-level-val">$${_fmtPrice(t.takeProfitPrice2)}</div>
          </div>
        </div>
        <div class="pos-bar"><div class="pos-bar-fill" style="width:${progress}%;background:${barColor}"></div></div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn--danger btn-close-pos" data-id="${t.id}">Sluit positie</button>
          <a href="${_esc(t.dexUrl || '#')}" target="_blank" style="font-size:11px;color:var(--text3)">DEX ↗</a>
          <span style="font-size:10px;color:var(--text3)">${t.isPaper ? 'Paper' : 'Live'} | Score: ${t.scoreAtEntry || '?'}</span>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.btn-close-pos').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Positie ${btn.dataset.id.slice(-8)} sluiten?`)) return;
        btn.disabled = true;
        await onClose(btn.dataset.id);
      });
    });
  }

  // ── TRADE GESCHIEDENIS ────────────────────────────────────

  function renderTradeHistory() {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;

    const trades = Storage.getClosedTrades(100);
    _setText('pos-closed-count', trades.length);

    if (!trades.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">Nog geen gesloten trades...</td></tr>'; return; }

    tbody.innerHTML = trades.map(t => {
      const pnlCls = t.pnlPercent >= 0 ? 'kpi-value--green' : 'kpi-value--red';
      const sign   = t.pnlPercent >= 0 ? '+' : '';
      const statusIcon = t.status === 'CLOSED_STOPLOSS' ? '🛑' : t.pnlPercent >= 0 ? '✅' : '❌';
      const dur    = t.exitTime ? Math.round((t.exitTime - t.entryTime) / 60000) + 'm' : '—';

      return `<tr>
        <td><span class="token-sym">${_esc(t.tokenSymbol)}</span></td>
        <td>${t.isPaper ? '<span style="color:var(--yellow)">Paper</span>' : '<span style="color:var(--green)">Live</span>'}</td>
        <td style="font-family:var(--mono)">$${_fmtPrice(t.entryPrice)}</td>
        <td style="font-family:var(--mono)">$${_fmtPrice(t.exitPrice || 0)}</td>
        <td class="${pnlCls}" style="font-weight:800;font-family:var(--mono)">${sign}${t.pnlPercent.toFixed(1)}%</td>
        <td class="${pnlCls}" style="font-family:var(--mono)">${sign}${(t.pnlSol || 0).toFixed(4)} SOL</td>
        <td>${statusIcon} ${t.status.replace('CLOSED_','')}</td>
        <td style="color:var(--text3);font-size:11px">${dur}</td>
      </tr>`;
    }).join('');
  }

  // ── BACKTEST RESULTATEN ───────────────────────────────────

  function renderBacktestResults(result) {
    document.getElementById('bt-results-placeholder').style.display = 'none';
    document.getElementById('bt-results').style.display = 'block';

    const m    = result.metrics;
    const sign = n => n >= 0 ? '+' : '';

    _setText('bt-r-return',  sign(m.totalReturn)  + m.totalReturn.toFixed(2)  + '%');
    _setText('bt-r-wr',      m.winRate.toFixed(1)  + '%');
    _setText('bt-r-sharpe',  m.sharpeRatio.toFixed(2));
    _setText('bt-r-dd',      '-' + m.maxDrawdown.toFixed(2) + '%');
    _setText('bt-r-pf',      m.profitFactor.toFixed(2));
    _setText('bt-r-trades',  result.trades.length.toString());
    _setText('bt-r-avgwin',  '+' + m.avgWin.toFixed(2)  + '%');
    _setText('bt-r-avgloss', m.avgLoss.toFixed(2) + '%');

    // Kleur return
    const retEl = document.getElementById('bt-r-return');
    if (retEl) retEl.style.color = m.totalReturn >= 0 ? 'var(--green)' : 'var(--red)';

    // Equity curve
    _drawEquityCurve(result.equityCurve);
  }

  function _drawEquityCurve(curve) {
    const canvas = document.getElementById('equity-chart');
    if (!canvas || !curve.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth || 400;
    const H = 120;
    canvas.width  = W;
    canvas.height = H;

    const vals = curve.map(p => p.value);
    const min  = Math.min(...vals);
    const max  = Math.max(...vals);
    const range= max - min || 1;

    ctx.clearRect(0, 0, W, H);

    // Gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(20,241,149,0.3)');
    grad.addColorStop(1, 'rgba(20,241,149,0)');

    ctx.beginPath();
    curve.forEach((p, i) => {
      const x = (i / (curve.length - 1)) * W;
      const y = H - ((p.value - min) / range) * (H - 10) - 5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(20,241,149,0.9)';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Fill
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ── INSTELLINGEN LADEN/OPSLAAN ────────────────────────────

  function loadSettingsIntoForm() {
    const s = Storage.getSettings();
    _setVal('s-capital',       s.startingCapital);
    _setVal('s-amount',        s.tradeAmount);
    _setVal('s-max-pos',       s.maxOpenPositions);
    _setVal('s-interval',      s.scanIntervalSeconds);
    _setVal('s-sl',            s.stopLossPercent);
    _setVal('s-tp1',           s.takeProfit1Percent);
    _setVal('s-tp2',           s.takeProfit2Percent);
    _setVal('s-min-score',     s.minScore);
    _setVal('s-min-liq',       s.minLiquidityUsd);
    _setVal('s-min-holders',   s.minHolders);
    _setVal('s-max-holder-pct',s.maxTopHolderPercent);
    _setVal('s-min-vol',       s.minVolume24h);
    _setVal('s-min-age',       s.minAgeMinutes);
    _setVal('s-max-age',       s.maxAgeMinutes);
    _setVal('s-helius',        s.heliusApiKey);
    _setVal('s-birdeye',       s.birdeyeApiKey);
  }

  function readSettingsFromForm() {
    const cur = Storage.getSettings();
    return Object.assign(cur, {
      startingCapital:     _numVal('s-capital'),
      tradeAmount:         _numVal('s-amount'),
      maxOpenPositions:    _numVal('s-max-pos'),
      scanIntervalSeconds: _numVal('s-interval'),
      stopLossPercent:     _numVal('s-sl'),
      takeProfit1Percent:  _numVal('s-tp1'),
      takeProfit2Percent:  _numVal('s-tp2'),
      minScore:            _numVal('s-min-score'),
      minLiquidityUsd:     _numVal('s-min-liq'),
      minHolders:          _numVal('s-min-holders'),
      maxTopHolderPercent: _numVal('s-max-holder-pct'),
      minVolume24h:        _numVal('s-min-vol'),
      minAgeMinutes:       _numVal('s-min-age'),
      maxAgeMinutes:       _numVal('s-max-age'),
      heliusApiKey:        _strVal('s-helius'),
      birdeyeApiKey:       _strVal('s-birdeye'),
    });
  }

  // ── HELPERS ───────────────────────────────────────────────

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function _numVal(id) {
    const el = document.getElementById(id);
    return parseFloat(el?.value) || 0;
  }

  function _strVal(id) {
    const el = document.getElementById(id);
    return el?.value?.trim() || '';
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _fmtUsd(n) {
    if (n >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(0) + 'K';
    return '$' + (n||0).toFixed(0);
  }

  function _fmtPrice(p) {
    p = p || 0;
    if (p < 1e-6)  return p.toExponential(2);
    if (p < 0.001) return p.toFixed(7);
    if (p < 1)     return p.toFixed(5);
    return p.toFixed(4);
  }

  function _ago(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)   return s + 's';
    if (s < 3600) return Math.floor(s/60) + 'm';
    return Math.floor(s/3600) + 'u';
  }

  return {
    toast, updateKPIs, updateScannerStatus, updateWalletUI, updateModeUI,
    renderLog, renderSignalFeed, renderScannerTable,
    renderSignalCards, renderOpenPositions, renderTradeHistory,
    renderBacktestResults, loadSettingsIntoForm, readSettingsFromForm,
  };

})();
