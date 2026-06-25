/* ============================================================
   WALLET.JS - Phantom wallet integratie
   Private keys worden NOOIT opgeslagen
   ============================================================ */
'use strict';

const Wallet = (() => {

  let _publicKey = null;
  let _connected = false;

  function _getProvider() {
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom)          return window.solana;
    return null;
  }

  function isPhantomInstalled() { return !!_getProvider(); }
  function isConnected()        { return _connected; }
  function getPublicKey()       { return _publicKey; }

  async function connect() {
    const provider = _getProvider();
    if (!provider) {
      window.open('https://phantom.app/', '_blank');
      throw new Error('Phantom niet gevonden. Installeer op phantom.app en herlaad de pagina.');
    }
    try {
      const resp = await provider.connect();
      _publicKey = resp.publicKey.toString();
      _connected = true;

      const balance = await getBalance();
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance });

      provider.on('accountChanged', pk => {
        if (pk) { _publicKey = pk.toString(); Storage.addLog('info', `Wallet gewisseld: ${_short(_publicKey)}`); }
        else disconnect();
        if (typeof App !== 'undefined') App.onWalletChange();
      });
      provider.on('disconnect', () => {
        disconnect();
        if (typeof App !== 'undefined') App.onWalletChange();
      });

      Storage.addLog('success', `👻 Wallet verbonden: ${_short(_publicKey)} | ${balance.toFixed(4)} SOL`);
      return { publicKey: _publicKey, balance };
    } catch (err) {
      if (err.code === 4001) throw new Error('Verbinding geweigerd.');
      throw err;
    }
  }

  async function disconnect() {
    try { _getProvider()?.disconnect(); } catch { /* negeer */ }
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
      return { publicKey: _publicKey, balance };
    } catch { return null; }
  }

  async function getBalance() {
    if (!_publicKey) return 0;
    try {
      const r = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'getBalance', params:[_publicKey,{commitment:'confirmed'}] }),
      });
      const d = await r.json();
      return (d.result?.value || 0) / 1e9;
    } catch { return 0; }
  }

  // Live swap via Jupiter — vereist Jupiter SDK
  // Placeholder: stuurt gebruiker naar Axiom voor handmatige bevestiging
  async function executeSwap(tokenAddress, amountSol) {
    if (!_connected) throw new Error('Wallet niet verbonden');
    // TODO: Jupiter API integratie
    // 1. GET https://quote-api.jup.ag/v6/quote?inputMint=So11...&outputMint={token}&amount={lamports}
    // 2. POST https://quote-api.jup.ag/v6/swap met quoteResponse
    // 3. provider.signAndSendTransaction(transaction)
    throw new Error('Live swaps: open Axiom.trade handmatig voor nu.');
  }

  function _short(pk) { return pk ? `${pk.slice(0,6)}...${pk.slice(-4)}` : ''; }

  return { isPhantomInstalled, isConnected, getPublicKey, connect, disconnect, tryAutoConnect, getBalance, executeSwap };
})();
