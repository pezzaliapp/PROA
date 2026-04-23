// ═══════════════════════════════════════════════════════════
// MOTORE TRASPORTO
// Portato da app.js di Trasporti-Use-Friendly
// © Alessandro Pezzali – PezzaliAPP (alessandropezzali.it)
// ═══════════════════════════════════════════════════════════

import { state, TRAN, setLastTranResult } from './state.js';
import {
  round2,
  fmtEur,
  moneyEUR,
  today,
  $id,
  $val,
  $setVal,
  $setText,
  esc,
  showToast
} from './utils.js';
import {
  renderTabellaArticoli,
  aggiornaTotali,
  updateEquivDiscount,
  salvaPreventivo
} from './preventivo.js';

// ══════════════ CARICAMENTO DATI ══════════════

async function loadTranData() {
  const statusEl = $id('tranDataStatus');
  const errEl = $id('tranDataError');
  try {
    const [palletRates, groupageRates, geo, articles] = await Promise.all([
      fetch('data/pallet_rates_by_region.json', { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error('pallet_rates');
        return r.json();
      }),
      fetch('data/groupage_rates.json', { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error('groupage_rates');
        return r.json();
      }),
      fetch('data/geo_provinces.json', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch('data/articles.json', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    ]);
    TRAN.palletRates = palletRates;
    TRAN.groupageRates = groupageRates;
    TRAN.geo = geo;
    TRAN.articles = Array.isArray(articles) ? articles : [];
    TRAN.loaded = true;

    if (statusEl) {
      statusEl.textContent =
        '✅ Tariffe caricate: ' +
        Object.keys(palletRates.rates || {}).length +
        ' regioni PALLET · ' +
        Object.keys(groupageRates.provinces || {}).length +
        ' gruppi Groupage · ' +
        TRAN.articles.length +
        ' articoli';
      statusEl.style.display = 'block';
    }
    if (errEl) errEl.style.display = 'none';

    populateTranSelects();
    updateTranServiceUI();
    updateTranDebug();
  } catch (err) {
    console.error('loadTranData:', err);
    if (errEl) {
      errEl.textContent =
        '❌ Errore caricamento tariffe: ' +
        err.message +
        '. Verifica che i file JSON siano nella cartella /data/';
      errEl.style.display = 'block';
    }
    if (statusEl) statusEl.style.display = 'none';
  }
}

function populateTranSelects() {
  // Regioni (da palletRates)
  const regionSel = $id('tranRegion');
  if (!regionSel) return;
  regionSel.innerHTML = '<option value="">— Seleziona Regione —</option>';
  const regions = TRAN.palletRates?.meta?.regions || Object.keys(TRAN.palletRates?.rates || {});
  regions.forEach((r) => {
    const o = document.createElement('option');
    o.value = r;
    o.textContent = r;
    regionSel.appendChild(o);
  });

  // Tipi bancale (da palletRates)
  const palletSel = $id('tranPalletType');
  if (palletSel) {
    palletSel.innerHTML = '<option value="">— Tipo bancale —</option>';
    const types = TRAN.palletRates?.meta?.palletTypes || [];
    types.forEach((t) => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      palletSel.appendChild(o);
    });
  }

  // Province inizialmente vuote (popolate on region change)
  updateTranProvinces('');
}

function updateTranProvinces(region) {
  const sel = $id('tranProvince');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Seleziona Provincia —</option>';
  if (!region) return;

  // Usa geo_provinces.json se disponibile
  let provinces = [];
  if (TRAN.geo && TRAN.geo[region]) {
    provinces = TRAN.geo[region];
  } else {
    // Fallback: ricava le province dai gruppi groupage
    const seen = new Set();
    Object.keys(TRAN.groupageRates?.provinces || {}).forEach((grp) => {
      grp.split(/[\s,/\-]+/).forEach((p) => {
        p = p.trim();
        if (p.length === 2) seen.add(p);
      });
    });
    provinces = [...seen].sort();
  }

  provinces.forEach((p) => {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    sel.appendChild(o);
  });
}

function updateTranServiceUI() {
  const svc = $val('tranService');
  const isPallet = svc === 'PALLET';
  const show = (id, yes) => {
    const e = $id(id);
    if (e) e.style.display = yes ? '' : 'none';
  };
  show('tranPalletTypeField', isPallet);
  show('tranQtyField', isPallet); // qty bancali: solo per PALLET
  show('tranProvinceField', !isPallet);
  show('tranLmField', !isPallet);
  show('tranQuintaliField', !isPallet);
  show('tranPalletCountField', !isPallet);
}

function updateTranDebug() {
  const el = $id('tranDebug');
  if (!el) return;
  if (!TRAN.loaded) {
    el.textContent = '—';
    return;
  }
  const regionCount = Object.keys(TRAN.palletRates?.rates || {}).length;
  const groupCount = Object.keys(TRAN.groupageRates?.provinces || {}).length;
  el.innerHTML =
    '<b>PALLET:</b> ' +
    regionCount +
    ' regioni | ' +
    '<b>Groupage:</b> ' +
    groupCount +
    ' gruppi province | ' +
    '' +
    '<b>Assicurazione:</b> ' +
    (TRAN.palletRates?.meta?.insurance_pct * 100 || 3) +
    '%';
}

// ══════════════ LOGICA CALCOLO ══════════════
// Portata da app.js Trasporti-Use-Friendly

export function normalizeProvince(p) {
  const x = (p || '').trim().toUpperCase();
  if (x === 'SU') return 'CI';
  return x;
}

export function resolveGroupageProvinceKey(rawProvince) {
  const province = normalizeProvince(rawProvince);
  if (!province || !TRAN.groupageRates?.provinces) return null;
  const provinces = TRAN.groupageRates.provinces;

  // 1) corrispondenza esatta con chiave singola
  if (provinces[province]) return { key: province, data: provinces[province], matchedBy: 'exact' };

  // 2) cerca nel gruppo per token di 2 lettere (es. "TO BI VB VC", "MT / PZ")
  for (const [key, data] of Object.entries(provinces)) {
    const tokens = key
      .split(/[\s,/\-;]+/)
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length === 2 && /^[A-Z]{2}$/.test(t));
    if (tokens.includes(province)) return { key, data, matchedBy: 'group' };
  }

  // 3) fallback per regione: usa il campo "region" della chiave groupage
  // Necessario per province come CA/SS/NU/OR/SU (Sardegna → chiave "TUTTE")
  // e per qualsiasi altra provincia coperta da una chiave regionale
  if (TRAN.geo) {
    // Trova la regione della provincia tramite geo_provinces.json
    let provRegion = null;
    const rawUp = (rawProvince || '').trim().toUpperCase();
    for (const [reg, provs] of Object.entries(TRAN.geo)) {
      if (provs.includes(rawUp) || provs.includes(province)) {
        provRegion = reg;
        break;
      }
    }
    if (provRegion) {
      for (const [key, data] of Object.entries(provinces)) {
        const dr = (data.region || '').toUpperCase();
        // match esatto o parziale (es "EMILIA R." vs "EMILIA + SAN MARINO")
        if (
          dr &&
          (dr === provRegion.toUpperCase() ||
            provRegion.toUpperCase().startsWith(dr.replace(/[^A-Z]/g, '').slice(0, 5)))
        ) {
          return { key, data, matchedBy: 'region_fallback', region: provRegion };
        }
      }
    }
  }

  return null;
}

