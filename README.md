# Grootboek — Inkomsten Tracker

Eén dashboard voor al je inkomsten: PayPal, Solana wallets, Polygon wallets en Bybit.
Ledger (cold storage) staat klaar als placeholder voor later.

## Hoe het werkt

- **Solana & Polygon**: volledig client-side. Je voegt een publiek wallet-adres toe,
  de browser haalt het saldo rechtstreeks op via publieke RPC-nodes + de koers via CoinGecko.
  Geen keys nodig, alles blijft in je browser (localStorage).
- **PayPal & Bybit**: lopen via de serverless functies in `/api`. Die functies draaien
  op Vercel's servers (niet in de browser), en gebruiken environment variables voor de
  secrets. Zo blijven je PayPal client secret en Bybit API secret altijd server-side.

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

### 3. Environment variables instellen

In je Vercel project: **Settings → Environment Variables**, voeg toe:

| Naam | Waarde |
|---|---|
| `PAYPAL_CLIENT_ID` | uit je PayPal developer app (developer.paypal.com) |
| `PAYPAL_SECRET` | uit dezelfde app |
| `PAYPAL_ENV` | `live` (of `sandbox` om te testen) |
| `BYBIT_API_KEY` | uit Bybit API Management |
| `BYBIT_API_SECRET` | uit dezelfde plek |

Na het toevoegen: **Redeploy** je project zodat de variabelen actief worden.

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
