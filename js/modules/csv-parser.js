// ─── LISTINO CSV + DISPONIBILITÀ XLSX/CSV ───
// Parsing, persistenza e rendering dei due tab di input dati.
// Dipende da PapaParse e SheetJS (globali caricati via CDN in index.html).

import { state, setListino, setSituazione } from './state.js';
import { idbSet, idbGet, idbDel } from './storage.js';
import {
  parseDec,
  parseIntSafe,
  fmtEur,
  $id,
  $val,
  $setText,
  esc,
  safeConfirm,
  showToast
} from './utils.js';
import { downloadBlob } from './exports.js';
import { aggiornaBadgePreventivo } from './preventivo.js';

// ══════════════ LISTINO CSV ══════════════

function normalizeListino(rows) {
  return rows
    .map((r) => {
      // PalletType: accetta vari nomi colonna (opzionale)
      const palletType =
        (
          r['PalletType'] ||
          r['palletType'] ||
          r['Pallettype'] ||
          r['TipoBancale'] ||
          r['tipobancale'] ||
          r['Bancale'] ||
          ''
        )
          .toString()
          .trim()
          .toUpperCase() || null;

      return {
        codice: String(r['Codice'] || r['codice'] || '').trim(),
        descrizione: String(r['Descrizione'] || r['descrizione'] || '').trim(),
        prezzoLordo: parseDec(r['PrezzoLordo'] || r['prezzoLordo'] || 0),
        costoTrasporto: parseDec(r['CostoTrasporto'] || r['costoTrasporto'] || 0),
        costoInstallazione: parseDec(r['CostoInstallazione'] || r['costoInstallazione'] || 0),
        palletType: palletType // null se non presente nel CSV
      };
    })
    .filter((r) => r.codice);
}

function handleCSVUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  $setText('csvFileName', file.name);
  if (typeof Papa === 'undefined') {
    showCSVError('Libreria non caricata, riprova.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const firstLine = text.split('\n')[0] || '';
    const delim =
      (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    Papa.parse(text, {
      header: true,
      delimiter: delim,
      skipEmptyLines: true,
      complete(res) {
        const normalized = normalizeListino(res.data);
        const inp = $id('csvFileInput');
        if (inp) inp.value = '';
        if (!normalized.length) {
          const fields = res.meta && res.meta.fields ? res.meta.fields.join(', ') : 'nessuna';
          showCSVError(
            'Nessun articolo. Colonne rilevate: [' +
              fields +
              ']. Attese: Codice;Descrizione;PrezzoLordo;…'
          );
          // Retry with other delimiter
          const alt = delim === ';' ? ',' : ';';
          Papa.parse(text, {
            header: true,
            delimiter: alt,
            skipEmptyLines: true,
            complete(r2) {
              processCSVResult(r2, file);
            },
            error() {
              showCSVError('Errore parsing');
            }
          });
          return;
        }
        processCSVResult(res, file);
      },
      error() {
        showCSVError('Errore lettura CSV');
      }
    });
  };
  reader.onerror = () => showCSVError('Impossibile leggere il file');
  reader.readAsText(file, 'UTF-8');
}

function processCSVResult(res, file) {
  const normalized = normalizeListino(res.data || []);
  const errEl = $id('csvError');
  if (errEl) errEl.style.display = 'none';
  if (!normalized.length) {
    showCSVError('Nessun articolo valido nel CSV');
    return;
  }
  setListino(normalized);
  aggiornaListinoSelect();
  updateListinoStats();
  showToast('✅ Listino: ' + state.listino.length + ' articoli');
  if ($id('toggleRememberCSV')?.checked) {
    idbSet('listino', { savedAt: Date.now(), name: file.name, data: state.listino })
      .then(updateSavedCsvInfo)
      .catch(() => {});
  }
}

function showCSVError(msg) {
  showToast('❌ ' + msg, 5000);
  const e = $id('csvError');
  if (e) {
    e.textContent = '❌ ' + msg;
    e.style.display = 'block';
  }
}

async function initListinoMemory() {
  await updateSavedCsvInfo();
  const p = await idbGet('listino').catch(() => null);
  if (p?.data?.length) {
    setListino(p.data);
    aggiornaListinoSelect();
    updateListinoStats();
  }
}

async function updateSavedCsvInfo() {
  const p = await idbGet('listino').catch(() => null);
  const el = $id('savedCsvInfo');
  if (!el) return;
  el.textContent = p?.data?.length
    ? 'Salvato: "' +
      p.name +
      '" • ' +
      p.data.length +
      ' art. • ' +
      new Date(p.savedAt).toLocaleString('it-IT')
    : 'Nessun listino salvato.';
}

function updateListinoStats() {
  const b = $id('listinoStats');
  const s = $id('statArticoli');
  if (s) s.textContent = state.listino.length + ' articoli caricati';
  if (b) b.style.display = state.listino.length ? 'block' : 'none';
}

export function aggiornaListinoSelect() {
  const sel = $id('listinoSelect');
  const q = $val('searchListino').toLowerCase();
  if (!sel) return;
  sel.innerHTML = '';
  const filtered = state.listino.filter(
    (i) => i.codice.toLowerCase().includes(q) || i.descrizione.toLowerCase().includes(q)
  );
  filtered.forEach((item) => {
    const disp = getDispNum(item.codice);
    const opt = document.createElement('option');
    opt.value = item.codice;
    opt.textContent =
      item.codice +
      ' — ' +
      item.descrizione +
      ' — ' +
      fmtEur(item.prezzoLordo) +
      (disp !== null ? ' [Disp:' + disp + ']' : '');
    sel.appendChild(opt);
  });
  const cnt = $id('listinoCount');
  if (cnt) {
    cnt.textContent = filtered.length
      ? filtered.length + ' di ' + state.listino.length + ' articoli'
      : state.listino.length
        ? 'Nessun risultato'
        : 'Carica un listino CSV';
  }
}

// ══════════════ SITUAZIONE SETTIMANALE ══════════════

function parseSituazioneRows(raw) {
  let startRow = 0;
  for (let i = 0; i < Math.min(raw.length, 6); i++) {
    const cell = String(raw[i]?.[0] ?? '').trim();
    if (cell && /^\d{5,}/.test(cell)) {
      startRow = i;
      break;
    }
    if (cell && /^\d{4,}.*\d{4,}/.test(cell)) {
      startRow = i;
      break;
    }
  }
  return raw
    .slice(startRow)
    .filter((r) => r[0] != null && String(r[0]).trim() !== '')
    .map((r) => ({
      codice: String(r[0] ?? '').trim(),
      descrizione: String(r[1] ?? '').trim(),
      disponibilita: parseIntSafe(r[2]),
      arriviS15: parseIntSafe(r[3]),
      arriviS18: parseIntSafe(r[4]),
      arriviMaggio: parseIntSafe(r[5]),
      arriviGiugno: parseIntSafe(r[6]),
      note: String(r[7] ?? '').trim(),
      prenotazioni: String(r[8] ?? '').trim(),
      infoExtra: String(r[9] ?? '').trim()
    }))
    .filter((r) => r.codice && r.codice !== 'COD. ART.');
}

function handleXLSXUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  $setText('xlsxFileName', file.name);
  const errEl = $id('xlsxError');
  if (errEl) errEl.style.display = 'none';
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const delim =
        (text.split('\n')[0].match(/;/g) || []).length >=
        (text.split('\n')[0].match(/,/g) || []).length
          ? ';'
          : ',';
      Papa.parse(text, {
        header: false,
        delimiter: delim,
        skipEmptyLines: false,
        complete(res) {
          setSituazione(parseSituazioneRows(res.data));
          onSituazioneLoaded(file.name);
        },
        error() {
          showToast('❌ Errore CSV situazione');
        }
      });
    };
    reader.readAsText(file, 'UTF-8');
    return;
  }
  if (typeof XLSX === 'undefined') {
    showToast('⚠️ Libreria XLSX non caricata', 4000);
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      setSituazione(parseSituazioneRows(XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })));
      onSituazioneLoaded(file.name);
    } catch (err) {
      console.error(err);
      showToast('❌ Errore XLSX');
      if (errEl) {
        errEl.textContent = '❌ Errore lettura XLSX';
        errEl.style.display = 'block';
      }
    }
  };
  reader.readAsArrayBuffer(file);
}