export function matchGroupageBracket(value, brackets) {
  if (!Array.isArray(brackets) || brackets.length === 0) return { bracket: null, overflow: false };
  const bs = brackets.slice().sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
  for (const b of bs) {
    const okMin = value >= (b.min ?? 0);
    const okMax = b.max == null ? true : value <= b.max;
    if (okMin && okMax) return { bracket: b, overflow: false };
  }
  return { bracket: bs[bs.length - 1], overflow: true };
}

export function applyKmAndDisagiata({ base, shipments, opts, rules, alerts, mode }) {
  const kmThreshold = TRAN.groupageRates?.meta?.km_threshold ?? 30;
  const kmSurcharge = TRAN.groupageRates?.meta?.km_surcharge_per_km ?? 0;
  const disFee = TRAN.groupageRates?.meta?.disagiata_surcharge ?? 0;
  const kmOver = Math.max(0, parseInt(opts?.kmOver || 0, 10) || 0);

  if (kmOver > 0) {
    alerts.push(
      'Distanza extra: +' + kmOver + ' km (oltre ' + kmThreshold + ' km). Verificare condizioni.'
    );
    if (kmSurcharge > 0) {
      base += kmOver * kmSurcharge * (mode === 'PALLET' ? shipments : 1);
      rules.push('km+' + kmOver);
    }
  }
  if (opts?.disagiata) {
    alerts.push('Località disagiata: possibile extra / preventivo.');
    if (disFee > 0) {
      base += disFee * (mode === 'PALLET' ? shipments : 1);
      rules.push('disagiata');
    } else {
      rules.push('disagiata(info)');
    }
  }
  return base;
}

