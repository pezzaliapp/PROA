// ─── TAB PREVENTIVO ───
// Composizione offerta, calcoli sconti/margine/IVA, export, autosave IndexedDB.

import { state, smartSettings, setArticoli, saveSettings } from './state.js';
import { idbSet, idbGet } from './storage.js';
import {
  parseDec,
  fmtDec,
  roundTwo,
  clamp,
  fmtEur,
  sanitizeDecInput,
  today,
  $id,
  $val,
  $setVal,
  esc,
  safeConfirm,
  showToast
} from './utils.js';
import { downloadBlob } from './exports.js';
import { findDispRow, arriviTot, arriviLabel, dispBadgeHTML } from './csv-parser.js';
import { refreshTranLinkSelect } from './trasporto.js';

// ══════════════ CALCOLI ══════════════

function computeRow(a) {
  const prezzoLordo = parseDec(a.prezzoLordo || 0);
  const qta = Math.max(1, parseInt(a.quantita || 1) || 1);
  const useClient = !!smartSettings.showClientDiscount && !a.__skipClient;
  let sc1 = 0;
  let sc2 = 0;
  let marg = 0;
  if (useClient) {
    sc1 = clamp(parseDec(a.scontoCliente || 0), 0, 100);
  } else {
    sc1 = clamp(parseDec(a.sconto || 0), 0, 100);
    sc2 = clamp(parseDec(a.sconto2 || 0), 0, 100);
    marg = clamp(parseDec(a.margine || 0), 0, 99.99);
  }
  const dopoS1 = prezzoLordo * (1 - sc1 / 100);
  const totaleNettoUnit = roundTwo(sc2 > 0 ? dopoS1 * (1 - sc2 / 100) : dopoS1);
  // MARGINE % sul prezzo di vendita: prezzoVendita = costo / (1 - marg/100)
  // es. costo=1000, marg=20% → vendita=1250, margine=(1250-1000)/1250=20%
  const conMargineUnit = marg > 0 ? roundTwo(totaleNettoUnit / (1 - marg / 100)) : totaleNettoUnit;
  const trasporto = Math.max(0, parseDec(a.costoTrasporto || 0));
  const installazione = Math.max(0, parseDec(a.costoInstallazione || 0));
  const granTotRiga = roundTwo((conMargineUnit + trasporto + installazione) * qta);
  const venduto = parseDec(a.venduto || 0);
  const differenzaUnit = roundTwo(conMargineUnit - venduto);
  const differenza = roundTwo(differenzaUnit * qta);
  return {
    prezzoLordo,
    qta,
    sconto1: sc1,
    sconto2: sc2,
    margine: marg,
    totaleNettoUnit,
    conMargineUnit,
    trasporto,
    installazione,
    granTotRiga,
    venduto,
    differenzaUnit,
    differenza
  };
}

// ══════════════ RENDER TABELLA ══════════════

export function renderTabellaArticoli() {
  const body = $id('articoliBody');
  const emptyEl = $id('emptyMsg');
  if (!body) return;
  if (!state.articoliAggiunti.length) {
    body.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    aggiornaTotali();
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  body.innerHTML = state.articoliAggiunti.map(buildRow).join('');
  body.querySelectorAll('input[data-field]').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const c = sanitizeDecInput(e.target.value);
      if (e.target.value !== c) e.target.value = c;
    });
    inp.addEventListener('change', (e) => {
      const idx = parseInt(inp.closest('tr')?.dataset.idx);
      if (!isNaN(idx) && state.articoliAggiunti[idx]) {
        state.articoliAggiunti[idx][inp.dataset.field] = e.target.value;
      }
      aggiornaCalcoliRighe();
      aggiornaTotali();
      updateEquivDiscount();
      salvaPreventivo();
    });
  });
  body.querySelectorAll('.btn-remove').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.articoliAggiunti.splice(parseInt(btn.dataset.idx), 1);
      renderTabellaArticoli();
      aggiornaTotali();
      updateEquivDiscount();
      salvaPreventivo();
      refreshTranLinkSelect();
    })
  );
  body.querySelectorAll('.btn-up,.btn-down').forEach((btn) =>
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.closest('tr').dataset.idx);
      const dest = btn.classList.contains('btn-up') ? idx - 1 : idx + 1;
      if (dest < 0 || dest >= state.articoliAggiunti.length) return;
      [state.articoliAggiunti[idx], state.articoliAggiunti[dest]] = [
        state.articoliAggiunti[dest],
        state.articoliAggiunti[idx]
      ];
      renderTabellaArticoli();
    })
  );
  applyColumnVisibility();
}

