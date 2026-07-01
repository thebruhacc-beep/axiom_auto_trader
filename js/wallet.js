/* ============================================================
   WALLET.JS - Flexibele wallet integratie
   Ondersteunt:
   1. Phantom wallet (voor live trades)
   2. Handmatig adres invullen (voor saldo monitoring)
   3. Axiom embedded wallet (read-only via adres)
   
   PRIVATE KEYS WORDEN NOOIT OPGESLAGEN
   ============================================================ */
'use strict';

const Wallet = (() => {

  let _publicKey  = null;
  let _connected  = false;
  let _isPhantom  = false; // True als via Phantom, false als handmatig adres

  const SOL_MINT  = 'So11111111111111111111111111111111111111112';

  // ── PHANTOM PROVIDER ──────────────────────────────────────
  function _getProvider() {
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom)          return window.solana;
    return null;
  }

  function isPhantomInstalled() { return !!_getProvider(); }
  function isConnected()        { return _connected; }
  function isPhantomWallet()    { return _isPhantom; }
  function getPublicKey()       { return _publicKey; }

  // ── PHANTOM VERBINDEN ─────────────────────────────────────
  async function connect() {
    const provider = _getProvider();
    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      throw new Error('Phantom niet gevonden. Installeer Phantom en herlaad de pagina.');
    }
    const resp  = await provider.connect();
    _publicKey  = resp.publicKey.toString();
    _connected  = true;
    _isPhantom  = true;

    const balance = await getBalance(_publicKey);
    Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance, isPhantom: true });

    provider.on('accountChanged', pk => {
      if (pk) { _publicKey = pk.toString(); }
      else    { _doDisconnect(); }
      if (typeof App !== 'undefined') App.onWalletChange();
    });
    provider.on('disconnect', () => {
      _doDisconnect();
      if (typeof App !== 'undefined') App.onWalletChange();
    });

    Storage.addLog('success', '👻 Phantom verbonden: ' + _short(_publicKey) + ' | ' + balance.toFixed(4) + ' SOL');
    return { publicKey: _publicKey, balance };
  }

  // ── HANDMATIG ADRES INVULLEN (voor Axiom wallet) ──────────
  async function connectByAddress(address) {
    // Valideer Solana adres (base58, 32-44 tekens)
    if (!address || address.length < 32 || address.length > 44) {
      throw new Error('Ongeldig Solana wallet adres');
    }

    _publicKey = address.trim();
    _connected = true;
    _isPhantom = false;

    const balance = await getBalance(_publicKey);
    Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance, isPhantom: false });

    Storage.addLog('success', '🔍 Wallet adres ingesteld: ' + _short(_publicKey) + ' | ' + balance.toFixed(4) + ' SOL');
    return { publicKey: _publicKey, balance };
  }

  function _doDisconnect() {
    _publicKey = null;
    _connected = false;
    _isPhantom = false;
    Storage.saveWallet({ isConnected: false, publicKey: null, balance: null, isPhantom: false });
  }

  async function disconnect() {
    try { if (_isPhantom) _getProvider()?.disconnect(); } catch(e) {}
    _doDisconnect();
    Storage.addLog('info', '🔌 Wallet verbroken');
  }

  async function tryAutoConnect() {
    const stored = Storage.getWallet();
    if (!stored || !stored.isConnected || !stored.publicKey) return null;

    // Als het een handmatig adres was, herstel direct
    if (!stored.isPhantom) {
      _publicKey = stored.publicKey;
      _connected = true;
      _isPhantom = false;
      const balance = await getBalance(_publicKey);
      Storage.saveWallet({ ...stored, balance });
      Storage.addLog('info', '🔄 Wallet hersteld: ' + _short(_publicKey) + ' | ' + balance.toFixed(4) + ' SOL');
      return { publicKey: _publicKey, balance };
    }

    // Phantom eager connect
    const provider = _getProvider();
    if (!provider) return null;
    try {
      const resp  = await provider.connect({ onlyIfTrusted: true });
      _publicKey  = resp.publicKey.toString();
      _connected  = true;
      _isPhantom  = true;
      const balance = await getBalance(_publicKey);
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance, isPhantom: true });
      Storage.addLog('info', '🔄 Phantom hersteld: ' + _short(_publicKey) + ' | ' + balance.toFixed(4) + ' SOL');
      return { publicKey: _publicKey, balance };
    } catch(e) { return null; }
  }

  // ── SALDO OPHALEN ─────────────────────────────────────────
  // Gebruikt meerdere RPC endpoints — stopt bij eerste succes
  async function getBalance(pubkey) {
    const pk = pubkey || _publicKey;
    if (!pk) return 0;

    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method:  'getBalance',
      params:  [pk, { commitment: 'confirmed' }],
    });

    // Endpoints gesorteerd op betrouwbaarheid voor browser gebruik
    const endpoints = [
      'https://api.mainnet-beta.solana.com',
      'https://rpc.ankr.com/solana',
      'https://mainnet.helius-rpc.com/?api-key=15319d07-b4d3-4376-905b-3885f0bb1211',
      'https://solana-mainnet.rpc.extrnode.com',
    ];

    for (const url of endpoints) {
      try {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const r     = await fetch(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));

        if (!r.ok) continue;
        const d        = await r.json();
        if (d.error)   continue;

        // Sommige nodes geven result.value, andere geven result direct
        const val = d.result?.value ?? d.result;
        if (typeof val === 'number' && val >= 0) {
          return val / 1e9;
        }
      } catch(e) { /* probeer volgende */ }
    }

    // Geef laatste bekende waarde terug — geen error loggen
    const stored = Storage.getWallet();
    return stored?.balance ?? 0;
  }

  // ── PHANTOM SIGNING HELPER ────────────────────────────────
  async function _signAndSend(base64Tx) {
    const provider = _getProvider();
    if (!provider) throw new Error('Phantom niet gevonden');

    // Methode 1: Directe signAndSendTransaction (meest compatibel)
    try {
      const txBytes = Uint8Array.from(atob(base64Tx), c => c.charCodeAt(0));
      const result  = await provider.signAndSendTransaction({ serialize: () => txBytes, signatures: [] });
      return result?.signature ?? result;
    } catch(e1) {
      // Methode 2: Via request API
      try {
        const result = await provider.request({
          method: 'signAndSendTransaction',
          params: { transaction: base64Tx },
        });
        return result?.signature ?? result;
      } catch(e2) {
        throw new Error('Phantom signing mislukt: ' + e2.message);
      }
    }
  }

  // ── JUPITER SWAP (alleen bij Phantom wallet) ──────────────
  async function executeSwap(tokenMint, amountSol, slippageBps) {
    if (!_connected)  throw new Error('Wallet niet verbonden');
    if (!_isPhantom)  throw new Error('Live trades vereisen Phantom wallet. Je gebruikt nu een read-only adres (Axiom wallet). Verbind Phantom voor live trading.');

    slippageBps = slippageBps || 100;
    const lamports = Math.floor(amountSol * 1e9);

    Storage.addLog('info', '🔄 Jupiter quote: ' + amountSol + ' SOL → ' + tokenMint.slice(0,8) + '...');

    // Quote ophalen
    const quoteResp = await fetch(
      'https://quote-api.jup.ag/v6/quote?' + new URLSearchParams({
        inputMint:        SOL_MINT,
        outputMint:       tokenMint,
        amount:           lamports.toString(),
        slippageBps:      slippageBps.toString(),
        onlyDirectRoutes: 'false',
      }),
      { headers: { 'Accept': 'application/json' } }
    );
    if (!quoteResp.ok) throw new Error('Jupiter quote fout: ' + await quoteResp.text());
    const quote = await quoteResp.json();
    if (quote.error) throw new Error('Jupiter: ' + quote.error);

    const outAmount   = parseInt(quote.outAmount || '0');
    const priceImpact = parseFloat(quote.priceImpactPct || '0');
    Storage.addLog('info', '📊 Quote OK | Impact: ' + priceImpact.toFixed(2) + '%');
    if (priceImpact > 5) Storage.addLog('warning', '⚠️ Hoge price impact: ' + priceImpact.toFixed(1) + '%');

    // Swap transactie bouwen
    const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse:             quote,
        userPublicKey:             _publicKey,
        wrapAndUnwrapSol:          true,
        dynamicComputeUnitLimit:   true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    if (!swapResp.ok) throw new Error('Swap build fout: ' + await swapResp.text());
    const swapData = await swapResp.json();
    if (swapData.error) throw new Error('Swap error: ' + swapData.error);

    Storage.addLog('info', '✍️ Phantom opent voor bevestiging...');
    const signature = await _signAndSend(swapData.swapTransaction);

    Storage.addLog('success', '✅ GEKOCHT! solscan.io/tx/' + String(signature).slice(0,20) + '...');

    setTimeout(async () => {
      const b = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: b, isPhantom: true });
      if (typeof App !== 'undefined') App.onWalletChange();
    }, 3000);

    return { signature, outAmount };
  }

  // ── JUPITER SELL ──────────────────────────────────────────
  async function executeSell(tokenMint, tokenAmount, decimals, slippageBps) {
    if (!_connected)  throw new Error('Wallet niet verbonden');
    if (!_isPhantom)  throw new Error('Live sells vereisen Phantom wallet.');

    decimals    = decimals    || 6;
    slippageBps = slippageBps || 150;
    const rawAmount = Math.floor(tokenAmount * Math.pow(10, decimals));

    const quoteResp = await fetch(
      'https://quote-api.jup.ag/v6/quote?' + new URLSearchParams({
        inputMint:   tokenMint,
        outputMint:  SOL_MINT,
        amount:      rawAmount.toString(),
        slippageBps: slippageBps.toString(),
      }),
      { headers: { 'Accept': 'application/json' } }
    );
    if (!quoteResp.ok) throw new Error('Sell quote fout');
    const quote = await quoteResp.json();
    if (quote.error) throw new Error('Jupiter sell: ' + quote.error);

    const outSOL = parseInt(quote.outAmount || '0') / 1e9;
    Storage.addLog('info', '📊 Sell quote: → ' + outSOL.toFixed(5) + ' SOL');

    const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse:             quote,
        userPublicKey:             _publicKey,
        wrapAndUnwrapSol:          true,
        dynamicComputeUnitLimit:   true,
        prioritizationFeeLamports: 'auto',
      }),
    });
    if (!swapResp.ok) throw new Error('Sell build fout');
    const swapData = await swapResp.json();

    const signature = await _signAndSend(swapData.swapTransaction);
    Storage.addLog('success', '✅ VERKOCHT! ' + outSOL.toFixed(5) + ' SOL ontvangen');

    setTimeout(async () => {
      const b = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: b, isPhantom: true });
      if (typeof App !== 'undefined') App.onWalletChange();
    }, 3000);

    return { signature, outSOL };
  }

  function _short(pk) { return pk ? pk.slice(0,6) + '...' + pk.slice(-4) : ''; }

  return {
    isPhantomInstalled, isConnected, isPhantomWallet, getPublicKey,
    connect, connectByAddress, disconnect, tryAutoConnect,
    getBalance, executeSwap, executeSell,
  };
})();
