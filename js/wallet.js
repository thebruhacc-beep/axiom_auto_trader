/* ============================================================
   WALLET.JS - Phantom wallet integratie
   - Verbindt met Phantom
   - Saldo via eigen /api/rpc proxy (geen CORS)
   - Live trades via Jupiter
   ============================================================ */
'use strict';

const Wallet = (() => {

  let _publicKey = null;
  let _connected = false;

  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  function _getProvider() {
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom) return window.solana;
    return null;
  }

  function isPhantomInstalled() { return !!_getProvider(); }
  function isConnected()        { return _connected; }
  function getPublicKey()       { return _publicKey; }

  // ── VERBINDEN ─────────────────────────────────────────────
  async function connect() {
    const provider = _getProvider();
    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      throw new Error('Phantom niet gevonden. Installeer Phantom en herlaad.');
    }

    const resp = await provider.connect();
    _publicKey = resp.publicKey.toString();
    _connected = true;

    const balance = await getBalance();
    Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance });

    provider.on('accountChanged', pk => {
      if (pk) { _publicKey = pk.toString(); }
      else    { _connected = false; _publicKey = null; }
      if (typeof App !== 'undefined') App.onWalletChange();
    });
    provider.on('disconnect', () => {
      _connected = false; _publicKey = null;
      Storage.saveWallet({ isConnected: false, publicKey: null, balance: null });
      if (typeof App !== 'undefined') App.onWalletChange();
    });

    Storage.addLog('success', '👻 Phantom verbonden: ' + _s(_publicKey) + ' | ' + balance.toFixed(4) + ' SOL');
    return { publicKey: _publicKey, balance };
  }

  // Handmatig adres (read-only monitoring)
  async function connectByAddress(address) {
    address = address.trim();
    if (!address || address.length < 32) throw new Error('Ongeldig adres');
    _publicKey = address;
    _connected = true;
    const balance = await getBalance();
    Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance, readOnly: true });
    Storage.addLog('success', '📋 Adres ingesteld: ' + _s(_publicKey) + ' | ' + balance.toFixed(4) + ' SOL');
    return { publicKey: _publicKey, balance };
  }

  async function disconnect() {
    try { _getProvider()?.disconnect(); } catch(e) {}
    _publicKey = null;
    _connected = false;
    Storage.saveWallet({ isConnected: false, publicKey: null, balance: null });
    Storage.addLog('info', '🔌 Wallet verbroken');
  }

  async function tryAutoConnect() {
    const stored = Storage.getWallet();
    if (!stored?.isConnected || !stored?.publicKey) return null;

    // Read-only adres herstellen
    if (stored.readOnly) {
      _publicKey = stored.publicKey;
      _connected = true;
      const balance = await getBalance();
      Storage.saveWallet({ ...stored, balance });
      return { publicKey: _publicKey, balance };
    }

    // Phantom eager reconnect
    const provider = _getProvider();
    if (!provider) return null;
    try {
      const resp = await provider.connect({ onlyIfTrusted: true });
      _publicKey = resp.publicKey.toString();
      _connected = true;
      const balance = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance });
      Storage.addLog('info', '🔄 Hersteld: ' + _s(_publicKey) + ' | ' + balance.toFixed(4) + ' SOL');
      return { publicKey: _publicKey, balance };
    } catch(e) { return null; }
  }

  // ── SALDO VIA EIGEN PROXY ─────────────────────────────────
  async function getBalance() {
    if (!_publicKey) return 0;
    try {
      const r = await fetch('/api/rpc', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ address: _publicKey }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (typeof d.sol === 'number') return d.sol;
      Storage.addLog('warning', '⚠️ Saldo fout: ' + (d.error || 'onbekend'));
    } catch(e) {
      Storage.addLog('warning', '⚠️ Saldo proxy fout: ' + e.message);
    }
    const stored = Storage.getWallet();
    return stored?.balance ?? 0;
  }

  // ── PHANTOM SIGNING ───────────────────────────────────────
  async function _signAndSend(base64Tx) {
    const provider = _getProvider();
    if (!provider) throw new Error('Phantom niet gevonden');

    // Methode 1: Buffer approach
    try {
      const bytes  = Uint8Array.from(atob(base64Tx), c => c.charCodeAt(0));
      const result = await provider.signAndSendTransaction({
        serialize: () => bytes,
        signatures: [],
      });
      return result?.signature ?? result;
    } catch(e1) {
      // Methode 2: request API
      try {
        const result = await provider.request({
          method: 'signAndSendTransaction',
          params: { transaction: base64Tx },
        });
        return result?.signature ?? result;
      } catch(e2) {
        throw new Error('Signing mislukt: ' + e2.message);
      }
    }
  }

  // ── KOPEN VIA JUPITER PROXY ───────────────────────────────
  async function executeSwap(tokenMint, amountSol, slippageBps) {
    if (!_connected) throw new Error('Wallet niet verbonden');

    const stored = Storage.getWallet();
    if (stored.readOnly) {
      throw new Error('Read-only adres — verbind Phantom voor live trades');
    }

    slippageBps = slippageBps || 100;
    const lamports = Math.floor(amountSol * 1e9);

    Storage.addLog('info', '🔄 Quote ophalen: ' + amountSol + ' SOL → ' + tokenMint.slice(0,8) + '...');

    // Quote via proxy
    // Jupiter heeft CORS headers — direct aanroepen vanuit browser
    const quoteParams = new URLSearchParams({
      inputMint:        SOL_MINT,
      outputMint:       tokenMint,
      amount:           lamports.toString(),
      slippageBps:      slippageBps.toString(),
      onlyDirectRoutes: 'false',
    });
    const qr = await fetch('https://quote-api.jup.ag/v6/quote?' + quoteParams, {
      headers: { 'Accept': 'application/json' },
    });
    if (!qr.ok) {
      const errText = await qr.text().catch(() => '');
      throw new Error('Quote fout ' + qr.status + ': ' + errText.slice(0,100));
    }
    const quote = await qr.json();
    if (quote.error) throw new Error('Jupiter quote: ' + (quote.error.msg || quote.error));

    const outAmount   = parseInt(quote.outAmount || '0');
    const priceImpact = parseFloat(quote.priceImpactPct || '0');
    Storage.addLog('info', '📊 Quote OK | Impact: ' + priceImpact.toFixed(2) + '%');
    if (priceImpact > 5) Storage.addLog('warning', '⚠️ Hoge impact: ' + priceImpact.toFixed(1) + '%');

    // Swap transactie via proxy
    const sr = await fetch('https://quote-api.jup.ag/v6/swap', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        quoteResponse:             quote,
        userPublicKey:             _publicKey,
        wrapAndUnwrapSol:          true,
        dynamicComputeUnitLimit:   true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    if (!sr.ok) {
      const errText = await sr.text().catch(() => '');
      throw new Error('Swap fout ' + sr.status + ': ' + errText.slice(0,100));
    }
    const swapData = await sr.json();
    if (swapData.error) throw new Error('Swap: ' + (swapData.error.msg || swapData.error));

    Storage.addLog('info', '✍️ Phantom opent voor bevestiging...');
    const signature = await _signAndSend(swapData.swapTransaction);
    const sig = String(signature?.signature ?? signature);

    Storage.addLog('success', '✅ GEKOCHT! ' + sig.slice(0,16) + '... | solscan.io/tx/' + sig);

    // Refresh balance na 4 sec
    setTimeout(async () => {
      const b = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: b });
      if (typeof App !== 'undefined') App.onWalletChange();
    }, 4000);

    return { signature: sig, outAmount };
  }

  // ── VERKOPEN VIA JUPITER PROXY ────────────────────────────
  async function executeSell(tokenMint, tokenAmount, decimals, slippageBps) {
    if (!_connected) throw new Error('Wallet niet verbonden');
    const stored = Storage.getWallet();
    if (stored.readOnly) throw new Error('Read-only adres — verbind Phantom');

    decimals    = decimals    || 6;
    slippageBps = slippageBps || 150;
    const rawAmount = Math.floor(tokenAmount * Math.pow(10, decimals));

    const sellParams = new URLSearchParams({
      inputMint:   tokenMint,
      outputMint:  SOL_MINT,
      amount:      rawAmount.toString(),
      slippageBps: slippageBps.toString(),
    });
    const qr = await fetch('https://quote-api.jup.ag/v6/quote?' + sellParams, {
      headers: { 'Accept': 'application/json' },
    });
    if (!qr.ok) throw new Error('Sell quote fout: ' + qr.status);
    const quote = await qr.json();
    if (quote.error) throw new Error('Sell Jupiter: ' + (quote.error.msg || quote.error));

    const outSOL = parseInt(quote.outAmount || '0') / 1e9;
    Storage.addLog('info', '📊 Sell: → ' + outSOL.toFixed(5) + ' SOL');

    const sr = await fetch('https://quote-api.jup.ag/v6/swap', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        quoteResponse:             quote,
        userPublicKey:             _publicKey,
        wrapAndUnwrapSol:          true,
        dynamicComputeUnitLimit:   true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    if (!sr.ok) throw new Error('Sell swap fout: ' + sr.status);
    const swapData = await sr.json();
    if (swapData.error) throw new Error('Sell swap: ' + (swapData.error.msg || swapData.error));

    const signature = await _signAndSend(swapData.swapTransaction);
    const sig = String(signature?.signature ?? signature);

    Storage.addLog('success', '✅ VERKOCHT! ' + outSOL.toFixed(5) + ' SOL | ' + sig.slice(0,16) + '...');

    setTimeout(async () => {
      const b = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: b });
      if (typeof App !== 'undefined') App.onWalletChange();
    }, 4000);

    return { signature: sig, outSOL };
  }

  function _s(pk) { return pk ? pk.slice(0,6) + '...' + pk.slice(-4) : ''; }

  return {
    isPhantomInstalled, isConnected, getPublicKey,
    connect, connectByAddress, disconnect, tryAutoConnect,
    getBalance, executeSwap, executeSell,
  };
})();