function onSituazioneLoaded(fileName) {
  const inp = $id('xlsxFileInput');
  if (inp) inp.value = '';
  renderDispTable();
  aggiornaListinoSelect();
  aggiornaBadgePreventivo();
  showToast('✅ Situazione: ' + state.situazione.length + ' articoli');
  if ($id('toggleRememberXLSX')?.checked) {
    idbSet('situazione', { savedAt: Date.now(), name: fileName, data: state.situazione })
      .then(updateSavedXlsxInfo)
      .catch(() => {});
  }
}

async function initXLSXMemory() {
  await updateSavedXlsxInfo();
  const p = await idbGet('situazione').catch(() => null);
  if (p?.data?.length) {
    setSituazione(p.data);
    renderDispTable();
    aggiornaListinoSelect();
  }
}

async function updateSavedXlsxInfo() {
  const p = await idbGet('situazione').catch(() => null);
  const el = $id('savedXlsxInfo');
  if (!el) return;
  el.textContent = p?.data?.length
    ? 'Salvata: "' +
      p.name +
      '" • ' +
      p.data.length +
      ' righe • ' +
      new Date(p.savedAt).toLocaleString('it-IT')
    : 'Nessuna situazione salvata.';
}

// ══════════════ DISPONIBILITÀ — QUERY & RENDER ══════════════

export function findDispRow(codice) {
  if (!state.situazione.length) return null;
  let r = state.situazione.find((s) => s.codice === codice);
  if (r) return r;
  r = state.situazione.find((s) => s.codice.split(/[-\s]+/).some((p) => p.trim() === codice));
  if (r) return r;
  return state.situazione.find((s) => s.codice.startsWith(codice.slice(0, 8))) ?? null;
}

export function getDispNum(codice) {
  const r = findDispRow(codice);
  return r ? r.disponibilita : null;
}

export function arriviTot(r) {
  return r.arriviS15 + r.arriviS18 + r.arriviMaggio + r.arriviGiugno;
}

export function arriviLabel(r) {
  const p = [];
  if (r.arriviS15) p.push('S15:' + r.arriviS15);
  if (r.arriviS18) p.push('S18:' + r.arriviS18);
  if (r.arriviMaggio) p.push('Mag:' + r.arriviMaggio);
  if (r.arriviGiugno) p.push('Giu:' + r.arriviGiugno);
  return p.join(' ');
}

export function dispBadgeHTML(val, hasArr) {
  if (val > 5) return '<span class="disp-badge disp-ok">' + val + '</span>';
  if (val > 0) return '<span class="disp-badge disp-low">' + val + '</span>';
  if (hasArr) return '<span class="disp-badge disp-arriving">0+</span>';
  return '<span class="disp-badge disp-zero">0</span>';
}

// Stato filtro interno al modulo
let _dispFilter = 'all';
let _dispSearch = '';

function getFilteredSituazione() {
  return state.situazione.filter((r) => {
    const q = _dispSearch.toLowerCase();
    if (q && !r.codice.toLowerCase().includes(q) && !r.descrizione.toLowerCase().includes(q))
      return false;
    if (_dispFilter === 'available') return r.disponibilita > 0;
    if (_dispFilter === 'zero') return r.disponibilita === 0;
    if (_dispFilter === 'arriving') return arriviTot(r) > 0;
    if (_dispFilter === 'noted') return !!(r.note || r.prenotazioni);
    return true;
  });
}

