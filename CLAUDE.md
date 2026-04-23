# CLAUDE.md — PROA

Memoria persistente del progetto per Claude Code. **Leggi questo file integralmente all'inizio di ogni sessione** e rispettane le regole.

---

## 1. Identità del progetto

**Nome**: PROA
**Origine**: evoluzione professionale di `CSVXpressSmart_2026_tran` (https://github.com/pezzaliapp/CSVXpressSmart_2026_tran)
**Autore**: Alessandro Pezzali — PezzaliAPP
**Licenza**: non open source. Tutti i diritti riservati. Il motore di calcolo trasporti è portato da [Trasporti-Use-Friendly](https://www.alessandropezzali.it/Trasporti-Use-Friendly/).

**Cosa fa l'app**: PWA offline-first per la gestione di preventivi commerciali e il calcolo automatico dei costi di trasporto (PALLET e GROUPAGE) su tutto il territorio italiano. Unisce in un'unica app quotazione cliente + logistica.

**Tab principali**:

1. **Listino** — caricamento CSV prezzi con persistenza IndexedDB
2. **Disponibilità** — caricamento XLSX/CSV situazione settimanale
3. **Preventivo** — composizione offerta con sconti, IVA, export WhatsApp/TXT
4. **Trasporto** — calcolo automatico costi con collegamento al preventivo

---

## 2. Stack tecnologico (invariante)

- **Vanilla JavaScript ES2022** con `'use strict'` — nessun framework (no React/Vue/Angular)
- **HTML5 + CSS3** con design system e dark mode
- **Service Worker** per offline-first (strategia network-first per JSON, cache-first per asset)
- **IndexedDB** per persistenza locale (listino, situazione, preventivo in corso)
- **localStorage** solo per preferenze UI (tema)
- **PapaParse 5.3.2** da CDN per parsing CSV
- **SheetJS 0.18.5** da CDN per parsing XLSX
- **Lingua di progetto**: italiano (codice, commenti, UI, documentazione)

**Regola assoluta**: mai introdurre un bundler pesante (Webpack, Vite in produzione), mai TypeScript, mai framework UI. L'app deve rimanere servibile da GitHub Pages come file statici. Vitest per i test è ammesso perché gira solo in dev.

---

## 3. Struttura file target (dopo modularizzazione)

```
PROA/
├── CLAUDE.md                 ← questo file
├── README.md                 ← documentazione utente
├── LICENSE
├── package.json              ← solo dev deps (lint, test, dev server)
├── .gitignore
├── .editorconfig
├── .nvmrc                    ← Node 20
├── .eslintrc.json
├── .prettierrc
├── index.html                ← app shell con 4 tab
├── manifest.json             ← PWA manifest
├── sw.js                     ← Service Worker
├── css/
│   └── style.css             ← design system + dark mode
├── js/
│   ├── main.js               ← entry point (<script type="module">)
│   └── modules/
│       ├── state.js          ← stato globale
│       ├── storage.js        ← wrapper IndexedDB
│       ├── csv-parser.js     ← parsing listino + disponibilità
│       ├── preventivo.js     ← logica tab preventivo (sconti, IVA)
│       ├── trasporto.js      ← motore calcolo PALLET + GROUPAGE
│       ├── ui-tabs.js        ← navigazione tab
│       └── exports.js        ← WhatsApp / TXT / clipboard
├── icon/
│   ├── icon-192.png
│   └── icon-512.png
├── data/                     ← tariffe aggiornabili senza toccare il codice
│   ├── pallet_rates_by_region.json
│   ├── groupage_rates.json
│   ├── geo_provinces.json
│   └── articles.json
├── tests/
│   └── *.test.js             ← Vitest + jsdom
└── .github/workflows/
    └── ci.yml                ← lint + test + deploy GitHub Pages
```

Lo stato **di partenza** era monolitico (tutto il JS in `js/app.js`, 1413 righe). La modularizzazione è la Fase 2 della roadmap.

---

## 4. Schema dei dati

### `data/pallet_rates_by_region.json`

```json
{
  "meta": {
    "regions": [...],                 // 20 regioni italiane
    "palletTypes": [...],             // 22 taglie: MINI → MEGA+30%
    "maxPalletsPerShipment": 5,       // soglia split automatico
    "preavviso_fee": 2,               // €/spedizione
    "insurance_pct": 0.03             // +3% su totale
  },
  "rates": {
    "LOMBARDIA": { "MINI": 40.0, "FULL": 86.0, ... }
  }
}
```

### `data/groupage_rates.json`

```json
{
  "meta": {
    "selection_mode": "max",          // "max" o "min" tra lm/quintali/bancali
    "insurance_pct": 0.03,
    "preavviso_fee": null,
    "liftgate_fee": null,
    "km_threshold": 30,
    "km_surcharge_per_km": 0,
    "disagiata_surcharge": 0
  },
  "provinces": {
    "TO BI VB VC": {
      "region": "PIEMONTE",
      "linearMeters": [{ "min": 0, "max": 3.0, "price": 310.0 }, ...],
      "pallets":      [{ "min": 0, "max": 7.0, "price": 310.0 }, ...],
      "quintali":     [...]
    }
  }
}
```

### `data/articles.json`

Array di articoli con regole di spedizione automatiche:

```json
{
  "code": "FT 600 HY",
  "pack": { "palletType": "FULL" },
  "rules": {
    "forceService": "GROUPAGE",
    "groupageLm": 3.0,
    "groupageQuintali": 24.6,
    "groupagePalletCount": 1,
    "noSponda": true,
    "forceQuote": true
  },
  "note": "NO SPONDA - GROUPAGE 3 MT / quotazione"
}
```

### `data/geo_provinces.json`

Mappa regione → array di sigle provincia, usata per popolare la select Province.

### Formato CSV listino atteso

```
Codice;Descrizione;PrezzoLordo;CostoTrasporto;CostoInstallazione[;PalletType]
```

Separatore `;` o `,` auto-rilevato. Encoding UTF-8 con BOM supportato. Header case-insensitive.

---

## 5. Convenzioni di codice (rispettare sempre)

- **ES Modules**: tutti i file in `js/` sono moduli ES6 (`import`/`export`). La modalità strict è **implicita** in ogni modulo ES — non è più necessario né corretto scrivere `'use strict'` in testa ai file. L'unica eccezione è `sw.js`, che è un classic script: se in futuro aggiungi altri script classici, aggiungi `'use strict'` in testa.
- Commenti in italiano, stile `// ─── SEZIONE ───`
- Nomi funzioni e variabili in italiano quando riferiti a concetti di dominio (`listino`, `articoliAggiunti`, `calcolaTrasporto`), in inglese per costrutti tecnici (`init`, `loadAssets`, `cache`)
- Niente jQuery, niente lodash: DOM API native e metodi standard
- Preferire `const`, `let` solo se serve riassegnare, mai `var`
- Async/await al posto di callback annidate
- Errori utente → mostrati in UI con elementi `.error` già stilati nel CSS, mai `alert()` tranne dove esiste già
- Log di debug con `console.debug` (non `console.log`) così si filtrano facilmente

---

## 6. Regole INVARIANTI da rispettare ad ogni modifica

1. **Service Worker**: ogni modifica a file cachati (`index.html`, `css/`, `js/`, `data/`) richiede il bump della costante `CACHE` in `sw.js` (es. `'proa-v1.2.0'`). Senza bump gli utenti installati non vedono le modifiche.
2. **IndexedDB**: mai cambiare nomi di database o object store senza scrivere una migrazione. I dati degli utenti (listini salvati, preventivi in corso) devono sopravvivere agli aggiornamenti.
3. **Offline**: ogni feature deve funzionare senza rete dopo il primo caricamento. Non introdurre chiamate a servizi esterni runtime.
4. **iOS Safari quirks**: il file input va resettato dopo ogni upload (bug del "secondo tap"). Il download su iOS deve usare apertura in nuova scheda. Questi pattern sono già nel codice, non rimuoverli.
5. **CSV robusto**: il parser deve gestire separatore `;` o `,`, BOM UTF-8, header case-insensitive, campi con virgolette e punti decimali italiani (`,` come separatore decimale da normalizzare).
6. **Dark mode**: usa variabili CSS (`--bg`, `--fg`, ecc.). Non hardcodare colori.
7. **PWA**: manifest, icone 192 e 512, theme-color, apple-touch-icon devono rimanere coerenti.

---

## 7. Note su incoerenze note del codice d'origine

Da risolvere nel corso della modernizzazione:

- `sw.js` pre-cacha i file `.json` in `install` ma poi applica strategia `networkFirst` per gli stessi: funziona (il network vince), ma è subottimale. Target in Fase 5: **stale-while-revalidate** per i JSON di tariffe → risposta istantanea dalla cache + aggiornamento in background.
- `app.js` tiene lo stato in variabili globali mutabili (`listino`, `situazione`, `articoliAggiunti`). Durante la modularizzazione Fase 2, incapsulare in un modulo `state.js` che espone getter/setter e permette di sottoscrivere ai cambi.
- Nessuna strategia di aggiornamento notificata all'utente: quando il nuovo SW prende controllo c'è un `location.reload()` automatico. Meglio un banner "Nuova versione disponibile — Ricarica".

---

## 8. Comandi utili

```bash
# Dev server locale (Fase 1 aggiungerà lo script npm)
npx serve .                      # oppure: python3 -m http.server 8000

# Una volta installato package.json:
npm install
npm run dev                      # dev server con live reload
npm run lint                     # ESLint
npm run format                   # Prettier
npm test                         # Vitest
npm run test:coverage            # coverage report
npm run build                    # (solo se servirà in futuro — ora statico)

# Git
git status
git log --oneline -10

# Deploy: push su main → GitHub Actions fa deploy automatico su GitHub Pages
# URL finale: https://pezzaliapp.github.io/PROA/
```

---

## 9. Roadmap di modernizzazione (6 fasi)

Ogni fase deve essere completata e committata prima di passare alla successiva. Commit piccoli e descrittivi (Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

### Fase 1 — Fondamenta

`package.json`, `.gitignore`, `.editorconfig`, `.nvmrc`, ESLint, Prettier, formattazione iniziale.

### Fase 2 — Modularizzazione `app.js`

Split in moduli ES6 come descritto in §3. `<script type="module">` in `index.html`. Aggiornare `sw.js` e bumpare `CACHE`. Nessun cambio di comportamento.

### Fase 3 — Testing

Vitest + jsdom. Coverage >70% sulla logica business (parser CSV, motore trasporto PALLET e GROUPAGE, calcolo sconti).

### Fase 4 — CI/CD

`.github/workflows/ci.yml`: lint + test + deploy automatico su GitHub Pages. Badge CI e coverage nel README.

### Fase 5 — Robustezza PWA

Service Worker con stale-while-revalidate per i JSON. Banner update. Script build che bumpa `CACHE` automaticamente da `package.json`.

### Fase 6 — Qualità e accessibilità

Audit axe-core, aria-label, focus tastiera. Lighthouse >90 su tutte e 4 le metriche. Meta Open Graph + Twitter Card. Zero warning console.

---

## 10. Cosa NON fare mai

- Non introdurre framework UI (React, Vue, Svelte, Angular)
- Non introdurre bundler in produzione (il deploy resta file statici)
- Non introdurre TypeScript
- Non aggiungere dipendenze CDN oltre a PapaParse e SheetJS senza motivo forte
- Non chiamare servizi esterni runtime (no tracking, no analytics esterni)
- Non committare file di dati con informazioni riservate di clienti reali
- Non rimuovere i workaround iOS Safari senza aver verificato su dispositivo
- Non toccare la logica commerciale (sconti Sc.1+Sc.2, sconto cliente equivalente, IVA) senza un test che ne preservi il comportamento

---

## 11. Quando dubiti, chiedi

Se un task sembra richiedere una violazione delle regole di questo file (es. "aggiungi React", "sposta i dati su un server"), **fermati e chiedi conferma all'autore** invece di eseguire.

---

_Ultimo aggiornamento: compilato sulla base del codice sorgente di CSVXpressSmart_2026_tran v1.0.0 al momento della migrazione a PROA._
