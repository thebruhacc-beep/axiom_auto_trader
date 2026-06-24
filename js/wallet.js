/* ============================================================
   WALLET.JS - Phantom wallet integratie
   Gebruikt de officiële Phantom window.solana API
   Private keys worden NOOIT opgeslagen of verstuurd
   ============================================================ */

'use strict';

const Wallet = (() => {

  let _publicKey = null;
  let _connected = false;

  // ── DETECTIE ──────────────────────────────────────────────

  function isPhantomInstalled() {
    return !!(window.phantom?.solana?.isPhantom || window.solana?.isPhantom);
  }

  function getProvider() {
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom) return window.solana;
    return null;
  }

  // ── VERBINDEN ─────────────────────────────────────────────

  async function connect() {
    if (!isPhantomInstalled()) {
      window.open('https://phantom.app/', '_blank');
      throw new Error('Phantom is niet geïnstalleerd. Installeer Phantom en herlaad de pagina.');
    }

    const provider = getProvider();

    try {
      const resp = await provider.connect();
      _publicKey = resp.publicKey.toString();
      _connected = true;

      // Haal saldo op
      const balance = await _getBalance(_publicKey);

      // Sla ALLEEN publieke info op (nooit private key)
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance });

      Storage.addLog('success', `Wallet verbonden: ${_short(_publicKey)} | Saldo: ${balance.toFixed(4)} SOL`);

      // Luister op account wissels
      provider.on('accountChanged', _onAccountChanged);
      provider.on('disconnect', _onDisconnect);

      return { publicKey: _publicKey, balance };
    } catch (err) {
      if (err.code === 4001) throw new Error('Verbinding geweigerd door gebruiker.');
      throw err;
    }
  }

  async function disconnect() {
    const provider = getProvider();
    if (provider) {
      try {
        await provider.disconnect();
      } catch { /* negeer */ }
    }
    _publicKey = null;
    _connected = false;
    Storage.saveWallet({ isConnected: false, publicKey: null, balance: null });
    Storage.addLog('info', 'Wallet verbroken');
  }

  // ── AUTO-RECONNECT ────────────────────────────────────────

  async function tryAutoConnect() {
    if (!isPhantomInstalled()) return null;
    const provider = getProvider();
    if (!provider.isConnected) return null;

    try {
      // Phantom is al verbonden van vorige sessie — gebruik eager connect
      const resp = await provider.connect({ onlyIfTrusted: true });
      _publicKey = resp.publicKey.toString();
      _connected = true;
      const balance = await _getBalance(_publicKey);
      Storage.saveWallet({ isConnected: true, publicKey: _publicKey, balance });
      return { publicKey: _publicKey, balance };
    } catch { return null; }
  }

  // ── SALDO ─────────────────────────────────────────────────

  async function refreshBalance() {
    if (!_publicKey) return null;
    const balance = await _getBalance(_publicKey);
    const w = Storage.getWallet();
    w.balance = balance;
    Storage.saveWallet(w);
    return balance;
  }

  async function _getBalance(pubkey) {
    try {
      const r = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getBalance',
          params: [pubkey, { commitment: 'confirmed' }],
        }),
      });
      const d = await r.json();
      return (d.result?.value || 0) / 1e9;
    } catch { return 0; }
  }

  // ── EVENT HANDLERS ────────────────────────────────────────

  function _onAccountChanged(newPubKey) {
    if (newPubKey) {
      _publicKey = newPubKey.toString();
      Storage.addLog('info', `Wallet account gewijzigd naar: ${_short(_publicKey)}`);
    } else {
      _onDisconnect();
    }
    // Herlaad UI
    if (typeof App !== 'undefined') App.onWalletChange();
  }

  function _onDisconnect() {
    _publicKey = null;
    _connected = false;
    Storage.saveWallet({ isConnected: false, publicKey: null, balance: null });
    Storage.addLog('info', 'Wallet automatisch verbroken');
    if (typeof App !== 'undefined') App.onWalletChange();
  }

  // ── LIVE TRADE VIA PHANTOM ────────────────────────────────
  // Placeholder — echte implementatie vereist Jupiter SDK
  // voor de daadwerkelijke Solana swap transactie

  async function signAndSendSwap(tokenAddress, amountSol) {
    if (!_connected) throw new Error('Wallet niet verbonden');

    // In productie:
    // 1. Haal quote op van Jupiter API: https://quote-api.jup.ag/v6/quote
    // 2. Bouw swap transactie: https://quote-api.jup.ag/v6/swap
    // 3. Deserialize transactie
    // 4. Laat Phantom tekenen: provider.signAndSendTransaction(tx)
    // 5. Bevestig op chain

    throw new Error(
      'Live swaps vereisen Jupiter SDK integratie. ' +
      'Gebruik paper trading of open Axiom.trade handmatig.'
    );
  }

  // ── HELPERS ───────────────────────────────────────────────

  function _short(pk) {
    return pk ? `${pk.slice(0,6)}...${pk.slice(-4)}` : 'onbekend';
  }

  function getPublicKey() { return _publicKey; }
  function isConnected()  { return _connected; }

  return {
    isPhantomInstalled, connect, disconnect, tryAutoConnect,
    refreshBalance, signAndSendSwap,
    getPublicKey, isConnected,
  };

})();
