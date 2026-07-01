/* ============================================================
   WALLET.JS - Phantom wallet + Jupiter swap integratie
   Echte live trades via Jupiter API (gratis, geen key nodig)
   Private keys worden NOOIT opgeslagen of verstuurd
   ============================================================ */
'use strict';

const Wallet = (() => {

  let _publicKey = null;
  let _connected = false;

  // Solana token adressen
  const SOL_MINT  = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC

  function _getProvider() {
    if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom)
      return window.phantom.solana;
    if (window.solana && window.solana.isPhantom)
      return window.solana;
    return null;
  }

  function isPhantomInstalled() { return !!_getProvider(); }
  function isConnected()        { return _connected; }
  function getPublicKey()       { return _publicKey; }

  // ── VERBINDEN ──────────────────────────────────────────────
  async function connect() {
    const provider = _getProvider();
    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      throw new Error('Phantom niet gevonden. Installeer Phantom en herlaad de pagina.');
    }
    try {
      const resp = await provider.connect();
      _publicKey = resp.publicKey.toString();
      _connected = true;

      const balance = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance });

      // Event listeners
      provider.on('accountChanged', function(pk) {
        if (pk) {
          _publicKey = pk.toString();
          Storage.addLog('info', 'Wallet account gewisseld: ' + _short(_publicKey));
        } else {
          disconnect();
        }
        if (typeof App !== 'undefined') App.onWalletChange();
      });

      provider.on('disconnect', function() {
        disconnect();
        if (typeof App !== 'undefined') App.onWalletChange();
      });

      Storage.addLog('success',
        '👻 Wallet verbonden: ' + _short(_publicKey) +
        ' | ' + balance.toFixed(4) + ' SOL'
      );
      return { publicKey: _publicKey, balance };

    } catch (err) {
      if (err.code === 4001) throw new Error('Verbinding geweigerd door gebruiker.');
      throw err;
    }
  }

  async function disconnect() {
    try { const p = _getProvider(); if (p) p.disconnect(); } catch(e) {}
    _publicKey = null;
    _connected = false;
    Storage.saveWallet({ isConnected: false, publicKey: null, balance: null });
    Storage.addLog('info', '🔌 Wallet verbroken');
  }

  async function tryAutoConnect() {
    const provider = _getProvider();
    if (!provider) return null;
    try {
      const resp = await provider.connect({ onlyIfTrusted: true });
      _publicKey = resp.publicKey.toString();
      _connected = true;
      const balance = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance });
      Storage.addLog('info', '🔄 Auto-verbonden: ' + _short(_publicKey) + ' | ' + balance.toFixed(4) + ' SOL');
      return { publicKey: _publicKey, balance };
    } catch(e) { return null; }
  }

  // ── SALDO OPHALEN ──────────────────────────────────────────
  async function getBalance() {
    if (!_publicKey) return 0;

    // Werkende publieke RPC endpoints met CORS ondersteuning
    const endpoints = [
      'https://mainnet.helius-rpc.com/?api-key=15319d07-b4d3-4376-905b-3885f0bb1211',
      'https://api.mainnet-beta.solana.com',
      'https://rpc.ankr.com/solana',
      'https://solana-mainnet.rpc.extrnode.com',
    ];

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id:      1,
      method:  'getBalance',
      params:  [_publicKey, { commitment: 'confirmed' }],
    });

    for (var i = 0; i < endpoints.length; i++) {
      var url = endpoints[i];
      try {
        var r = await fetch(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    body,
        });

        if (!r.ok) continue;
        var d = await r.json();
        if (d.error || !d.result) continue;

        // result kan { value: N } of gewoon N zijn
        var lamports = (typeof d.result === 'object' && d.result !== null)
          ? d.result.value
          : d.result;

        if (typeof lamports === 'number' && lamports >= 0) {
          return lamports / 1e9;
        }
      } catch(e) {
        console.warn('[Wallet] RPC fout bij', url.split('?')[0], ':', e.message);
      }
    }

    // Fallback: laatste bekende saldo
    var stored = Storage.getWallet();
    return (stored && stored.balance > 0) ? stored.balance : 0;
  }

  // ── JUPITER SWAP — ECHTE LIVE TRADE ───────────────────────
  async function executeSwap(tokenMint, amountSol, slippageBps) {
    if (!_connected || !_publicKey) throw new Error('Wallet niet verbonden');
    slippageBps = slippageBps || 100;

    const provider = _getProvider();
    if (!provider) throw new Error('Phantom niet gevonden');

    const lamports = Math.floor(amountSol * 1e9);
    Storage.addLog('info', '🔄 Jupiter quote: ' + amountSol + ' SOL → ' + tokenMint.slice(0,8) + '...');

    // STAP 1: Quote ophalen
    const quoteParams = new URLSearchParams({
      inputMint:        SOL_MINT,
      outputMint:       tokenMint,
      amount:           lamports.toString(),
      slippageBps:      slippageBps.toString(),
      onlyDirectRoutes: 'false',
    });

    const quoteResp = await fetch(
      'https://quote-api.jup.ag/v6/quote?' + quoteParams.toString(),
      { headers: { 'Accept': 'application/json' } }
    );
    if (!quoteResp.ok) throw new Error('Jupiter quote fout: ' + await quoteResp.text());

    const quote = await quoteResp.json();
    if (quote.error) throw new Error('Jupiter: ' + quote.error);

    const outAmount   = parseInt(quote.outAmount || '0');
    const priceImpact = parseFloat(quote.priceImpactPct || '0');
    Storage.addLog('info', '📊 Quote OK | Impact: ' + priceImpact.toFixed(2) + '%');
    if (priceImpact > 5) Storage.addLog('warning', '⚠️ Hoge price impact: ' + priceImpact.toFixed(1) + '%');

    // STAP 2: Swap transactie bouwen
    const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
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
    if (!swapResp.ok) throw new Error('Swap build fout: ' + await swapResp.text());

    const swapData = await swapResp.json();
    if (swapData.error) throw new Error('Swap error: ' + swapData.error);

    Storage.addLog('info', '✍️ Phantom opent voor bevestiging...');

    // STAP 3: Phantom signing
    // Phantom ondersteunt Base64 versioned transactions direct
    const signature = await _signAndSend(provider, swapData.swapTransaction);

    Storage.addLog('success',
      '✅ GEKOCHT! ' + String(signature).slice(0,16) + '... | ' +
      'https://solscan.io/tx/' + signature
    );

    // Refresh balance na 3 sec
    setTimeout(async function() {
      const b = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: b });
      if (typeof App !== 'undefined') App.onWalletChange();
    }, 3000);

    return { signature, outAmount };
  }

  // ── PHANTOM SIGNING HELPER ───────────────────────────────
  // Ondersteunt alle Phantom versies en transaction types
  async function _signAndSend(provider, base64Transaction) {
    // Methode 1: Meest directe manier voor Phantom (werkt met versioned tx)
    try {
      const result = await provider.signAndSendTransaction(
        Buffer.from(base64Transaction, 'base64')
      );
      return result.signature || result;
    } catch(e1) {
      // Methode 2: Via request API
      try {
        const result = await provider.request({
          method: 'signAndSendTransaction',
          params: { transaction: base64Transaction },
        });
        return result.signature || result;
      } catch(e2) {
        // Methode 3: Deserialize als Uint8Array
        try {
          const bytes  = Uint8Array.from(atob(base64Transaction), function(c) { return c.charCodeAt(0); });
          const result = await provider.signAndSendTransaction({
            serialize:  function() { return bytes; },
            signatures: [],
          });
          return result.signature || result;
        } catch(e3) {
          throw new Error('Alle signing methoden mislukt: ' + e3.message);
        }
      }
    }
  }

  // ── SELL via Jupiter ──────────────────────────────────────
  async function executeSell(tokenMint, tokenAmount, decimals, slippageBps) {
    if (!_connected || !_publicKey) throw new Error('Wallet niet verbonden');

    slippageBps = slippageBps || 150; // 1.5% voor sells (iets meer tolerantie)
    decimals    = decimals || 6;

    const rawAmount = Math.floor(tokenAmount * Math.pow(10, decimals));
    const provider  = _getProvider();

    Storage.addLog('info', '🔄 Verkoop quote: ' + tokenAmount + ' tokens → SOL');

    const quoteUrl = 'https://quote-api.jup.ag/v6/quote?' + new URLSearchParams({
      inputMint:   tokenMint,
      outputMint:  SOL_MINT,
      amount:      rawAmount.toString(),
      slippageBps: slippageBps.toString(),
    }).toString();

    const quoteResp = await fetch(quoteUrl, { headers: { 'Accept': 'application/json' } });
    if (!quoteResp.ok) throw new Error('Sell quote mislukt');

    const quote = await quoteResp.json();
    if (quote.error) throw new Error('Jupiter sell fout: ' + quote.error);

    const outSOL = parseInt(quote.outAmount || '0') / 1e9;
    Storage.addLog('info', '📊 Sell quote: ' + tokenAmount + ' tokens → ' + outSOL.toFixed(5) + ' SOL');

    const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        quoteResponse:           quote,
        userPublicKey:           _publicKey,
        wrapAndUnwrapSol:        true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!swapResp.ok) throw new Error('Sell swap build mislukt');
    const swapData = await swapResp.json();

    const { swapTransaction } = swapData;

    const sig = await _signAndSend(provider, swapTransaction);

    Storage.addLog('success',
      '✅ VERKOCHT! ' + outSOL.toFixed(5) + ' SOL ontvangen | ' +
      'https://solscan.io/tx/' + sig
    );

    setTimeout(async function() {
      const b = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: b });
      if (typeof App !== 'undefined') App.onWalletChange();
    }, 3000);

    return { signature: sig, outSOL };
  }

  function _short(pk) {
    return pk ? pk.slice(0,6) + '...' + pk.slice(-4) : '';
  }

  return {
    isPhantomInstalled,
    isConnected,
    getPublicKey,
    connect,
    disconnect,
    tryAutoConnect,
    getBalance,
    executeSwap,
    executeSell,
  };
})();