function buildRow(a, idx) {
  const r = computeRow(a);
  const dr = findDispRow(a.codice);
  const dispNum = dr ? dr.disponibilita : null;
  const hasArr = dr ? arriviTot(dr) > 0 : false;
  const badge = dispNum !== null ? dispBadgeHTML(dispNum, hasArr) : '—';
  const tt = dr
    ? 'Disp:' +
      dr.disponibilita +
      (arriviLabel(dr) ? ' | ' + arriviLabel(dr) : '') +
      (dr.note ? ' | ' + dr.note : '')
    : '';
  const inp = (field, val, im) =>
    '<input type="text" data-field="' +
    field +
    '" value="' +
    esc(String(val)) +
    '" inputmode="' +
    (im || 'decimal') +
    '" autocomplete="off"/>';
  return (
    '<tr data-idx="' +
    idx +
    '">' +
    '<td data-col="codice"><strong>' +
    esc(a.codice) +
    '</strong></td>' +
    '<td data-col="descrizione">' +
    esc(a.descrizione) +
    '</td>' +
    '<td data-col="dispBadge" title="' +
    esc(tt) +
    '">' +
    badge +
    '</td>' +
    '<td data-col="prezzoLordo">' +
    fmtEur(r.prezzoLordo) +
    '</td>' +
    '<td data-col="sconto1">' +
    inp('sconto', fmtDec(r.sconto1, 2, true)) +
    '</td>' +
    '<td data-col="sconto2">' +
    inp('sconto2', fmtDec(r.sconto2, 2, true)) +
    '</td>' +
    '<td data-col="scontoCliente">' +
    inp('scontoCliente', fmtDec(parseDec(a.scontoCliente || 0), 2, true)) +
    '</td>' +
    '<td data-col="margine">' +
    inp('margine', fmtDec(r.margine, 2, true)) +
    '</td>' +
    '<td data-col="totaleNetto">' +
    fmtEur(r.totaleNettoUnit) +
    '</td>' +
    '<td data-col="trasporto">' +
    inp('costoTrasporto', fmtDec(r.trasporto, 2, true)) +
    '</td>' +
    '<td data-col="installazione">' +
    inp('costoInstallazione', fmtDec(r.installazione, 2, true)) +
    '</td>' +
    '<td data-col="qta">' +
    inp('quantita', a.quantita || 1, 'numeric') +
    '</td>' +
    '<td data-col="granTot">' +
    fmtEur(r.granTotRiga) +
    '</td>' +
    '<td data-col="venduto">' +
    inp('venduto', fmtDec(parseDec(a.venduto || 0), 2, true)) +
    '</td>' +
    '<td data-col="diff" class="' +
    (r.differenza >= 0 ? 'tot-positive' : 'tot-negative') +
    '">' +
    fmtEur(r.differenza) +
    '</td>' +
    '<td data-col="azioni"><div class="azioni-wrap">' +
    '<button class="btn-remove" data-idx="' +
    idx +
    '" title="Rimuovi">✕</button>' +
    '<button class="btn-move btn-up" title="Su">↑</button>' +
    '<button class="btn-move btn-down" title="Giù">↓</button>' +
    '</div></td></tr>'
  );
}

