# Grootboek — Inkomsten Tracker

Eén dashboard voor al je inkomsten: PayPal, Solana wallets, Polygon wallets en Bybit.
Ledger (cold storage) staat klaar als placeholder voor later.

## Hoe het werkt

- **Solana & Polygon**: volledig client-side. Je voegt een publiek wallet-adres toe,
  de browser haalt het saldo rechtstreeks op via publieke RPC-nodes + de koers via CoinGecko.
  Geen keys nodig, alles blijft in je browser (localStorage).
- **PayPal & Bybit**: die APIs staan geen directe browser-calls toe (CORS), dus die lopen
  via de serverless functies in `/api`, die enkel als doorgeefluik dienen. Je vult je Client ID/Secret
  (PayPal) en API Key/Secret (Bybit) in via het **Instellingen**-tabblad in het dashboard zelf.
  Die gegevens worden opgeslagen in de `localStorage` van jouw browser — nooit in code, nooit
  gecommit, nooit op GitHub — en per aanvraag meegestuurd naar de serverless functie, die ze
  gebruikt om de call uit te voeren en verder niet bewaart.
  (Env vars blijven ook mogelijk als fallback, voor wie dat toch verkiest — zie `.env.example`.)
- **Auto-refresh**: alle bronnen met ingevulde credentials (of publieke wallets) worden om de
  15 seconden automatisch ververst.

## Setup

### 1. Project naar GitHub

```bash
cd inkomsten-tracker
git init
git add .
git commit -m "init"
git remote add origin <jouw-repo-url>
git push -u origin main
```

### 2. Deployen op Vercel

- Ga naar [vercel.com](https://vercel.com) → New Project → importeer je GitHub repo.
- Vercel herkent automatisch dat `/public` de frontend is en `/api/*.js` serverless
  functions zijn — geen extra configuratie nodig.

### 3. Credentials invullen

Geen environment variables nodig. Open je dashboard → tabblad **Instellingen** → vul in:

- PayPal Client ID + Secret (uit developer.paypal.com)
- Bybit API Key + Secret (uit Bybit API Management, enkel leesrechten nodig)

Klik **Opslaan** — dit schrijft weg naar de `localStorage` van je browser, niet naar de code.
(Optioneel: als je toch environment variables verkiest als fallback, kan dat nog steeds via
Vercel → Settings → Environment Variables, zie `.env.example`.)

### 4. Lokaal testen (optioneel)

```bash
npm i -g vercel
cp .env.example .env   # vul in met je eigen keys, dit bestand wordt nooit gecommit
vercel dev
```

## Belangrijke kanttekeningen

- **PayPal Transaction Search API** vereist een Business account met reporting-rechten
  geactiveerd op je app in het PayPal Developer Dashboard. Zonder dat krijg je een
  duidelijke foutmelding terug in de UI.
- **Bybit** vereist een API key met minstens leestoegang tot account/wallet info
  (geen trade-rechten nodig voor dit dashboard).
- **PayPal geeft max. 31 dagen per call** — het dashboard vraagt standaard de laatste
  30 dagen op. Voor een langere historiek zou je meerdere calls met andere datums
  moeten combineren (uitbreidbaar in `/api/paypal.js`).
- **Ledger (hardware wallet)** integratie is voorzien als placeholder-tab. Rechtstreeks
  verbinden via WebUSB/WebHID kan later toegevoegd worden — voorlopig kan je Ledger-
  adressen gewoon als publiek adres toevoegen bij Solana/Polygon.

## Uitbreidingsideeën

- SPL-tokens en ERC-20 tokens naast de native SOL/MATIC balans tonen
- Historische grafiek van je totale netto waarde over tijd (bv. dagelijkse snapshot opslaan)
- CSV-export van PayPal-transacties
- Ledger hardware wallet connectie via WebHID