export function computePallet({ region, palletType, qty, opts }) {
  const rules = [];
  const alerts = [];
  if (!region) return { cost: null, rules: ['Manca regione'], alerts: ['Seleziona una regione.'] };
  if (!palletType) {
    return { cost: null, rules: ['Manca tipo bancale'], alerts: ['Seleziona il tipo bancale.'] };
  }
  const rate = TRAN.palletRates?.rates?.[region]?.[palletType];
  if (rate == null) {
    return {
      cost: null,
      rules: ['Tariffa non trovata'],
      alerts: ['Nessuna tariffa per ' + region + ' / ' + palletType + '.']
    };
  }
  const maxPerShipment = TRAN.palletRates?.meta?.maxPalletsPerShipment ?? 5;
  const shipments = Math.ceil(qty / maxPerShipment);
  if (shipments > 1) {
    rules.push('split:' + shipments);
    alerts.push('Qty > ' + maxPerShipment + ': ' + shipments + ' spedizioni (stima).');
  }
  let base = rate * qty;
  if (opts.preavviso && TRAN.palletRates?.meta?.preavviso_fee != null) {
    base += TRAN.palletRates.meta.preavviso_fee * shipments;
    rules.push('preavviso');
  }
  if (opts.assicurazione && TRAN.palletRates?.meta?.insurance_pct != null) {
    base = base * (1 + TRAN.palletRates.meta.insurance_pct);
    rules.push('assicurazione');
  }
  base = applyKmAndDisagiata({ base, shipments, opts, rules, alerts, mode: 'PALLET' });
  return { cost: round2(base), rules, alerts };
}

export function computeGroupage({ province, lm, quintali, palletCount, opts }) {
  const rules = [];
  const alerts = [];
  if (!province) {
    return { cost: null, rules: ['Manca provincia'], alerts: ['Seleziona una provincia.'] };
  }
  const resolved = resolveGroupageProvinceKey(province);
  if (!resolved) {
    return {
      cost: null,
      rules: ['Provincia non trovata'],
      alerts: ['Nessuna tariffa groupage per ' + province + '.']
    };
  }
  const p = resolved.data;
  if (resolved.matchedBy === 'group') {
    rules.push('provGroup:' + resolved.key);
    alerts.push('Provincia ' + province + ' → gruppo: ' + resolved.key);
  }
  const candidates = [];
  let overflow = false;
  if (lm > 0 && Array.isArray(p.linearMeters)) {
    const r = matchGroupageBracket(lm, p.linearMeters);
    if (r.bracket && r.bracket.price != null) {
      candidates.push({ mode: 'lm', price: r.bracket.price, overflow: r.overflow });
      if (r.overflow) overflow = true;
    }
  }
  if (quintali > 0 && Array.isArray(p.quintali)) {
    const r = matchGroupageBracket(quintali, p.quintali);
    if (r.bracket && r.bracket.price != null) {
      candidates.push({ mode: 'quintali', price: r.bracket.price, overflow: r.overflow });
      if (r.overflow) overflow = true;
    }
  }
  if (palletCount > 0 && Array.isArray(p.pallets)) {
    const r = matchGroupageBracket(palletCount, p.pallets);
    if (r.bracket && r.bracket.price != null) {
      candidates.push({ mode: 'pallets', price: r.bracket.price, overflow: r.overflow });
      if (r.overflow) overflow = true;
    }
  }
  if (overflow) {
    alerts.push('Valori oltre fascia listino: stima a cap (consigliato preventivo).');
    rules.push('overflow');
  }
  if (candidates.length === 0) {
    return {
      cost: null,
      rules: ['Nessun parametro valido'],
      alerts: ['Inserisci almeno uno tra LM / Quintali / N° bancali.']
    };
  }
  const selMode = (TRAN.groupageRates?.meta?.selection_mode || 'max').toLowerCase();
  let picked;
  if (selMode === 'min') {
    picked = candidates.reduce((b, c) => (b == null || c.price < b.price ? c : b), null);
    rules.push('pick:min:' + picked.mode);
  } else {
    picked = candidates.reduce((w, c) => (w == null || c.price > w.price ? c : w), null);
    rules.push('pick:max:' + picked.mode);
  }
  let base = picked.price;
  if (opts.sponda && TRAN.groupageRates?.meta?.liftgate_fee != null) {
    base += TRAN.groupageRates.meta.liftgate_fee;
    rules.push('sponda');
  }
  if (opts.preavviso && TRAN.groupageRates?.meta?.preavviso_fee != null) {
    base += TRAN.groupageRates.meta.preavviso_fee;
    rules.push('preavviso');
  }
  if (opts.assicurazione && TRAN.groupageRates?.meta?.insurance_pct != null) {
    base = base * (1 + TRAN.groupageRates.meta.insurance_pct);
    rules.push('assicurazione');
  }
  base = applyKmAndDisagiata({ base, shipments: 1, opts, rules, alerts, mode: 'GROUPAGE' });
  return { cost: round2(base), rules, alerts };
}