function aggiornaCalcoliRighe() {
  const body = $id('articoliBody');
  if (!body) return;
  body.querySelectorAll('tr[data-idx]').forEach((tr) => {
    const idx = parseInt(tr.dataset.idx);
    const a = state.articoliAggiunti[idx];
    if (!a) return;
    const r = computeRow(a);
    const setTd = (col, v) => {
      const td = tr.querySelector('td[data-col="' + col + '"]');
      if (td) td.textContent = v;
    };
    setTd('totaleNetto', fmtEur(r.totaleNettoUnit));
    setTd('granTot', fmtEur(r.granTotRiga));
    const diffTd = tr.querySelector('td[data-col="diff"]');
    if (diffTd) {
      diffTd.textContent = fmtEur(r.differenza);
      diffTd.className = r.differenza >= 0 ? 'tot-positive' : 'tot-negative';
    }
    const dispTd = tr.querySelector('td[data-col="dispBadge"]');
    if (dispTd) {
      const dr2 = findDispRow(a.codice);
      const n2 = dr2 ? dr2.disponibilita : null;
      const ha = dr2 ? arriviTot(dr2) > 0 : false;
      dispTd.innerHTML = n2 !== null ? dispBadgeHTML(n2, ha) : '—';
    }
  });
}

export function aggiornaBadgePreventivo() {
  aggiornaCalcoliRighe();
}

export function aggiornaTotali() {
  const card = $id('totaliCard');
  const el = $id('totaleGenerale');
  if (!el) return;
  if (!state.articoliAggiunti.length) {
    if (card) card.style.display = 'none';
    return;
  }
  if (card) card.style.display = 'block';
  let tN = 0;
  let tC = 0;
  let tV = 0;
  let tD = 0;
  state.articoliAggiunti.forEach((a) => {
    const r = computeRow(a);
    tN += r.conMargineUnit * r.qta;
    tC += r.granTotRiga;
    tV += r.venduto * r.qta;
    tD += r.differenza;
  });
  tN = roundTwo(tN);
  tC = roundTwo(tC);
  tV = roundTwo(tV);
  tD = roundTwo(tD);
  const vat = clamp(parseDec(smartSettings.vatRate ?? 22), 0, 100);
  const iva = roundTwo((tC * vat) / 100);
  const totIva = roundTwo(tC + iva);
  const rows = [
    ['Totale netto (senza servizi)', fmtEur(tN), false],
    ['Totale (con trasp./inst.)', fmtEur(tC), true]
  ];
  if (!smartSettings.hideVenduto) rows.push(['Totale venduto', fmtEur(tV), false]);
  if (!smartSettings.hideDiff) rows.push(['Totale diff.', fmtEur(tD), false]);
  if (smartSettings.showVAT) {
    rows.push(['IVA (' + vat.toFixed(1) + '%)', fmtEur(iva), false]);
    rows.push(['Totale + IVA', fmtEur(totIva), true, 'highlight']);
  }
  el.innerHTML =
    '<table class="totali-table">' +
    rows
      .map(
        (row) =>
          '<tr class="' +
          (row[3] || '') +
          '"><td>' +
          (row[2] ? '<strong>' + row[0] + '</strong>' : row[0]) +
          '</td><td class="num">' +
          (row[2] ? '<strong>' + row[1] + '</strong>' : row[1]) +
          '</td></tr>'
      )
      .join('') +
    '</table>';
}

export function updateEquivDiscount() {
  const el = $id('smartEquivalentDiscount');
  if (!el) return;
  let base = 0;
  let fin = 0;
  state.articoliAggiunti.forEach((a) => {
    const r = computeRow(a);
    base += parseDec(a.prezzoLordo) * r.qta;
    fin += r.conMargineUnit * r.qta;
  });
  base = roundTwo(base);
  fin = roundTwo(fin);
  el.textContent = base ? clamp((1 - fin / base) * 100, -9999, 9999).toFixed(2) + '%' : '—';
}

