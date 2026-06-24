# ◎ Axiom Memecoin Scanner — Web App

Volledige web-based memecoin scanner die verbindt met je **Phantom wallet** op Solana.
Deploy in 5 minuten op Vercel met een gratis domein.

---

## 🚀 Vercel Deployment (5 minuten)

### Optie A — Via GitHub (aanbevolen)

1. **Maak een GitHub repository aan**
   ```
   Ga naar github.com → New repository → "axiom-scanner"
   ```

2. **Upload de bestanden**
   - Sleep alle bestanden van deze map naar de GitHub repository
   - Of gebruik GitHub Desktop / git command line:
   ```bash
   git init
   git add .
   git commit -m "Axiom Scanner v1.0"
   git remote add origin https://github.com/JOUW-USERNAME/axiom-scanner.git
   git push -u origin main
   ```

3. **Verbind met Vercel**
   - Ga naar [vercel.com](https://vercel.com) → Log in
   - Klik **"Add New Project"**
   - Klik **"Import"** naast je axiom-scanner repository
   - **Framework Preset**: selecteer **"Other"**
   - Klik **"Deploy"**
   - ✅ Klaar! Vercel geeft je een URL zoals `axiom-scanner.vercel.app`

4. **Gratis custom domein koppelen** (optioneel)
   - In Vercel project → **Settings → Domains**
   - Voeg je gratis domein toe (bijv. van Freenom, .tk domein)
   - Volg de DNS instructies

### Optie B — Vercel CLI (direct)

```bash
# Installeer Vercel CLI
npm install -g vercel

# Deploy vanuit de project map
cd axiom-scanner-web
vercel

# Volg de instructies in de terminal
# Je krijgt direct een live URL
```

---

## 📁 Bestandsstructuur

```
axiom-scanner-web/
├── index.html          ← Hoofd app (één HTML bestand)
├── vercel.json         ← Vercel routing config
├── css/
│   └── main.css        ← Volledig stylesheet
└── js/
    ├── storage.js      ← localStorage data management
    ├── safetyAnalyzer.js ← Rug pull detectie
    ├── scoreCalculator.js← Score 0-100 berekening
    ├── tokenFetcher.js  ← DexScreener + RugCheck API
    ├── tradeManager.js  ← Paper/live trade logica
    ├── backtestEngine.js← Backtest simulatie
    ├── wallet.js        ← Phantom wallet integratie
    ├── scanner.js       ← Scan loop engine
    ├── ui.js            ← DOM rendering
    └── app.js           ← Hoofd controller
```

---

## 👻 Phantom Wallet Verbinding

### Hoe het werkt

1. Installeer de **Phantom extensie** in Chrome: [phantom.app](https://phantom.app)
2. Open de web app
3. Klik **"Verbind Phantom"** in de sidebar
4. Phantom opent een popup → klik **"Verbinden"**
5. Je publieke adres en SOL saldo verschijnen

### Veiligheid

- ✅ Alleen je **publiek adres** wordt opgeslagen (in localStorage)
- ✅ **Private keys** worden nooit gezien, opgeslagen of verstuurd
- ✅ Transacties vereisen altijd **jouw goedkeuring** in Phantom
- ✅ Geen externe servers — alles draait lokaal in je browser

---

## 🔧 Functies

| Functie | Beschrijving |
|---------|-------------|
| **Token Scanner** | Automatisch scannen via DexScreener & RugCheck |
| **Score Systeem** | 0-100 score op volume, holders, liquiditeit, momentum |
| **Veiligheidsfilters** | Rug pull, honeypot, whale concentratie detectie |
| **Paper Trading** | Risicoloos testen met virtuele 0.1 SOL |
| **Live Trading** | Verbonden met Phantom (markt orders via Axiom.trade) |
| **Take Profit** | Automatisch: 50% @ +30%, rest @ +80% |
| **Stop Loss** | Automatisch bij -15% |
| **Backtesting** | Strategie testen op gesimuleerde data |
| **Dashboard** | Real-time P&L, win rate, open posities |

---

## ⚙️ Configuratie

Alle instellingen bewaar je via de **Instellingen pagina** in de app.
Ze worden lokaal opgeslagen in je browser (localStorage).

### Standaard instellingen

```
Startkapitaal:      0.1 SOL
Bedrag per trade:   0.01 SOL
Max posities:       5
Stop Loss:         -15%
Take Profit 1:     +30% (50% verkopen)
Take Profit 2:     +80% (rest verkopen)
Min Score:          70/100
Min Liquiditeit:   $10.000
Min Holders:        50
Max Top Holder:     20%
Scan interval:      30 seconden
```

### API sleutels (optioneel maar aanbevolen)

| API | Doel | Aanvragen |
|-----|------|----------|
| Helius | Betere Solana RPC, hogere limieten | [helius.dev](https://helius.dev) |
| Birdeye | Holder tracking | [birdeye.so](https://birdeye.so) |

Beide hebben een **gratis tier** die voldoende is voor persoonlijk gebruik.

---

## 🛡️ Score Systeem

| Factor | Max Punten |
|--------|-----------|
| Volume & Buy/Sell Ratio | +30 |
| Holder groei & verdeling | +20 |
| Liquiditeit | +20 |
| Prijs momentum | +15 |
| Transactie activiteit | +10 |
| RugCheck rating | +5 |
| **Whale bezit penalty** | **-40** |
| **Veiligheidsrisico's** | **-50** |
| **Leeftijdsrisico** | **-15** |

**Koopdrempel: score ≥ 70 + veiligheidscheck groen**

---

## ⚠️ Risicowaarschuwing

- Memecoin trading is **extreem risicovol**
- Begin **altijd** met paper trading
- Investeer nooit meer dan u kunt veroorloven te verliezen
- Dit is **geen financieel advies**
- De makers zijn niet aansprakelijk voor eventuele verliezen

---

## 🔄 Updates

Na wijzigingen aan de code:
- **GitHub**: push naar main → Vercel herdeployt automatisch
- **Vercel CLI**: voer `vercel --prod` uit in de projectmap