// ══════════════ AZIONE CALCOLA TRASPORTO ══════════════

function onTranCalc() {
  if (!TRAN.loaded) {
    showToast('⚠️ Dati tariffe non ancora caricati', 3000);
    return;
  }
  // Se c'è un articolo selezionato non ancora applicato, applicalo ora
  const linkIdx = parseInt($val('tranLinkArticle'));
  if (!isNaN(linkIdx) && state.articoliAggiunti[linkIdx]) {
    applyTranFromArticolo_byIdx(linkIdx);
  }

  const svc = $val('tranService');
  const region = ($val('tranRegion') || '').trim().toUpperCase();
  const province = normalizeProvince($val('tranProvince'));
  const palletType = ($val('tranPalletType') || '').trim();
  const qty = Math.max(1, parseInt($val('tranQty') || '1', 10));
  const lm = parseFloat($val('tranLm') || '0') || 0;
  const quintali = parseFloat($val('tranQuintali') || '0') || 0;
  const palletCount = parseFloat($val('tranPalletCount') || '0') || 0;
  const kmOver = parseInt($val('tranKmOver') || '0', 10) || 0;
  const opts = {
    preavviso: !!$id('tranPreavviso')?.checked,
    assicurazione: !!$id('tranAssicurazione')?.checked,
    sponda: !!$id('tranSponda')?.checked,
    disagiata: !!$id('tranDisagiata')?.checked,
    kmOver
  };

  let out;
  if (svc === 'PALLET') out = computePallet({ region, palletType, qty, opts });
  else out = computeGroupage({ province, lm, quintali, palletCount, opts });

  // Costo + markup 30% (come nell'app originale)
  const costBase = out.cost;
  const costCliente = Number.isFinite(costBase) ? round2(costBase * 1.3) : null;

  setLastTranResult({
    svc,
    region,
    province,
    palletType,
    qty,
    lm,
    quintali,
    palletCount,
    opts,
    out,
    costBase,
    costCliente
  });

  // Render risultato
  const resultCard = $id('tranResultCard');
  if (resultCard) resultCard.style.display = 'block';
  $id('tranCostValue').textContent = moneyEUR(costCliente);
  $id('tranCostBase').textContent = Number.isFinite(costBase)
    ? 'Base (no markup): ' + fmtEur(costBase)
    : '';

  // Riepilogo
  const lines = [];
  lines.push('Servizio: ' + svc);
  if (svc === 'PALLET') {
    lines.push('Regione: ' + (region || '—'));
    lines.push('Bancale: ' + (palletType || '—'));
    lines.push('Quantità: ' + qty);
  } else {
    lines.push('Provincia: ' + province);
    if (lm) lines.push('LM: ' + lm);
    if (quintali) lines.push('Quintali: ' + quintali);
    if (palletCount) lines.push('N° bancali: ' + palletCount);
  }
  if (kmOver) lines.push('Km extra: ' + kmOver);
  const optsArr = [];
  if (opts.disagiata) optsArr.push('disagiata');
  if (opts.preavviso) optsArr.push('preavviso');
  if (opts.assicurazione) optsArr.push('assicurazione');
  if (opts.sponda) optsArr.push('sponda');
  if (optsArr.length) lines.push('Opzioni: ' + optsArr.join(', '));
  if (out.rules?.length) lines.push('Regole: ' + out.rules.join(' | '));
  lines.push('');
  lines.push('COSTO PREVENTIVATO: ' + moneyEUR(costCliente));
  const extraNote = $val('tranNoteExtra');
  if (extraNote) lines.push('Note: ' + extraNote);
  $id('tranSummary').textContent = lines.join('\n');

  // Alert
  const alertsEl = $id('tranAlerts');
  alertsEl.innerHTML = '';
  (out.alerts || []).forEach((a) => {
    const d = document.createElement('div');
    d.className = 'tran-alert';
    d.textContent = '⚠️ ' + a;
    alertsEl.appendChild(d);
  });
  if (!Number.isFinite(costBase)) {
    const d = document.createElement('div');
    d.className = 'tran-alert danger';
    d.textContent = '❌ Impossibile calcolare: ' + (out.alerts || []).join(' ');
    alertsEl.appendChild(d);
  }

  // Abilita pulsante aggiungi al preventivo
  const addBtn = $id('btnTranAddToPreventivo');
  if (addBtn) addBtn.disabled = !Number.isFinite(costCliente);

  resultCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ══════════════ COLLEGA ARTICOLO DAL PREVENTIVO ══════════════

export function refreshTranLinkSelect() {
  // Aggiorna select singolo
  const sel = $id('tranLinkArticle');
  if (sel) {
    sel.innerHTML = '<option value="">— Seleziona articolo dal preventivo —</option>';
    state.articoliAggiunti.forEach((a, idx) => {
      const o = document.createElement('option');
      o.value = idx;
      o.textContent =
        idx +
        1 +
        '. ' +
        a.codice +
        ' — ' +
        a.descrizione +
        (a.quantita > 1 ? ' (×' + a.quantita + ')' : '');
      sel.appendChild(o);
    });
  }
  // Aggiorna lista multi se visibile
  if ($id('tranModeMulti')?.checked) refreshTranMultiList();

  $setText(
    'tranLinkInfo',
    state.articoliAggiunti.length ? '' : 'Aggiungi prima articoli nel tab Preventivo.'
  );
}

// ─── Normalizzazione per match articolo (identica a Trasporti-Use-Friendly) ───
function normCode(s) {
  return (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Cerca in TRAN.articles l'articolo che corrisponde al codice o descrizione
 * del preventivo. Strategia (in ordine):
 * 1. match esatto codice (normalizzato)
 * 2. codice CSV contenuto nel code articolo o viceversa
 * 3. nome articolo contenuto nella descrizione CSV o viceversa
 */
function findTranArticle(codice, descrizione) {
  if (!TRAN.articles.length) return null;
  const nc = normCode(codice);
  const nd = normCode(descrizione);

  // 1) codice esatto
  let found = TRAN.articles.find((a) => normCode(a.code || '') === nc);
  if (found) return found;

  // 2) codice parziale
  found = TRAN.articles.find((a) => {
    const ac = normCode(a.code || '');
    return ac && (ac.includes(nc) || nc.includes(ac));
  });
  if (found) return found;

  // 3) nome nella descrizione
  found = TRAN.articles.find((a) => {
    const an = normCode(a.name || '');
    return an.length > 3 && (an.includes(nd) || nd.includes(an));
  });
  return found || null;
}

// ─── MULTI-ARTICOLO: aggiorna lista checkbox ───
function refreshTranMultiList() {
  const container = $id('tranMultiCheckList');
  if (!container) return;
  container.innerHTML = '';
  if (!state.articoliAggiunti.length) {
    container.innerHTML = '<p class="muted small">Aggiungi prima articoli nel tab Preventivo.</p>';
    return;
  }
  state.articoliAggiunti.forEach((a, idx) => {
    const div = document.createElement('div');
    div.className = 'tran-multi-item';
    div.dataset.idx = idx;
    div.innerHTML =
      '<input type="checkbox" id="tranMultiChk' +
      idx +
      '" value="' +
      idx +
      '"/>' +
      '<label for="tranMultiChk' +
      idx +
      '" style="cursor:pointer;flex:1">' +
      '<strong>' +
      esc(a.codice) +
      '</strong> — ' +
      esc(a.descrizione) +
      (a.quantita > 1 ? ' <span class="muted">(×' + a.quantita + ')</span>' : '') +
      '</label>';
    // click su tutta la riga seleziona il checkbox
    div.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const chk = div.querySelector('input[type="checkbox"]');
      if (chk) {
        chk.checked = !chk.checked;
        div.classList.toggle('selected', chk.checked);
      }
    });
    div.querySelector('input').addEventListener('change', (e) => {
      div.classList.toggle('selected', e.target.checked);
    });
    container.appendChild(div);
  });
}

// ─── MULTI-ARTICOLO: cerca combinazione in articles.json ───
function cercaCombinazione() {
  // Raccoglie gli articoli selezionati
  const checked = [
    ...document.querySelectorAll('#tranMultiCheckList input[type="checkbox"]:checked')
  ]
    .map((c) => parseInt(c.value))
    .filter((i) => !isNaN(i) && state.articoliAggiunti[i]);

  if (checked.length === 0) {
    showToast('⚠️ Seleziona almeno un articolo');
    return;
  }

  const selItems = checked.map((i) => state.articoliAggiunti[i]);
  const selNorms = selItems.map((a) => ({
    orig: a,
    n: normCode(a.codice) + ' ' + normCode(a.descrizione)
  }));

  const resultCard = $id('tranComboResult');
  const titleEl = $id('tranComboTitle');
  const optionsEl = $id('tranComboOptions');
  const manualEl = $id('tranComboManual');
  if (!resultCard) return;

  resultCard.style.display = 'block';
  optionsEl.innerHTML = '';

  // Se articolo singolo: usa logica normale
  if (checked.length === 1) {
    applyTranFromArticolo_byIdx(checked[0]);
    resultCard.style.display = 'none';
    return;
  }

  // ─── Costruisce le query di ricerca ───
  // Per ogni combinazione in articles.json, calcola quante parti matchano
  const results = [];

  TRAN.articles.forEach((art) => {
    const artName = art.name || '';
    // Scompone il nome in parti (split su +)
    const artParts = artName
      .split('+')
      .map((p) => normCode(p.trim()))
      .filter(Boolean);
    if (artParts.length < 2) return; // solo combinazioni

    // Conta quanti articoli selezionati matchano le parti
    let matchedParts = 0;
    const matchDetail = [];

    artParts.forEach((ap) => {
      const matchedItem = selNorms.find(
        (sn) => sn.n.includes(ap) || ap.includes(normCode(sn.orig.descrizione))
      );
      if (matchedItem) {
        matchedParts++;
        matchDetail.push({ part: ap, item: matchedItem.orig });
      }
    });

    const score = matchedParts / artParts.length;
    if (score > 0) {
      results.push({
        art,
        artParts,
        matchedParts,
        totalParts: artParts.length,
        score,
        matchDetail
      });
    }
  });

  // Ordina per score desc
  results.sort((a, b) => b.score - a.score || b.matchedParts - a.matchedParts);

  const topResults = results.slice(0, 5);
  const nomiSel = selItems.map((a) => a.descrizione).join(' + ');

  if (topResults.length === 0) {
    // Nessuna combinazione trovata → mostra selezione manuale
    titleEl.textContent = 'Nessuna combinazione trovata per: ' + nomiSel;
    titleEl.style.color = 'var(--warning)';
    optionsEl.innerHTML =
      '<p class="muted small">Nessuna combinazione corrispondente in archivio. Seleziona la taglia bancale manualmente:</p>';
    manualEl.style.display = 'block';
    populateComboPalletTypeSelect();
    $setText('tranLinkInfo', 'Combinazione non in archivio — seleziona taglia manualmente');
    return;
  }

  // Match esatto (score=1): applica subito
  const exact = topResults.find((r) => r.score === 1);
  if (exact) {
    titleEl.textContent = '✅ Combinazione trovata: ' + exact.art.name;
    titleEl.style.color = 'var(--tran)';
    optionsEl.innerHTML = '';
    manualEl.style.display = 'none';
    applyTranArticleData(exact.art, selItems);
    // Mostra anche il risultato visivo
    const div = document.createElement('div');
    div.className = 'tran-combo-option exact';
    div.innerHTML =
      '<span class="combo-name">' +
      esc(exact.art.name) +
      '</span>' +
      '<span class="combo-pallet">' +
      esc(exact.art.pack?.palletType || '—') +
      '</span>';
    optionsEl.appendChild(div);
    return;
  }

  // Risultati parziali: mostra opzioni cliccabili
  titleEl.textContent = 'Combinazioni simili trovate — scegli quella corretta:';
  titleEl.style.color = 'var(--warning)';
  manualEl.style.display = 'block';
  populateComboPalletTypeSelect();

  topResults.forEach((r) => {
    const pct = Math.round(r.score * 100);
    const div = document.createElement('div');
    div.className = 'tran-combo-option';
    div.innerHTML =
      '<span>' +
      '<span class="combo-name">' +
      esc(r.art.name) +
      '</span>' +
      '<span class="combo-match"> (' +
      pct +
      '% corrispondente)</span>' +
      '</span>' +
      '<span class="combo-pallet">' +
      esc(r.art.pack?.palletType || '—') +
      '</span>';
    div.addEventListener('click', () => {
      // Evidenzia la scelta
      document.querySelectorAll('.tran-combo-option').forEach((el) => el.classList.remove('exact'));
      div.classList.add('exact');
      applyTranArticleData(r.art, selItems);
      titleEl.textContent = '✅ Applicato: ' + r.art.name;
      titleEl.style.color = 'var(--tran)';
    });
    optionsEl.appendChild(div);
  });

  $setText('tranLinkInfo', 'Seleziona la combinazione corretta tra quelle suggerite.');
}

function populateComboPalletTypeSelect() {
  const sel = $id('tranComboPalletType');
  if (!sel || sel.options.length > 1) return; // già popolato
  const types = TRAN.palletRates?.meta?.palletTypes || [];
  types.forEach((t) => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = t;
    sel.appendChild(o);
  });
}