function renderDispTable() {
  const wrap = $id('dispTableWrap');
  const filt = $id('dispFilters');
  const cntEl = $id('dispCount');
  const body = $id('dispBody');
  if (!wrap || !body) return;
  const rows = getFilteredSituazione();
  if (cntEl) cntEl.textContent = rows.length + ' di ' + state.situazione.length + ' articoli';
  body.innerHTML = rows
    .map((r) => {
      const hasArr = arriviTot(r) > 0;
      return (
        '<tr><td><strong>' +
        esc(r.codice) +
        '</strong></td><td>' +
        esc(r.descrizione) +
        '</td>' +
        '<td class="num">' +
        dispBadgeHTML(r.disponibilita, hasArr) +
        '</td>' +
        '<td class="num">' +
        (r.arriviS15 || '—') +
        '</td><td class="num">' +
        (r.arriviS18 || '—') +
        '</td>' +
        '<td class="num">' +
        (r.arriviMaggio || '—') +
        '</td><td class="num">' +
        (r.arriviGiugno || '—') +
        '</td>' +
        '<td class="' +
        (r.note ? 'note-text' : '') +
        '">' +
        esc(r.note) +
        '</td>' +
        '<td class="' +
        (r.prenotazioni ? 'prenotaz-text' : '') +
        '">' +
        esc(r.prenotazioni) +
        '</td>' +
        '<td class="muted small">' +
        esc(r.infoExtra) +
        '</td></tr>'
      );
    })
    .join('');
  wrap.style.display = 'block';
  filt.style.display = 'block';
}

function exportDispCSV() {
  const rows = getFilteredSituazione();
  const lines = ['Codice;Descrizione;Disp.;S15;S18;Maggio;Giugno;Note;Prenotazioni;Info'].concat(
    rows.map((r) =>
      [
        r.codice,
        r.descrizione,
        r.disponibilita,
        r.arriviS15 || '',
        r.arriviS18 || '',
        r.arriviMaggio || '',
        r.arriviGiugno || '',
        r.note,
        r.prenotazioni,
        r.infoExtra
      ].join(';')
    )
  );
  downloadBlob(
    '﻿' + lines.join('\n'),
    'situazione_' + new Date().toISOString().slice(0, 10) + '.csv',
    'text/csv;charset=utf-8'
  );
}

// ══════════════ INIT UI + WIRING EVENT LISTENERS ══════════════

export async function initListinoUI() {
  $id('csvFileInput')?.addEventListener('change', handleCSVUpload);
  $id('searchListino')?.addEventListener('input', aggiornaListinoSelect);
  $id('btnLoadSavedCSV')?.addEventListener('click', async () => {
    const p = await idbGet('listino').catch(() => null);
    if (!p?.data?.length) {
      showToast('⚠️ Nessun listino salvato');
      return;
    }
    setListino(p.data);
    aggiornaListinoSelect();
    updateListinoStats();
    showToast('✅ Listino: ' + state.listino.length + ' art.');
  });
  $id('btnClearSavedCSV')?.addEventListener('click', async () => {
    if (!safeConfirm('Cancellare il listino salvato?')) return;
    await idbDel('listino').catch(() => {});
    setListino([]);
    aggiornaListinoSelect();
    updateListinoStats();
    await updateSavedCsvInfo();
    showToast('🗑️ Listino cancellato');
  });
  await initListinoMemory();
}

export async function initDisponibilitaUI() {
  $id('xlsxFileInput')?.addEventListener('change', handleXLSXUpload);
  $id('btnLoadSavedXLSX')?.addEventListener('click', async () => {
    const p = await idbGet('situazione').catch(() => null);
    if (!p?.data?.length) {
      showToast('⚠️ Nessuna situazione salvata');
      return;
    }
    setSituazione(p.data);
    renderDispTable();
    aggiornaListinoSelect();
    showToast('✅ Situazione: ' + state.situazione.length + ' righe');
  });
  $id('btnClearSavedXLSX')?.addEventListener('click', async () => {
    if (!safeConfirm('Cancellare la situazione?')) return;
    await idbDel('situazione').catch(() => {});
    setSituazione([]);
    const w = $id('dispTableWrap');
    const f = $id('dispFilters');
    if (w) w.style.display = 'none';
    if (f) f.style.display = 'none';
    await updateSavedXlsxInfo();
    showToast('🗑️ Situazione cancellata');
  });
  $id('searchDisp')?.addEventListener('input', (e) => {
    _dispSearch = e.target.value;
    renderDispTable();
  });
  $id('filterDisp')?.addEventListener('change', (e) => {
    _dispFilter = e.target.value;
    renderDispTable();
  });
  $id('btnExportDisp')?.addEventListener('click', exportDispCSV);
  await initXLSXMemory();
}
