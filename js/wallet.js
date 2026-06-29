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
  // Probeert meerdere RPC endpoints als één faalt
  async function getBalance() {
    if (!_publicKey) return 0;

    const endpoints = [
      'https://api.mainnet-beta.solana.com',
      'https://solana-mainnet.g.alchemy.com/v2/demo',
      'https://rpc.ankr.com/solana',
    ];

    for (const endpoint of endpoints) {
      try {
        const r = await fetch(endpoint, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id:      1,
            method:  'getBalance',
            params:  [_publicKey, { commitment: 'confirmed' }],
          }),
        });

        if (!r.ok) continue;
        const d = await r.json();

        // Check voor errors in response
        if (d.error) continue;
        const lamports = d.result && d.result.value;
        if (typeof lamports === 'number') {
          return lamports / 1e9;
        }
      } catch(e) {
        continue; // Probeer volgende endpoint
      }
    }

    Storage.addLog('warning', '⚠️ Kon SOL saldo niet ophalen — controleer internetverbinding');
    return 0;
  }

  // ── JUPITER SWAP — ECHTE LIVE TRADE ───────────────────────
  // Jupiter is de grootste DEX aggregator op Solana
  // Gratis te gebruiken, geen API key nodig
  // Fees: alleen DEX fee (~0.25%) + netwerk fee (~$0.001)
  async function executeSwap(tokenMint, amountSol, slippageBps) {
    if (!_connected || !_publicKey) {
      throw new Error('Wallet niet verbonden');
    }

    slippageBps = slippageBps || 100; // 1% slippage tolerance standaard

    const provider  = _getProvider();
    if (!provider) throw new Error('Phantom provider niet gevonden');

    const lamports  = Math.floor(amountSol * 1e9);

    Storage.addLog('info',
      '🔄 Jupiter quote ophalen: ' + amountSol + ' SOL → ' + tokenMint.slice(0,8) + '...'
    );

    // STAP 1: Haal quote op van Jupiter
    const quoteUrl = 'https://quote-api.jup.ag/v6/quote?' + new URLSearchParams({
      inputMint:   SOL_MINT,
      outputMint:  tokenMint,
      amount:      lamports.toString(),
      slippageBps: slippageBps.toString(),
      onlyDirectRoutes: 'false',
    }).toString();

    const quoteResp = await fetch(quoteUrl, {
      headers: { 'Accept': 'application/json' },
    });

    if (!quoteResp.ok) {
      const err = await quoteResp.text();
      throw new Error('Jupiter quote mislukt: ' + err);
    }

    const quote = await quoteResp.json();
    if (quote.error) throw new Error('Jupiter fout: ' + quote.error);

    const outAmount   = parseInt(quote.outAmount || '0');
    const priceImpact = parseFloat(quote.priceImpactPct || '0');

    Storage.addLog('info',
      '📊 Quote: ' + amountSol + ' SOL → ' + outAmount +
      ' tokens | Price impact: ' + priceImpact.toFixed(2) + '%'
    );

    // Waarschuw bij hoge price impact
    if (priceImpact > 5) {
      Storage.addLog('warning',
        '⚠️ Hoge price impact: ' + priceImpact.toFixed(2) + '% — overweeg kleinere trade'
      );
    }

    // STAP 2: Bouw swap transactie
    const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        quoteResponse:         quote,
        userPublicKey:         _publicKey,
        wrapAndUnwrapSol:      true,   // Automatisch SOL ↔ wSOL
        dynamicComputeUnitLimit: true, // Optimale compute units
        prioritizationFeeLamports: 'auto', // Auto priority fee voor snelle uitvoering
      }),
    });

    if (!swapResp.ok) {
      const err = await swapResp.text();
      throw new Error('Jupiter swap build mislukt: ' + err);
    }

    const swapData = await swapResp.json();
    if (swapData.error) throw new Error('Swap error: ' + swapData.error);

    const { swapTransaction } = swapData;

    Storage.addLog('info', '✍️ Transactie klaar — Phantom opent voor bevestiging...');

    // STAP 3: Deserialize en stuur naar Phantom voor ondertekening
    // Phantom tekent ALLEEN — private key verlaat de wallet nooit
    const txBuffer = Uint8Array.from(atob(swapTransaction), function(c) { return c.charCodeAt(0); });

    // Gebruik sendTransaction voor Versioned Transactions (Jupiter v6 gebruikt deze)
    let signature;
    try {
      // Probeer eerst sendTransaction (voor versioned transactions)
      signature = await provider.request({
        method: 'signAndSendTransaction',
        params: {
          message:     swapTransaction,
          connection:  'mainnet-beta',
        },
      });
    } catch(e1) {
      // Fallback naar directe method
      try {
        const result = await provider.signAndSendTransaction({
          serialize: function() { return txBuffer; },
          signatures: [],
        });
        signature = result.signature || result;
      } catch(e2) {
        throw new Error('Phantom signing mislukt: ' + (e2.message || e2));
      }
    }

    const sig = typeof signature === 'object' ? signature.signature || signature.publicKey : signature;

    Storage.addLog('success',
      '✅ LIVE TRADE UITGEVOERD! Tx: ' + String(sig).slice(0, 20) + '...' +
      ' | Bekijk: https://solscan.io/tx/' + sig
    );

    // Update wallet balance na trade
    setTimeout(async function() {
      const newBalance = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: newBalance });
      if (typeof App !== 'undefined') App.onWalletChange();
    }, 3000);

    return { signature: sig, outAmount };
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

    let signature;
    try {
      signature = await provider.request({
        method: 'signAndSendTransaction',
        params: { message: swapTransaction, connection: 'mainnet-beta' },
      });
    } catch(e) {
      const txBuffer = Uint8Array.from(atob(swapTransaction), function(c) { return c.charCodeAt(0); });
      const result   = await provider.signAndSendTransaction({
        serialize: function() { return txBuffer; },
        signatures: [],
      });
      signature = result.signature || result;
    }

    const sig = typeof signature === 'object' ? signature.signature || signature : signature;

    Storage.addLog('success',
      '✅ VERKOOP UITGEVOERD! ' + outSOL.toFixed(5) + ' SOL ontvangen | Tx: ' + String(sig).slice(0,20) + '...'
    );

    setTimeout(async function() {
      const newBalance = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: newBalance });
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