export function applyColumnVisibility() {
  const hide = (col, h) =>
    document
      .querySelectorAll('[data-col="' + col + '"]')
      .forEach((e) => e.classList.toggle('col-hidden', !!h));
  const client = !!smartSettings.showClientDiscount;
  const smart = !!smartSettings.smartMode;
  hide('sconto1', client);
  hide('sconto2', client);
  hide('scontoCliente', !client);
  hide('margine', smart || client);
  hide('prezzoLordo', smart);
  hide('venduto', smart || smartSettings.hideVenduto);
  hide('diff', smart || smartSettings.hideDiff);
}

// ══════════════ AGGIUNTA ARTICOLI ══════════════

function newArticoloFrom(base) {
  return {
    codice: base.codice,
    descrizione: base.descrizione,
    prezzoLordo: base.prezzoLordo,
    sconto: 0,
    sconto2: 0,
    margine: 0,
    scontoCliente: 0,
    costoTrasporto: state.autoCosti ? base.costoTrasporto : 0,
    costoInstallazione: state.autoCosti ? base.costoInstallazione : 0,
    quantita: 1,
    venduto: 0
  };
}

function aggiungiDaListino() {
  const sel = $id('listinoSelect');
  if (!sel?.value) {
    showToast('⚠️ Nessun articolo');
    return;
  }
  const item = state.listino.find((i) => i.codice === sel.value);
  if (!item) return;
  const dr = findDispRow(item.codice);
  if (dr) {
    const arr = arriviLabel(dr);
    const hint = $id('dispHint');
    if (hint) {
      hint.innerHTML =
        '<span style="color:var(--tran);font-weight:600">📦 ' +
        esc(item.codice) +
        ' — Disp: ' +
        dr.disponibilita +
        (arr ? ' | ' + arr : '') +
        (dr.note ? ' | ' + esc(dr.note) : '') +
        ' </span>';
      hint.style.display = 'block';
    }
  }
  state.articoliAggiunti.push(newArticoloFrom(item));
  renderTabellaArticoli();
  aggiornaTotali();
  updateEquivDiscount();
  salvaPreventivo();
  refreshTranLinkSelect();
  showToast('✅ Aggiunto: ' + item.descrizione);
}

function aggiungiManuale() {
  const codice = $val('manCodice').trim();
  const descrizione = $val('manDescrizione').trim();
  if (!codice || !descrizione) {
    showToast('⚠️ Codice e descrizione obbligatori');
    return;
  }
  state.articoliAggiunti.push({
    codice,
    descrizione,
    prezzoLordo: parseDec($val('manPrezzo')),
    costoTrasporto: parseDec($val('manTrasporto')),
    costoInstallazione: parseDec($val('manInstallazione')),
    sconto: 0,
    sconto2: 0,
    margine: 0,
    scontoCliente: 0,
    quantita: 1,
    venduto: 0
  });
  ['manCodice', 'manDescrizione', 'manPrezzo', 'manTrasporto', 'manInstallazione'].forEach((id) =>
    $setVal(id, '')
  );
  renderTabellaArticoli();
  aggiornaTotali();
  updateEquivDiscount();
  salvaPreventivo();
  refreshTranLinkSelect();
  showToast('✅ Aggiunto: ' + codice);
}

function computeEquivClientDiscount(a) {
  const pL = parseDec(a.prezzoLordo || 0);
  if (pL <= 0) return 0;
  const r = computeRow({ ...a, __skipClient: true });
  return clamp((1 - r.conMargineUnit / pL) * 100, 0, 100);
}

function applyClientDiscountMode(enabled) {
  setArticoli(
    state.articoliAggiunti.map((a) => {
      const item = { ...a };
      if (enabled) {
        item._bakSconto = item._bakSconto ?? parseDec(item.sconto || 0);
        item._bakSconto2 = item._bakSconto2 ?? parseDec(item.sconto2 || 0);
        item._bakMargine = item._bakMargine ?? parseDec(item.margine || 0);
        item.scontoCliente = computeEquivClientDiscount(item);
        item.sconto = 0;
        item.sconto2 = 0;
        item.margine = 0;
      } else {
        if (item._bakSconto !== undefined) item.sconto = item._bakSconto;
        if (item._bakSconto2 !== undefined) item.sconto2 = item._bakSconto2;
        if (item._bakMargine !== undefined) item.margine = item._bakMargine;
      }
      return item;
    })
  );
  renderTabellaArticoli();
  aggiornaTotali();
  updateEquivDiscount();
}