// Applica dati da un articolo trasporti (usato sia dal singolo che dal multi)
function applyTranArticleData(tranArt, selItems) {
  const rules = tranArt?.rules || {};
  const note = tranArt?.note || tranArt?.notes || tranArt?.nota || '';
  const noteUp = (note || '').toUpperCase();
  const forceGroupage = !!(rules.forceService === 'GROUPAGE' || noteUp.includes('GROUPAGE'));

  // Servizio
  const svcToSet = forceGroupage ? 'GROUPAGE' : 'PALLET';
  $setVal('tranService', svcToSet);
  updateTranServiceUI();

  // Quantità (somma o 1)
  const totalQty = selItems.reduce((s, a) => s + Math.max(1, parseInt(a.quantita || 1) || 1), 0);
  $setVal('tranQty', String(Math.max(1, totalQty)));

  const msgs = ['Servizio: ' + svcToSet + ' · Qtà totale: ' + totalQty];
  // Highlight campi obbligatori ancora da compilare
  const needRegion = $id('tranRegion');
  const needProvince = $id('tranProvince');
  if (needRegion && !needRegion.value) {
    needRegion.style.borderColor = 'var(--warning)';
    needRegion.style.boxShadow = '0 0 0 3px rgba(230,81,0,.18)';
  }
  if (svcToSet === 'GROUPAGE' && needProvince && !needProvince.value) {
    needProvince.style.borderColor = 'var(--warning)';
    needProvince.style.boxShadow = '0 0 0 3px rgba(230,81,0,.18)';
  }

  if (svcToSet === 'PALLET') {
    const pt = (tranArt?.pack?.palletType || '').trim();
    const palletSel = $id('tranPalletType');
    if (pt && palletSel) {
      const opts = [...palletSel.options].filter((o) => o.value);
      const match = opts.find((o) => o.value.toUpperCase() === pt.toUpperCase());
      if (match) {
        palletSel.value = match.value;
        msgs.push('✅ Bancale: ' + match.value);
      } else {
        msgs.push('⚠️ Bancale "' + pt + '" non trovato — selezionalo manualmente');
      }
    } else {
      msgs.push('⚠️ Taglia bancale non disponibile — selezionala manualmente');
    }
  }

  if (svcToSet === 'GROUPAGE') {
    if (rules.groupageLm != null) {
      $setVal('tranLm', String(rules.groupageLm));
      msgs.push('LM: ' + rules.groupageLm + ' m');
    }
    if (rules.groupageQuintali != null) $setVal('tranQuintali', String(rules.groupageQuintali));
    if (rules.groupagePalletCount != null) {
      $setVal('tranPalletCount', String(rules.groupagePalletCount));
    }
    if (rules.noSponda) {
      const sp = $id('tranSponda');
      if (sp) {
        sp.checked = false;
        sp.disabled = true;
      }
      msgs.push('⚠️ Sponda N/D');
    } else {
      const sp = $id('tranSponda');
      if (sp) sp.disabled = false;
    }
    if (rules.forceQuote) msgs.push('⚠️ ' + (rules.forceQuoteReason || 'Quotazione consigliata'));
  }

  // Avvisa su cosa manca ancora
  if (!$id('tranRegion')?.value) {
    msgs.push('👉 Seleziona la Regione per calcolare');
  } else if (svcToSet === 'GROUPAGE' && !$id('tranProvince')?.value) {
    msgs.push('👉 Seleziona la Provincia per calcolare');
  } else {
    msgs.push('👉 Premi Calcola Trasporto');
  }
  $setText('tranLinkInfo', msgs.join(' — '));
  showToast('✅ ' + msgs[0], 2800);
}

