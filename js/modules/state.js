// ─── STATO GLOBALE ───
// Stato condiviso tra moduli. Gli array si possono mutare in-place
// (push/splice) oppure riassegnare tramite i setter esportati.

export const state = {
  listino: [],
  situazione: [],
  articoliAggiunti: [],
  autoCosti: true,
  lastTranResult: null
};

// Preferenze UI preventivo (persistite in localStorage)
export const smartSettings = {
  smartMode: false,
  showVAT: false,
  vatRate: 22,
  hideVenduto: true,
  hideDiff: true,
  hideDiscounts: true,
  showClientDiscount: false
};

// Dati tariffe trasporto caricati dai JSON in /data/
export const TRAN = {
  palletRates: null,
  groupageRates: null,
  geo: null,
  articles: [],
  loaded: false
};

// ─── SETTER ESPLICITI PER RIASSEGNAZIONI ───
export function setListino(arr) {
  state.listino = arr;
}
export function setSituazione(arr) {
  state.situazione = arr;
}
export function setArticoli(arr) {
  state.articoliAggiunti = arr;
}
export function setLastTranResult(r) {
  state.lastTranResult = r;
}
export function setAutoCosti(v) {
  state.autoCosti = !!v;
}

// ─── PERSISTENZA SMART SETTINGS ───
// La chiave è invariata rispetto a CSVXpressSmart_2026_tran per preservare
// le preferenze degli utenti installati (cfr. CLAUDE.md §6.2).
const SETTINGS_KEY = 'smart_tran_2026';

export function loadSettings() {
  try {
    const r = localStorage.getItem(SETTINGS_KEY);
    if (r) Object.assign(smartSettings, JSON.parse(r));
  } catch (_) {
    // storage non disponibile: continua con i default
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(smartSettings));
  } catch (_) {
    // storage non disponibile: silenzioso
  }
}