// ══════════════ AUTOSAVE / RESTORE PREVENTIVO ══════════════

export async function salvaPreventivo() {
  try {
    await idbSet('prev_wip', {
      savedAt: Date.now(),
      titolo: $val('preventivoTitolo') || '',
      articoli: state.articoliAggiunti
    });
  } catch (_) {
    // persistenza fallita: silenzioso
  }
}

export async function ripristinaPreventivo() {
  try {
    const p = await idbGet('prev_wip');
    if (!p?.articoli?.length) return;
    setArticoli(p.articoli);
    if (p.titolo) $setVal('preventivoTitolo', p.titolo);
    renderTabellaArticoli();
    aggiornaTotali();
    updateEquivDiscount();
    refreshTranLinkSelect();
    showToast(
      '🔄 Preventivo precedente ripristinato (' + state.articoliAggiunti.length + ' articoli)',
      3500
    );
  } catch (_) {
    // ripristino fallito: continua con stato vuoto
  }
}

// ══════════════ REPORT / EXPORT ══════════════

function generaReport(opts) {
  opts = opts || {};
  const noMargine = !!opts.noMargine;
  const client = !!smartSettings.showClientDiscount;
  const titolo = $val('preventivoTitolo') || 'PREVENTIVO';
  const lines = [titolo.toUpperCase() + ' — ' + today(), '═'.repeat(44), ''];
  let tN = 0;
  let tC = 0;
  state.articoliAggiunti.forEach((a, i) => {
    const r = computeRow(a);
    const pD = noMargine ? r.totaleNettoUnit : r.conMargineUnit;
    lines.push(i + 1 + '. ' + a.codice + ' — ' + a.descrizione);
    if (!smartSettings.hideDiscounts && !noMargine) {
      if (client) {
        lines.push(
          '   Sc.cliente: ' + clamp(parseDec(a.scontoCliente || 0), 0, 100).toFixed(2) + '%'
        );
      } else {
        if (r.sconto1) lines.push('   Sc.1: ' + fmtDec(r.sconto1, 2, true) + '%');
        if (r.sconto2) lines.push('   Sc.2: ' + fmtDec(r.sconto2, 2, true) + '%');
        if (r.margine) lines.push('   Marg.: ' + fmtDec(r.margine, 2, true) + '%');
      }
    }
    lines.push('   Prezzo netto: ' + fmtEur(pD));
    lines.push('   Qtà: ' + r.qta);
    if (r.trasporto) lines.push('   Trasporto: ' + fmtEur(r.trasporto));
    if (r.installazione) lines.push('   Installazione: ' + fmtEur(r.installazione));
    const totRiga = roundTwo((pD + r.trasporto + r.installazione) * r.qta);
    lines.push('   Totale riga: ' + fmtEur(totRiga));
    if (!smartSettings.hideVenduto && !noMargine) lines.push('   Venduto a: ' + fmtEur(r.venduto));
    if (!smartSettings.hideDiff && !noMargine) lines.push('   Diff.: ' + fmtEur(r.differenza));
    lines.push('');
    tN += pD * r.qta;
    tC += totRiga;
  });
  lines.push('─'.repeat(44));
  lines.push('Totale netto:       ' + fmtEur(roundTwo(tN)));
  lines.push('Totale complessivo: ' + fmtEur(roundTwo(tC)));
  if (smartSettings.showVAT) {
    const vat = clamp(parseDec(smartSettings.vatRate ?? 22), 0, 100);
    const iva = roundTwo((tC * vat) / 100);
    lines.push('IVA (' + vat.toFixed(1) + '%):        ' + fmtEur(iva));
    lines.push('TOTALE + IVA:       ' + fmtEur(roundTwo(tC + iva)));
  }
  return lines.join('\n');
}