// Wrapper: applica da singolo articolo per idx
function applyTranFromArticolo_byIdx(idx) {
  const a = state.articoliAggiunti[idx];
  if (!a) return;
  const tranArt = findTranArticle(a.codice, a.descrizione);
  applyTranArticleData(
    tranArt || {
      pack: { palletType: state.listino.find((i) => i.codice === a.codice)?.palletType || '' }
    },
    [a]
  );
  // Aggiunge il codice nell'info
  $setText('tranLinkInfo', 'Articolo: ' + a.codice + ' — ' + $id('tranLinkInfo').textContent);
}

function applyTranFromArticolo() {
  const idx = parseInt($val('tranLinkArticle'));
  if (isNaN(idx) || !state.articoliAggiunti[idx]) {
    showToast('⚠️ Seleziona un articolo');
    return;
  }
  applyTranFromArticolo_byIdx(idx);
}

// ══════════════ AGGIUNGI COSTO TRASPORTO AL PREVENTIVO ══════════════

function addTranToPreventivo() {
  if (!state.lastTranResult || !Number.isFinite(state.lastTranResult.costCliente)) {
    showToast('⚠️ Calcola prima il trasporto');
    return;
  }
  const { svc, region, province, costCliente } = state.lastTranResult;
  const dest = svc === 'PALLET' ? region : province;
  const codice = 'TRASP-' + svc;
  const descrizione = 'Trasporto ' + svc + ' → ' + dest;
  state.articoliAggiunti.push({
    codice,
    descrizione,
    prezzoLordo: costCliente,
    sconto: 0,
    sconto2: 0,
    margine: 0,
    scontoCliente: 0,
    costoTrasporto: 0,
    costoInstallazione: 0,
    quantita: 1,
    venduto: 0
  });
  renderTabellaArticoli();
  aggiornaTotali();
  updateEquivDiscount();
  salvaPreventivo();
  refreshTranLinkSelect();
  // Switcha al tab preventivo
  document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  const tabPrev = document.querySelector('.tab[data-tab="preventivo"]');
  if (tabPrev) tabPrev.classList.add('active');
  $id('tab-preventivo')?.classList.add('active');
  showToast('✅ Trasporto aggiunto al preventivo: ' + fmtEur(costCliente));
}

