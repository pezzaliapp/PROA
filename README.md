# CSVXpressSmart 2026 + Trasporti

**PWA offline-first** che unisce la gestione preventivi/ordini di CSVXpressSmart con il motore di calcolo costi trasporto di [Trasporti-Use-Friendly](https://www.alessandropezzali.it/Trasporti-Use-Friendly/).

> Motore di calcolo trasporti © Alessandro Pezzali – PezzaliAPP. Uso riservato all'autore.

---

## Struttura del progetto

```
CSVXpressSmart_2026_tran/
├── index.html              ← App shell (4 tab)
├── manifest.json           ← PWA manifest
├── sw.js                   ← Service Worker (offline-first)
├── css/
│   └── style.css           ← Design system completo + dark mode
├── js/
│   └── app.js              ← Tutta la logica (preventivi + trasporto)
├── icon/
│   ├── icon-192.png
│   └── icon-512.png
└── data/                   ← Tariffe e articoli (aggiornabili senza toccare il codice)
    ├── pallet_rates_by_region.json
    ├── groupage_rates.json
    ├── geo_provinces.json
    └── articles.json           ← Articoli con palletType e regole automatiche
```

---

## Funzionalità per tab

### 📋 Tab Listino
Carica il listino prezzi in formato CSV con le colonne:
```
Codice;Descrizione;PrezzoLordo;CostoTrasporto;CostoInstallazione
```
- Separatore auto-rilevato (`;` o `,`)
- Encoding UTF-8 (con BOM supportato)
- Memoria persistente in IndexedDB — il listino sopravvive alla chiusura del browser
- Contatore articoli caricati

### 📦 Tab Disponibilità
Carica la **Situazione Settimanale** in formato `.xlsx` o `.csv`:
- Parser auto-rileva le righe header (struttura a 3 righe come da file standard)
- Colonne lette: Codice, Descrizione, Disponibilità, Arrivi (Sett.15 / Sett.18 / Maggio / Giugno), Note, Prenotazioni
- Filtri rapidi: tutti / disponibili / esauriti / in arrivo / con note
- Export CSV della vista filtrata
- Memoria persistente (IndexedDB)

### 🧾 Tab Preventivo
- Ricerca articolo dal listino con badge disponibilità in tempo reale
- Aggiunta manuale articoli
- Titolo / Cliente configurabile (incluso nel report)
- Tabella con: sconti (Sc.1%, Sc.2%), sconto cliente equivalente, sconto ulteriore, netto/cad, trasporto, installazione, quantità, totale riga, venduto, differenza
- Riordino righe (↑ ↓)
- Modalità Cliente (nasconde margini nel report)
- Modalità Sconto Cliente (calcola automaticamente lo sconto equivalente a Sc.1+Sc.2+margine)
- IVA configurabile (default 22%)
- Autosave in IndexedDB — il preventivo viene ripristinato alla riapertura
- Export: WhatsApp, TXT, Copia negli appunti (versioni con e senza margine)

### 🚚 Tab Trasporto
Calcolo automatico costi trasporto con gli stessi dati e la stessa logica dell'app [Trasporti-Use-Friendly](https://www.alessandropezzali.it/Trasporti-Use-Friendly/).

#### Servizio PALLET
- Tariffa per **Regione** × **Tipo bancale** (22 taglie: MINI → MEGA+30%)
- 20 regioni italiane coperte
- Split automatico se quantità > 5 (massimo bancali per spedizione)
- Preavviso telefonico: +€2/spedizione

#### Servizio GROUPAGE
- Tariffa per **Provincia** (49 gruppi province coperti)
- Scaglioni su: Metri lineari / Quintali / N° bancali
- Selezione tariffa: `max` tra i parametri forniti (configurabile via JSON → `selection_mode`)
- Overflow oltre l'ultima fascia: stima a cap + avviso

#### Opzioni comuni
| Opzione | Effetto |
|---|---|
| Preavviso telefonico | +€2/spedizione (PALLET) o fisso (GROUPAGE, se configurato) |
| Assicurazione | +3% sul totale |
| Sponda | Aggiunta fisso se configurata nel JSON |
| Km oltre capoluogo | Info + eventuale supplemento (configurabile) |
| Disagiata / ZTL | Avviso + eventuale supplemento (configurabile) |

#### Collegamento automatico con il Preventivo
1. Aggiungi articoli nel tab Preventivo
2. Vai al tab Trasporto → sezione **"Collega articolo dal preventivo"**
3. Seleziona l'articolo e clicca **Applica dati** → l'app imposta automaticamente:
   - **Servizio** (PALLET o GROUPAGE) — da `articles.json` rules
   - **Taglia bancale** — da `articles.json` `pack.palletType` o colonna `PalletType` nel CSV
   - **LM / Quintali / N° bancali** — da `articles.json` rules (per articoli GROUPAGE)
   - **Sponda disabilitata** — se l'articolo ha `noSponda: true`
   - **Avviso quotazione** — se l'articolo ha `forceQuote: true`
   - **Quantità** — dalla riga del preventivo
4. Seleziona **Regione** (sempre obbligatoria) e **Provincia** (solo per GROUPAGE)
5. Clicca **Calcola Trasporto**
6. Clicca **➕ Aggiungi al Preventivo** → riga trasporto inserita, torna al tab Preventivo

---

## Dataset tariffe

I file JSON nella cartella `/data/` sono gli stessi dell'app Trasporti-Use-Friendly e possono essere aggiornati indipendentemente dal codice.

### `data/pallet_rates_by_region.json`
```json
{
  "meta": {
    "regions": [...],           // 20 regioni
    "palletTypes": [...],        // 22 tipi bancale
    "maxPalletsPerShipment": 5,  // split oltre questa soglia
    "preavviso_fee": 2,          // € per spedizione
    "insurance_pct": 0.03        // 3%
  },
  "rates": {
    "LOMBARDIA": { "MINI": 40.0, "FULL": 86.0, ... },
    ...
  }
}
```

### `data/groupage_rates.json`
```json
{
  "meta": {
    "selection_mode": "max",     // "max" o "min" tra LM/quintali/bancali
    "insurance_pct": 0.03,
    "preavviso_fee": null,        // null = non applicato
    "liftgate_fee": null,         // null = sponda non applicata
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
    },
    ...
  }
}
```

### `data/articles.json`
Elenco articoli con tipo bancale e regole di spedizione (stesso file dell'app Trasporti-Use-Friendly):
```json
[
  {
    "id": "...",
    "code": "PUMA",
    "name": "PUMA",
    "pack": { "palletType": "LIGHT" },
    "rules": {},
    "note": ""
  },
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
]
```
Campi rilevanti:
- `pack.palletType` — taglia bancale (auto-fill nel calcolo PALLET)
- `rules.forceService` — se `"GROUPAGE"`, forza automaticamente il servizio
- `rules.groupageLm/groupageQuintali/groupagePalletCount` — parametri auto-fill per Groupage
- `rules.noSponda` — disabilita la checkbox Sponda
- `rules.forceQuote` — mostra avviso "quotazione/preventivo consigliato"

### `data/geo_provinces.json`
```json
{
  "LOMBARDIA": ["MI", "BG", "BS", "CO", ...],
  ...
}
```
Usato per popolare la select Province in base alla Regione selezionata.

---

## Come aggiornare le tariffe

Modifica i file JSON nella cartella `/data/` senza toccare `app.js`:

- **Nuova tariffa PALLET**: aggiungi/modifica i valori in `rates.REGIONE.TIPO_BANCALE`
- **Nuovo tipo bancale**: aggiungi la chiave in `meta.palletTypes` e in ogni regione di `rates`
- **Nuova fascia Groupage**: aggiungi un oggetto `{ "min": X, "max": Y, "price": Z }` nell'array corrispondente
- **Attivare la sponda Groupage**: imposta `"liftgate_fee": 25.0` in `groupage_rates.meta`
- **Attivare supplemento km**: imposta `"km_surcharge_per_km": 1.5` in `groupage_rates.meta`

Dopo ogni modifica, bumpa la versione della cache in `sw.js` (costante `CACHE`) per forzare l'aggiornamento su tutti i dispositivi.

---

## PWA / Offline / Auto-update

- Registra `sw.js` per cache offline (network-first per JSON, per aggiornamenti immediati delle tariffe)
- All'avvio forza `reg.update()` — se c'è una nuova versione, la scarica in background
- Quando il nuovo SW prende controllo → ricarica automatica (anti-loop via `sessionStorage`)
- Installabile su iOS (Aggiungi a schermo Home) e Android

---

## Deploy

```bash
# Crea il repo su GitHub: CSVXpressSmart_2026_tran
git init
git add .
git commit -m "CSVXpressSmart 2026 + Trasporti v1.0.0"
git remote add origin https://github.com/TUO_USER/CSVXpressSmart_2026_tran.git
git push -u origin main
# Abilita GitHub Pages → Settings → Pages → /main root
```

L'app sarà disponibile su `https://TUO_USER.github.io/CSVXpressSmart_2026_tran/`

---

## Formato CSV Listino

### Colonne obbligatorie
```csv
Codice;Descrizione;PrezzoLordo;CostoTrasporto;CostoInstallazione
00100208;PUMA CE 1ph 230V;17000;390;320
00100210;CM 1200BB CE 1ph;22200;390;320
```

### Colonna opzionale PalletType (raccomandata)
Aggiungendo la colonna `PalletType` al CSV, quando colleghi un articolo nel tab Trasporto la taglia bancale viene impostata **automaticamente**:

```csv
Codice;Descrizione;PrezzoLordo;CostoTrasporto;CostoInstallazione;PalletType
00100208;PUMA CE 1ph 230V;17000;390;320;FULL
00100210;CM 1200BB CE 1ph;22200;390;320;MEGA + 10%
00100299;F 26A BIKE NERO;3880;250;240;HALF
```

Valori ammessi per `PalletType` (devono corrispondere esattamente alle chiavi del listino tariffe):
```
MINI · QUARTER · QUARTER + 50% · HALF · HALF + 50%
MEDIUM · MEDIUM + 10% · MEDIUM + 30% · MEDIUM + 80%
LIGHT · LIGHT + 10% · LIGHT + 50%
LARGE · LARGE + 10% · LARGE + 80%
FULL · FULL + 10%
BIG · BIG + 10%
MEGA · MEGA + 10% · MEGA + 30%
```

Se la colonna è assente o il valore non è riconosciuto, l'app mostra un avviso e la taglia va selezionata manualmente dal menu.

### Regole formato
- Separatore: `;` (punto e virgola) oppure `,` (auto-rilevato)
- Encoding: UTF-8 (anche con BOM)
- Prima riga: intestazioni (obbligatorie, case-insensitive)
- `CostoTrasporto` e `CostoInstallazione`: se presenti vengono pre-compilati nella tabella preventivo

---

## Note tecniche

- **Nessuna dipendenza server** — tutto gira lato client
- **IndexedDB** per persistenza locale (listino, situazione settimanale, preventivo in corso)
- **PapaParse 5.3.2** (CDN) per parsing CSV
- **SheetJS 0.18.5** (CDN) per lettura XLSX
- **Dark mode** automatica + toggle manuale, preferenza salvata in localStorage
- **iOS Safari**: file input resettato dopo ogni caricamento (fix per il bug del secondo tap)
- **Download su iOS**: apre in nuova scheda con istruzioni "Condividi → Salva in File"

---

## Licenza

### CSVXpressSmart (codice preventivi / disponibilità / UI)
© Alessandro Pezzali – PezzaliAPP. Tutti i diritti riservati. Uso riservato all'autore.

### Motore di calcolo trasporti
© Alessandro Pezzali – PezzaliAPP — portato da [Trasporti-Use-Friendly](https://www.alessandropezzali.it/Trasporti-Use-Friendly/). Uso riservato all'autore.

Questo progetto **non è open source**. La disponibilità del codice non costituisce concessione di licenza.  
Per richieste di utilizzo contattare direttamente l'autore.
