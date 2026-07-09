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

    if (typeof solanaWeb3 === 'undefined') {
      throw new Error('Solana web3.js niet geladen — herlaad de pagina');
    }

    // Bouw een ECHTE VersionedTransaction (Phantom accepteert geen nep-object)
    const bytes = Uint8Array.from(atob(base64Tx), c => c.charCodeAt(0));
    const transaction = solanaWeb3.VersionedTransaction.deserialize(bytes);

    try {
      const result = await provider.signAndSendTransaction(transaction);
      return result?.signature ?? result;
    } catch(e1) {
      // Fallback: lage-niveau request API — Phantom verwacht 'message' (base58), niet 'transaction'
      try {
        const bs58Msg = solanaWeb3.utils
          ? solanaWeb3.utils.bs58.encode(transaction.serialize())
          : _toBase58(transaction.serialize());
        const result = await provider.request({
          method: 'signAndSendTransaction',
          params: { message: bs58Msg },
        });
        return result?.signature ?? result;
      } catch(e2) {
        throw new Error('Signing mislukt: ' + (e2.message || e1.message));
      }
    }
  }

  // Kleine base58 fallback-encoder (voor het geval solanaWeb3.utils.bs58 niet bestaat)
  function _toBase58(buffer) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let digits = [0];
    for (let i = 0; i < buffer.length; i++) {
      let carry = buffer[i];
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let s = '';
    for (let k = 0; buffer[k] === 0 && k < buffer.length - 1; k++) s += '1';
    for (let q = digits.length - 1; q >= 0; q--) s += ALPHABET[digits[q]];
    return s;
  }

  // ── WACHT OP ON-CHAIN BEVESTIGING ─────────────────────────
  // Cruciaal: een signature terugkrijgen van Phantom betekent NIET dat de
  // transactie ook echt geslaagd is op de chain. Zonder deze check registreert
  // de app "gekochte" tokens die er in werkelijkheid nooit gekomen zijn.
  async function _confirmTransaction(signature, timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await fetch('/api/rpc', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'getSignatureStatuses', signatures: [signature] }),
        });
        const d = await r.json();
        const status = d?.result?.value?.[0];
        if (status) {
          if (status.err) throw new Error('Transactie faalde on-chain: ' + JSON.stringify(status.err));
          if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
            return true;
          }
        }
      } catch(e) {
        if (e.message.startsWith('Transactie faalde')) throw e;
        // netwerkfout tijdens polling: gewoon opnieuw proberen
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error('Bevestiging timeout — controleer handmatig op solscan.io');
  }

  // ── TOKEN DECIMALS OPVRAGEN (voor correcte tokenAmount) ────
  async function _getTokenDecimals(mint) {
    try {
      const r = await fetch('/api/rpc', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'getTokenSupply', mint }),
      });
      const d = await r.json();
      if (typeof d.decimals === 'number') return d.decimals;
    } catch(e) { /* val terug op default */ }
    return 6; // meeste pump.fun tokens gebruiken 6 decimals
  }

  const TOKEN_PROGRAM_ID            = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

  // ── TOKEN-ACCOUNT SLUITEN (rent terugvorderen na volledige verkoop) ──
  // Elk nieuw token-account kost ~0.00203 SOL rent. Zodra je positie
  // volledig verkocht is (saldo 0), kunnen we het account sluiten en
  // die rent terugkrijgen — dit is de grootste besparing bij kleine trades.
  async function closeTokenAccount(tokenMint) {
    try {
      if (typeof solanaWeb3 === 'undefined') return null;

      const ownerPk = new solanaWeb3.PublicKey(_publicKey);
      const mintPk  = new solanaWeb3.PublicKey(tokenMint);
      const tokenProgramPk = new solanaWeb3.PublicKey(TOKEN_PROGRAM_ID);
      const assocProgramPk = new solanaWeb3.PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);

      const [ata] = solanaWeb3.PublicKey.findProgramAddressSync(
        [ownerPk.toBuffer(), tokenProgramPk.toBuffer(), mintPk.toBuffer()],
        assocProgramPk
      );

      const bhResp = await fetch('/api/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getLatestBlockhash' }),
      });
      const bh = await bhResp.json();
      if (!bh.blockhash) return null;

      const closeIx = new solanaWeb3.TransactionInstruction({
        programId: tokenProgramPk,
        keys: [
          { pubkey: ata,    isSigner: false, isWritable: true },
          { pubkey: ownerPk, isSigner: false, isWritable: true }, // rent gaat terug naar owner
          { pubkey: ownerPk, isSigner: true,  isWritable: false },
        ],
        data: Uint8Array.from([9]), // TokenInstruction::CloseAccount
      });

      const msg = new solanaWeb3.TransactionMessage({
        payerKey:        ownerPk,
        recentBlockhash: bh.blockhash,
        instructions:    [closeIx],
      }).compileToV0Message();

      const tx = new solanaWeb3.VersionedTransaction(msg);

      Storage.addLog('info', '🧹 Token-account sluiten (rent terugvorderen)...');
      const signature = await _signAndSend2(tx);
      const sig = String(signature?.signature ?? signature);
      await _confirmTransaction(sig, 20000);
      Storage.addLog('success', '✅ Rent teruggekregen (~0.002 SOL) | ' + sig.slice(0,16) + '...');
      return sig;
    } catch(e) {
      // Niet kritiek — als dit faalt (bv. account had nog stof/geen 0-saldo) laten we het gewoon staan
      Storage.addLog('warning', '⚠️ Account sluiten mislukt (niet kritiek): ' + e.message);
      return null;
    }
  }

  // Losse signeerfunctie zonder de Jupiter-specifieke fallback-string-logica,
  // hergebruikt dezelfde Phantom-signing-strategie als _signAndSend
  async function _signAndSend2(transaction) {
    const provider = _getProvider();
    try {
      const result = await provider.signAndSendTransaction(transaction);
      return result?.signature ?? result;
    } catch(e1) {
      const bs58Msg = solanaWeb3.utils
        ? solanaWeb3.utils.bs58.encode(transaction.serialize())
        : _toBase58(transaction.serialize());
      const result = await provider.request({
        method: 'signAndSendTransaction',
        params: { message: bs58Msg },
      });
      return result?.signature ?? result;
    }
  }

  // ── KOPEN VIA JUPITER PROXY ───────────────────────────────
  async function executeSwap(tokenMint, amountSol, slippageBps) {
    if (!_connected) throw new Error('Wallet niet verbonden');

    const stored = Storage.getWallet();
    if (stored.readOnly) {
      throw new Error('Read-only adres — verbind Phantom voor live trades');
    }

    slippageBps = slippageBps || 1000; // 10% — na herhaalde slippage-reverts
    const lamports = Math.floor(amountSol * 1e9);

    Storage.addLog('info', '🔄 Quote ophalen: ' + amountSol + ' SOL → ' + tokenMint.slice(0,8) + '...');

    // Quote via proxy
    // Jupiter heeft CORS headers — direct aanroepen vanuit browser
    // Jupiter via eigen proxy (CORS fix)
    const qr = await fetch('/api/jupiter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'quote', params: {
        inputMint:        SOL_MINT,
        outputMint:       tokenMint,
        amount:           lamports.toString(),
        slippageBps:      slippageBps.toString(),
        onlyDirectRoutes: 'false',
      }}),
    });
    if (!qr.ok) throw new Error('Quote proxy fout ' + qr.status);
    const quote = await qr.json();
    if (quote.error) throw new Error('Jupiter quote: ' + (quote.error.msg || JSON.stringify(quote.error)));

    const outAmount   = parseInt(quote.outAmount || '0');
    const priceImpact = parseFloat(quote.priceImpactPct || '0');
    Storage.addLog('info', '📊 Quote OK | Impact: ' + priceImpact.toFixed(2) + '%');
    if (priceImpact > 5) Storage.addLog('warning', '⚠️ Hoge impact: ' + priceImpact.toFixed(1) + '%');

    // Swap transactie via proxy
    // LET OP: 'auto' kan tot 0.005 SOL priority fee kosten — veel te veel voor
    // een kleine trade. We cappen 'm laag zodat fees minimaal blijven.
    const sr = await fetch('/api/jupiter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'swap', params: {
        quoteResponse:             quote,
        userPublicKey:             _publicKey,
        wrapAndUnwrapSol:          true,
        dynamicComputeUnitLimit:   true,
        dynamicSlippage:           { maxBps: 1000 }, // optimaliseert slippage per token, max 10%
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: { priorityLevel: 'medium', maxLamports: 50000 }, // max 0.00005 SOL
        },
      }}),
    });
    if (!sr.ok) throw new Error('Swap proxy fout ' + sr.status);
    const swapData = await sr.json();
    if (swapData.error) throw new Error('Swap: ' + (swapData.error.msg || JSON.stringify(swapData.error)));

    Storage.addLog('info', '✍️ Phantom opent voor bevestiging...');
    const signature = await _signAndSend(swapData.swapTransaction);
    const sig = String(signature?.signature ?? signature);

    Storage.addLog('info', '⏳ Wachten op on-chain bevestiging...');
    await _confirmTransaction(sig);

    Storage.addLog('success', '✅ GEKOCHT (bevestigd)! ' + sig.slice(0,16) + '... | solscan.io/tx/' + sig);

    const decimals = await _getTokenDecimals(tokenMint);
    const tokenAmountReal = outAmount / Math.pow(10, decimals);

    // Refresh balance na 4 sec
    setTimeout(async () => {
      const b = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance: b });
      if (typeof App !== 'undefined') App.onWalletChange();
    }, 4000);

    return { signature: sig, outAmount: tokenAmountReal, decimals };
  }

  // ── VERKOPEN VIA JUPITER PROXY ────────────────────────────
  async function executeSell(tokenMint, tokenAmount, decimals, slippageBps, closeAccountAfter) {
    if (!_connected) throw new Error('Wallet niet verbonden');
    const stored = Storage.getWallet();
    if (stored.readOnly) throw new Error('Read-only adres — verbind Phantom');

    decimals    = decimals    || 6;
    slippageBps = slippageBps || 1000; // 10% — na herhaalde slippage-reverts
    const rawAmount = Math.floor(tokenAmount * Math.pow(10, decimals));

    const qr = await fetch('/api/jupiter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'quote', params: {
        inputMint:   tokenMint,
        outputMint:  SOL_MINT,
        amount:      rawAmount.toString(),
        slippageBps: slippageBps.toString(),
      }}),
    });
    if (!qr.ok) throw new Error('Sell quote proxy fout ' + qr.status);
    const quote = await qr.json();
    if (quote.error) throw new Error('Sell: ' + (quote.error.msg || JSON.stringify(quote.error)).slice(0,100));

    const outSOL = parseInt(quote.outAmount || '0') / 1e9;
    Storage.addLog('info', '📊 Sell: → ' + outSOL.toFixed(5) + ' SOL');

    const sr = await fetch('/api/jupiter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'swap', params: {
        quoteResponse:             quote,
        userPublicKey:             _publicKey,
        wrapAndUnwrapSol:          true,
        dynamicComputeUnitLimit:   true,
        dynamicSlippage:           { maxBps: 1000 }, // optimaliseert slippage per token, max 10%
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: { priorityLevel: 'medium', maxLamports: 50000 }, // max 0.00005 SOL
        },
      }}),
    });
    if (!sr.ok) throw new Error('Sell swap proxy fout ' + sr.status);
    const swapData = await sr.json();
    if (swapData.error) throw new Error('Sell swap: ' + (swapData.error.msg || JSON.stringify(swapData.error)).slice(0,100));

    const signature = await _signAndSend(swapData.swapTransaction);
    const sig = String(signature?.signature ?? signature);

    Storage.addLog('info', '⏳ Wachten op on-chain bevestiging...');
    await _confirmTransaction(sig);

    Storage.addLog('success', '✅ VERKOCHT (bevestigd)! ' + outSOL.toFixed(5) + ' SOL | ' + sig.slice(0,16) + '...');

    // Rent terugvorderen als dit een VOLLEDIGE exit is (niet bij gedeeltelijke TP1-verkoop)
    if (closeAccountAfter) {
      await closeTokenAccount(tokenMint);
    }

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
    getBalance, executeSwap, executeSell, closeTokenAccount,
  };
})();