// ══════════════ REPORT TRASPORTO PER CONDIVISIONE ══════════════

function buildTranReport() {
  if (!state.lastTranResult) return '';
  const { svc, region, province, costCliente } = state.lastTranResult;
  const lines = ['COSTO TRASPORTO — ' + today(), '─'.repeat(36)];
  lines.push('Servizio: ' + svc);
  if (svc === 'PALLET') lines.push('Regione: ' + region);
  else lines.push('Provincia: ' + province);
  lines.push('');
  lines.push('COSTO PREVENTIVATO: ' + moneyEUR(costCliente));
  const extra = $val('tranNoteExtra');
  if (extra) lines.push('Note: ' + extra);
  return lines.join('\n');
}

// ══════════════ INIT UI + WIRING EVENT LISTENERS ══════════════

export async function initTrasportoUI() {
  updateTranServiceUI(); // inizializza visibilità campi subito (non aspetta loadTranData)
  $id('tranService')?.addEventListener('change', updateTranServiceUI);
  $id('tranRegion')?.addEventListener('change', (e) => {
    updateTranProvinces(e.target.value);
    // Reset highlight
    const el = e.target;
    el.style.borderColor = '';
    el.style.boxShadow = '';
  });
  $id('tranProvince')?.addEventListener('change', (e) => {
    const el = e.target;
    el.style.borderColor = '';
    el.style.boxShadow = '';
  });
  $id('btnTranCalc')?.addEventListener('click', onTranCalc);
  $id('btnTranAddToPreventivo')?.addEventListener('click', addTranToPreventivo);
  $id('btnTranApplyArticle')?.addEventListener('click', applyTranFromArticolo);
  // Auto-fill immediato alla selezione dell'articolo (senza dover premere 'Applica')
  $id('tranLinkArticle')?.addEventListener('change', function () {
    const idx = parseInt(this.value);
    if (!isNaN(idx) && state.articoliAggiunti[idx]) applyTranFromArticolo_byIdx(idx);
  });

  // Modalità singolo/multi
  document.querySelectorAll('input[name="tranMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isMulti = $id('tranModeMulti')?.checked;
      const single = $id('tranSingleSection');
      const multi = $id('tranMultiSection');
      if (single) single.style.display = isMulti ? 'none' : '';
      if (multi) multi.style.display = isMulti ? '' : 'none';
      if (isMulti) refreshTranMultiList();
    });
  });
  $id('btnTranApplyMulti')?.addEventListener('click', cercaCombinazione);
  $id('btnTranApplyCombo')?.addEventListener('click', () => {
    const pt = $val('tranComboPalletType');
    if (!pt) {
      showToast('⚠️ Seleziona una taglia bancale');
      return;
    }
    // Applica manualmente la taglia scelta
    $setVal('tranService', 'PALLET');
    updateTranServiceUI();
    $setVal('tranPalletType', pt);
    $setText(
      'tranLinkInfo',
      'Taglia impostata manualmente: ' + pt + ' — imposta Regione e calcola.'
    );
    showToast('✅ Bancale impostato: ' + pt);
  });
  $id('btnTranWA')?.addEventListener('click', () => {
    const r = buildTranReport();
    if (!r) return;
    window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(r), '_blank');
  });
  $id('btnTranCopy')?.addEventListener('click', async () => {
    const r = buildTranReport();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r);
      showToast('📋 Copiato!');
    } catch (_) {
      showToast('⚠️ Copia non supportata');
    }
  });

  await loadTranData();
}