function mostraPreview(content) {
  const el = $id('reportPreview');
  if (!el) return;
  el.textContent = content;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ══════════════ SMART SETTINGS BINDING ══════════════

function bindSmartControls() {
  const map = {
    toggleSmartMode: 'smartMode',
    toggleShowVAT: 'showVAT',
    toggleHideVenduto: 'hideVenduto',
    toggleHideDiff: 'hideDiff',
    toggleHideDiscounts: 'hideDiscounts',
    toggleShowClientDiscount: 'showClientDiscount'
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = $id(id);
    if (el) el.checked = !!smartSettings[key];
  });
  $setVal('vatRate', String(smartSettings.vatRate));
  const elAC = $id('toggleAutoCosti');
  if (elAC) elAC.checked = state.autoCosti;
  const onChange = () => {
    const prevClient = !!smartSettings.showClientDiscount;
    Object.entries(map).forEach(([id, key]) => {
      const el = $id(id);
      if (el) smartSettings[key] = el.checked;
    });
    smartSettings.vatRate = clamp(parseDec($val('vatRate') || '22'), 0, 100);
    state.autoCosti = !!$id('toggleAutoCosti')?.checked;
    if (smartSettings.smartMode) {
      smartSettings.hideVenduto = true;
      smartSettings.hideDiff = true;
      smartSettings.hideDiscounts = true;
    }
    saveSettings();
    if (prevClient !== smartSettings.showClientDiscount) {
      applyClientDiscountMode(smartSettings.showClientDiscount);
      return;
    }
    applyColumnVisibility();
    aggiornaCalcoliRighe();
    aggiornaTotali();
    updateEquivDiscount();
  };
  [...Object.keys(map), 'vatRate', 'toggleAutoCosti'].forEach((id) =>
    $id(id)?.addEventListener('change', onChange)
  );
}

// ══════════════ INIT UI + WIRING EVENT LISTENERS ══════════════

export function initPreventivoUI() {
  $id('btnAddFromListino')?.addEventListener('click', aggiungiDaListino);
  $id('btnAddManual')?.addEventListener('click', aggiungiManuale);
  $id('preventivoTitolo')?.addEventListener('input', salvaPreventivo);

  const doExport = (opts, wa) => () => {
    if (!state.articoliAggiunti.length) {
      showToast('⚠️ Nessun articolo');
      return;
    }
    const r = generaReport(opts);
    mostraPreview(r);
    if (wa) {
      window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(r), '_blank');
    } else {
      downloadBlob(
        r,
        'preventivo' +
          (opts?.noMargine ? '_nomarg' : '') +
          '_' +
          new Date().toISOString().slice(0, 10) +
          '.txt'
      );
      showToast('📄 TXT scaricato');
    }
  };
  $id('btnWA')?.addEventListener('click', doExport({}, true));
  $id('btnTXT')?.addEventListener('click', doExport({}, false));
  $id('btnWANoMarg')?.addEventListener('click', doExport({ noMargine: true }, true));
  $id('btnTXTNoMarg')?.addEventListener('click', doExport({ noMargine: true }, false));
  $id('btnCopyClip')?.addEventListener('click', async () => {
    if (!state.articoliAggiunti.length) {
      showToast('⚠️ Nessun articolo');
      return;
    }
    const r = generaReport();
    mostraPreview(r);
    try {
      await navigator.clipboard.writeText(r);
      showToast('📋 Copiato!');
    } catch (_) {
      showToast('⚠️ Copia non supportata');
    }
  });
  $id('btnClearAll')?.addEventListener('click', () => {
    if (!state.articoliAggiunti.length) return;
    if (!safeConfirm('Svuotare la lista?')) return;
    setArticoli([]);
    renderTabellaArticoli();
    aggiornaTotali();
    updateEquivDiscount();
    salvaPreventivo();
    refreshTranLinkSelect();
    const prev = $id('reportPreview');
    if (prev) prev.style.display = 'none';
    showToast('🗑️ Lista svuotata');
  });
  bindSmartControls();
}
