/* ============================================================
   CSVXpressSmart 2026 + Trasporti — app.js  v1.0.0
   Motore di calcolo trasporti portato da:
   © Alessandro Pezzali – PezzaliAPP (alessandropezzali.it)
   Uso autorizzato nell'ambito di questo progetto.
   ============================================================ */
'use strict';

// ──────────────────────────────────────────────────────────
// SERVICE WORKER
// ──────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js?v=1.0.0');
      await reg.update().catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (sessionStorage.getItem('sw_r')) return;
        sessionStorage.setItem('sw_r', '1');
        location.reload();
      });
    } catch (e) { console.warn('SW:', e); }
  });
}

// ──────────────────────────────────────────────────────────
// STATO GLOBALE
// ──────────────────────────────────────────────────────────
let listino          = [];
let situazione       = [];
let articoliAggiunti = [];
let autoCosti        = true;

// Dati tariffe trasporto
const TRAN = {
  palletRates:   null,   // pallet_rates_by_region.json
  groupageRates: null,   // groupage_rates.json
  geo:           null,   // geo_provinces.json
  articles:      [],     // articles.json (palletType + rules per articolo)
  loaded:        false,
};

const smartSettings = {
  smartMode:false, showVAT:false, vatRate:22,
  hideVenduto:true, hideDiff:true, hideDiscounts:true, showClientDiscount:false,
};

// Stato calcolo trasporto corrente
let lastTranResult = null;

// ──────────────────────────────────────────────────────────
// UTILS NUMERICI
// ──────────────────────────────────────────────────────────
function parseDec(val) {
  let s = String(val ?? '').trim().replace(/\s+/g, '');
  const hasComma = s.includes(','), hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',','.');
    else s = s.replace(/,/g,'');
  } else if (hasComma) s = s.replace(',','.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtDec(n, d, trim) {
  d = d === undefined ? 2 : d;
  trim = trim === undefined ? true : trim;
  if (!Number.isFinite(n)) return '';
  let s = Number(n).toFixed(d);
  if (trim) s = s.replace(/\.?0+$/, '');
  return s.replace('.', ',');
}

function roundTwo(n) { return Math.round(n * 100) / 100; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function fmtEur(n) { return '\u20AC\u202f' + fmtDec(roundTwo(n), 2, false); }
function moneyEUR(n) { return Number.isFinite(n) ? fmtEur(n) : '—'; }

function parseIntSafe(v) { const n = parseInt(v); return Number.isFinite(n) ? n : 0; }

function sanitizeDecInput(s) {
  s = String(s ?? '').replace(/[^\d,.\-]/g, '');
  s = s.replace(/(?!^)-/g, '');
  const i = s.search(/[.,]/);
  if (i !== -1) s = s.slice(0,i+1) + s.slice(i+1).replace(/[.,]/g,'');
  return s;
}

function today() {
  return new Date().toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'});
}

// ──────────────────────────────────────────────────────────
// DOM HELPERS
// ──────────────────────────────────────────────────────────
const $id  = id => document.getElementById(id);
const $val = id => $id(id)?.value ?? '';
const $setVal  = (id,v) => { const e=$id(id); if(e) e.value=v; };
const $setText = (id,t) => { const e=$id(id); if(e) e.textContent=t; };

function esc(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function safeConfirm(msg) { try { return window.confirm(msg); } catch(_) { return true; } }

// ──────────────────────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────────────────────
function showToast(msg, ms) {
  ms = ms || 2600;
  const t = $id('toast'); if(!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ──────────────────────────────────────────────────────────
// INDEXEDDB
// ──────────────────────────────────────────────────────────
function openDB() {
  return new Promise((res,rej) => {
    const r = indexedDB.open('csvxpress_tran_2026', 1);
    r.onupgradeneeded = () => { if(!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbSet(k,v) { const db=await openDB(); return new Promise((r,j)=>{ const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(v,k); tx.oncomplete=r; tx.onerror=()=>j(tx.error); }); }
async function idbGet(k)   { const db=await openDB(); return new Promise((r,j)=>{ const tx=db.transaction('kv','readonly'); const q=tx.objectStore('kv').get(k); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }); }
async function idbDel(k)   { const db=await openDB(); return new Promise((r,j)=>{ const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete=r; tx.onerror=()=>j(tx.error); }); }

// ──────────────────────────────────────────────────────────
// TEMA
// ──────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme_tran');
  setTheme(saved==='dark' || (!saved && window.matchMedia('(prefers-color-scheme:dark)').matches));
}
function setTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark?'dark':'light');
  const btn=$id('btnTheme'); if(btn) btn.textContent = dark?'☀️':'🌙';
  localStorage.setItem('theme_tran', dark?'dark':'light');
}

// ──────────────────────────────────────────────────────────
// TABS
// ──────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = $id('tab-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
      // Quando si apre il tab trasporto, aggiorna la lista articoli collegabili
      if (btn.dataset.tab === 'trasporto') refreshTranLinkSelect();
    });
  });
}

// ──────────────────────────────────────────────────────────
// SMART SETTINGS
// ──────────────────────────────────────────────────────────
function loadSettings() {
  try { const r=localStorage.getItem('smart_tran_2026'); if(r) Object.assign(smartSettings,JSON.parse(r)); } catch(_){}
}
function saveSettings() {
  try { localStorage.setItem('smart_tran_2026',JSON.stringify(smartSettings)); } catch(_){}
}

// ──────────────────────────────────────────────────────────
// LISTINO CSV
// ──────────────────────────────────────────────────────────
function normalizeListino(rows) {
  return rows.map(r => {
    // PalletType: accetta vari nomi colonna (opzionale)
    const palletType = (
      r['PalletType'] || r['palletType'] || r['Pallettype'] ||
      r['TipoBancale'] || r['tipobancale'] || r['Bancale'] || ''
    ).toString().trim().toUpperCase() || null;

    return {
      codice:             String(r['Codice']||r['codice']||'').trim(),
      descrizione:        String(r['Descrizione']||r['descrizione']||'').trim(),
      prezzoLordo:        parseDec(r['PrezzoLordo']||r['prezzoLordo']||0),
      costoTrasporto:     parseDec(r['CostoTrasporto']||r['costoTrasporto']||0),
      costoInstallazione: parseDec(r['CostoInstallazione']||r['costoInstallazione']||0),
      palletType:         palletType,   // null se non presente nel CSV
    };
  }).filter(r => r.codice);
}

function handleCSVUpload(e) {
  const file = e.target.files[0]; if(!file) return;
  $setText('csvFileName', file.name);
  if(typeof Papa === 'undefined') { showCSVError('Libreria non caricata, riprova.'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    const text = ev.target.result;
    const firstLine = text.split('\n')[0] || '';
    const delim = (firstLine.match(/;/g)||[]).length >= (firstLine.match(/,/g)||[]).length ? ';' : ',';
    Papa.parse(text, {
      header:true, delimiter:delim, skipEmptyLines:true,
      complete(res) {
        const normalized = normalizeListino(res.data);
        const inp=$id('csvFileInput'); if(inp) inp.value='';
        if(!normalized.length) {
          const fields=(res.meta&&res.meta.fields)?res.meta.fields.join(', '):'nessuna';
          showCSVError('Nessun articolo. Colonne rilevate: ['+fields+']. Attese: Codice;Descrizione;PrezzoLordo;…');
          // Retry with other delimiter
          const alt = delim===';' ? ',' : ';';
          Papa.parse(text, { header:true, delimiter:alt, skipEmptyLines:true,
            complete(r2){ processCSVResult(r2,file); }, error(){ showCSVError('Errore parsing'); }
          });
          return;
        }
        processCSVResult(res, file);
      },
      error() { showCSVError('Errore lettura CSV'); }
    });
  };
  reader.onerror = () => showCSVError('Impossibile leggere il file');
  reader.readAsText(file, 'UTF-8');
}

function processCSVResult(res, file) {
  const normalized = normalizeListino(res.data||[]);
  const errEl=$id('csvError'); if(errEl) errEl.style.display='none';
  if(!normalized.length) { showCSVError('Nessun articolo valido nel CSV'); return; }
  listino = normalized;
  aggiornaListinoSelect(); updateListinoStats();
  showToast('✅ Listino: '+listino.length+' articoli');
  if($id('toggleRememberCSV')?.checked)
    idbSet('listino',{savedAt:Date.now(),name:file.name,data:listino}).then(updateSavedCsvInfo).catch(()=>{});
}

function showCSVError(msg) {
  showToast('❌ '+msg, 5000);
  const e=$id('csvError'); if(e){e.textContent='❌ '+msg; e.style.display='block';}
}

async function initListinoMemory() {
  await updateSavedCsvInfo();
  const p = await idbGet('listino').catch(()=>null);
  if(p?.data?.length){listino=p.data; aggiornaListinoSelect(); updateListinoStats();}
}

async function updateSavedCsvInfo() {
  const p=await idbGet('listino').catch(()=>null);
  const el=$id('savedCsvInfo'); if(!el) return;
  el.textContent=p?.data?.length?'Salvato: "'+p.name+'" • '+p.data.length+' art. • '+new Date(p.savedAt).toLocaleString('it-IT'):'Nessun listino salvato.';
}

function updateListinoStats() {
  const b=$id('listinoStats'),s=$id('statArticoli');
  if(s) s.textContent=listino.length+' articoli caricati';
  if(b) b.style.display=listino.length?'block':'none';
}

function aggiornaListinoSelect() {
  const sel=$id('listinoSelect'); const q=$val('searchListino').toLowerCase(); if(!sel) return;
  sel.innerHTML='';
  const filtered=listino.filter(i=>i.codice.toLowerCase().includes(q)||i.descrizione.toLowerCase().includes(q));
  filtered.forEach(item=>{
    const disp=getDispNum(item.codice);
    const opt=document.createElement('option');
    opt.value=item.codice;
    opt.textContent=item.codice+' — '+item.descrizione+' — '+fmtEur(item.prezzoLordo)+(disp!==null?' [Disp:'+disp+']':'');
    sel.appendChild(opt);
  });
  const cnt=$id('listinoCount');
  if(cnt) cnt.textContent=filtered.length?filtered.length+' di '+listino.length+' articoli':(listino.length?'Nessun risultato':'Carica un listino CSV');
}

// ──────────────────────────────────────────────────────────
// SITUAZIONE SETTIMANALE
// ──────────────────────────────────────────────────────────
function parseSituazioneRows(raw) {
  let startRow=0;
  for(let i=0;i<Math.min(raw.length,6);i++){
    const cell=String(raw[i]?.[0]??'').trim();
    if(cell && /^\d{5,}/.test(cell)){startRow=i;break;}
    if(cell && /^\d{4,}.*\d{4,}/.test(cell)){startRow=i;break;}
  }
  return raw.slice(startRow)
    .filter(r=>r[0]!=null&&String(r[0]).trim()!=='')
    .map(r=>({
      codice:String(r[0]??'').trim(), descrizione:String(r[1]??'').trim(),
      disponibilita:parseIntSafe(r[2]),
      arriviS15:parseIntSafe(r[3]),arriviS18:parseIntSafe(r[4]),
      arriviMaggio:parseIntSafe(r[5]),arriviGiugno:parseIntSafe(r[6]),
      note:String(r[7]??'').trim(), prenotazioni:String(r[8]??'').trim(), infoExtra:String(r[9]??'').trim(),
    }))
    .filter(r=>r.codice&&r.codice!=='COD. ART.');
}

function handleXLSXUpload(e) {
  const file=e.target.files[0]; if(!file) return;
  $setText('xlsxFileName',file.name);
  const errEl=$id('xlsxError'); if(errEl) errEl.style.display='none';
  const ext=file.name.split('.').pop().toLowerCase();
  if(ext==='csv'){
    const reader=new FileReader();
    reader.onload=ev=>{
      const text=ev.target.result;
      const delim=(text.split('\n')[0].match(/;/g)||[]).length>=(text.split('\n')[0].match(/,/g)||[]).length?';':',';
      Papa.parse(text,{header:false,delimiter:delim,skipEmptyLines:false,
        complete(res){situazione=parseSituazioneRows(res.data);onSituazioneLoaded(file.name);},
        error(){showToast('❌ Errore CSV situazione');}
      });
    };
    reader.readAsText(file,'UTF-8'); return;
  }
  if(typeof XLSX==='undefined'){showToast('⚠️ Libreria XLSX non caricata',4000);return;}
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const wb=XLSX.read(ev.target.result,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      situazione=parseSituazioneRows(XLSX.utils.sheet_to_json(ws,{header:1,defval:null}));
      onSituazioneLoaded(file.name);
    }catch(err){
      console.error(err); showToast('❌ Errore XLSX');
      if(errEl){errEl.textContent='❌ Errore lettura XLSX';errEl.style.display='block';}
    }
  };
  reader.readAsArrayBuffer(file);
}

function onSituazioneLoaded(fileName) {
  const inp=$id('xlsxFileInput'); if(inp) inp.value='';
  renderDispTable(); aggiornaListinoSelect(); aggiornaBadgePreventivo();
  showToast('✅ Situazione: '+situazione.length+' articoli');
  if($id('toggleRememberXLSX')?.checked)
    idbSet('situazione',{savedAt:Date.now(),name:fileName,data:situazione}).then(updateSavedXlsxInfo).catch(()=>{});
}

async function initXLSXMemory() {
  await updateSavedXlsxInfo();
  const p=await idbGet('situazione').catch(()=>null);
  if(p?.data?.length){situazione=p.data;renderDispTable();aggiornaListinoSelect();}
}

async function updateSavedXlsxInfo() {
  const p=await idbGet('situazione').catch(()=>null);
  const el=$id('savedXlsxInfo'); if(!el) return;
  el.textContent=p?.data?.length?'Salvata: "'+p.name+'" • '+p.data.length+' righe • '+new Date(p.savedAt).toLocaleString('it-IT'):'Nessuna situazione salvata.';
}

// ──────────────────────────────────────────────────────────
// DISPONIBILITÀ
// ──────────────────────────────────────────────────────────
function findDispRow(codice) {
  if(!situazione.length) return null;
  let r=situazione.find(s=>s.codice===codice); if(r) return r;
  r=situazione.find(s=>s.codice.split(/[-\s]+/).some(p=>p.trim()===codice)); if(r) return r;
  return situazione.find(s=>s.codice.startsWith(codice.slice(0,8)))??null;
}
function getDispNum(codice){const r=findDispRow(codice);return r?r.disponibilita:null;}
function arriviTot(r){return r.arriviS15+r.arriviS18+r.arriviMaggio+r.arriviGiugno;}
function arriviLabel(r){const p=[];if(r.arriviS15)p.push('S15:'+r.arriviS15);if(r.arriviS18)p.push('S18:'+r.arriviS18);if(r.arriviMaggio)p.push('Mag:'+r.arriviMaggio);if(r.arriviGiugno)p.push('Giu:'+r.arriviGiugno);return p.join(' ');}
function dispBadgeHTML(val,hasArr){if(val>5)return'<span class="disp-badge disp-ok">'+val+'</span>';if(val>0)return'<span class="disp-badge disp-low">'+val+'</span>';if(hasArr)return'<span class="disp-badge disp-arriving">0+</span>';return'<span class="disp-badge disp-zero">0</span>';}

let _dispFilter='all',_dispSearch='';

function getFilteredSituazione(){
  return situazione.filter(r=>{
    const q=_dispSearch.toLowerCase();
    if(q&&!r.codice.toLowerCase().includes(q)&&!r.descrizione.toLowerCase().includes(q)) return false;
    if(_dispFilter==='available') return r.disponibilita>0;
    if(_dispFilter==='zero')      return r.disponibilita===0;
    if(_dispFilter==='arriving')  return arriviTot(r)>0;
    if(_dispFilter==='noted')     return !!(r.note||r.prenotazioni);
    return true;
  });
}

function renderDispTable(){
  const wrap=$id('dispTableWrap'),filt=$id('dispFilters'),cntEl=$id('dispCount'),body=$id('dispBody');
  if(!wrap||!body) return;
  const rows=getFilteredSituazione();
  if(cntEl) cntEl.textContent=rows.length+' di '+situazione.length+' articoli';
  body.innerHTML=rows.map(r=>{
    const hasArr=arriviTot(r)>0;
    return'<tr><td><strong>'+esc(r.codice)+'</strong></td><td>'+esc(r.descrizione)+'</td>'
      +'<td class="num">'+dispBadgeHTML(r.disponibilita,hasArr)+'</td>'
      +'<td class="num">'+(r.arriviS15||'—')+'</td><td class="num">'+(r.arriviS18||'—')+'</td>'
      +'<td class="num">'+(r.arriviMaggio||'—')+'</td><td class="num">'+(r.arriviGiugno||'—')+'</td>'
      +'<td class="'+(r.note?'note-text':'')+'">'+esc(r.note)+'</td>'
      +'<td class="'+(r.prenotazioni?'prenotaz-text':'')+'">'+esc(r.prenotazioni)+'</td>'
      +'<td class="muted small">'+esc(r.infoExtra)+'</td></tr>';
  }).join('');
  wrap.style.display='block'; filt.style.display='block';
}

function exportDispCSV(){
  const rows=getFilteredSituazione();
  const lines=['Codice;Descrizione;Disp.;S15;S18;Maggio;Giugno;Note;Prenotazioni;Info'].concat(
    rows.map(r=>[r.codice,r.descrizione,r.disponibilita,r.arriviS15||'',r.arriviS18||'',
      r.arriviMaggio||'',r.arriviGiugno||'',r.note,r.prenotazioni,r.infoExtra].join(';')));
  downloadBlob('\ufeff'+lines.join('\n'),'situazione_'+new Date().toISOString().slice(0,10)+'.csv','text/csv;charset=utf-8');
}

// ──────────────────────────────────────────────────────────
// CALCOLI PREVENTIVO
// ──────────────────────────────────────────────────────────
function computeRow(a){
  const prezzoLordo=parseDec(a.prezzoLordo||0);
  const qta=Math.max(1,parseInt(a.quantita||1)||1);
  const useClient=!!smartSettings.showClientDiscount&&!a.__skipClient;
  let sc1=0,sc2=0,marg=0;
  if(useClient) sc1=clamp(parseDec(a.scontoCliente||0),0,100);
  else{ sc1=clamp(parseDec(a.sconto||0),0,100); sc2=clamp(parseDec(a.sconto2||0),0,100); marg=clamp(parseDec(a.margine||0),0,99.99); }
  const dopoS1=prezzoLordo*(1-sc1/100);
  const totaleNettoUnit=roundTwo(sc2>0?dopoS1*(1-sc2/100):dopoS1);
  // MARGINE % sul prezzo di vendita: prezzoVendita = costo / (1 - marg/100)
  // es. costo=1000, marg=20% → vendita=1250, margine=(1250-1000)/1250=20%
  const conMargineUnit=marg>0?roundTwo(totaleNettoUnit/(1-marg/100)):totaleNettoUnit;
  const trasporto=Math.max(0,parseDec(a.costoTrasporto||0));
  const installazione=Math.max(0,parseDec(a.costoInstallazione||0));
  const granTotRiga=roundTwo((conMargineUnit+trasporto+installazione)*qta);
  const venduto=parseDec(a.venduto||0);
  const differenzaUnit=roundTwo(conMargineUnit-venduto);
  const differenza=roundTwo(differenzaUnit*qta);
  return{prezzoLordo,qta,sconto1:sc1,sconto2:sc2,margine:marg,totaleNettoUnit,conMargineUnit,trasporto,installazione,granTotRiga,venduto,differenzaUnit,differenza};
}

function renderTabellaArticoli(){
  const body=$id('articoliBody'),emptyEl=$id('emptyMsg'); if(!body) return;
  if(!articoliAggiunti.length){body.innerHTML='';if(emptyEl)emptyEl.style.display='block';aggiornaTotali();return;}
  if(emptyEl) emptyEl.style.display='none';
  body.innerHTML=articoliAggiunti.map(buildRow).join('');
  body.querySelectorAll('input[data-field]').forEach(inp=>{
    inp.addEventListener('input',e=>{const c=sanitizeDecInput(e.target.value);if(e.target.value!==c)e.target.value=c;});
    inp.addEventListener('change',e=>{
      const idx=parseInt(inp.closest('tr')?.dataset.idx);
      if(!isNaN(idx)&&articoliAggiunti[idx]) articoliAggiunti[idx][inp.dataset.field]=e.target.value;
      aggiornaCalcoliRighe();aggiornaTotali();updateEquivDiscount();salvaPreventivo();
    });
  });
  body.querySelectorAll('.btn-remove').forEach(btn=>btn.addEventListener('click',()=>{
    articoliAggiunti.splice(parseInt(btn.dataset.idx),1);
    renderTabellaArticoli();aggiornaTotali();updateEquivDiscount();salvaPreventivo();
    refreshTranLinkSelect();
  }));
  body.querySelectorAll('.btn-up,.btn-down').forEach(btn=>btn.addEventListener('click',()=>{
    const idx=parseInt(btn.closest('tr').dataset.idx);
    const dest=btn.classList.contains('btn-up')?idx-1:idx+1;
    if(dest<0||dest>=articoliAggiunti.length) return;
    [articoliAggiunti[idx],articoliAggiunti[dest]]=[articoliAggiunti[dest],articoliAggiunti[idx]];
    renderTabellaArticoli();
  }));
  applyColumnVisibility();
}

function buildRow(a,idx){
  const r=computeRow(a);
  const dr=findDispRow(a.codice);
  const dispNum=dr?dr.disponibilita:null;
  const hasArr=dr?arriviTot(dr)>0:false;
  const badge=dispNum!==null?dispBadgeHTML(dispNum,hasArr):'—';
  const tt=dr?'Disp:'+dr.disponibilita+(arriviLabel(dr)?' | '+arriviLabel(dr):'')+(dr.note?' | '+dr.note:''):'';
  const inp=(field,val,im)=>'<input type="text" data-field="'+field+'" value="'+esc(String(val))+'" inputmode="'+(im||'decimal')+'" autocomplete="off"/>';
  return'<tr data-idx="'+idx+'">'
    +'<td data-col="codice"><strong>'+esc(a.codice)+'</strong></td>'
    +'<td data-col="descrizione">'+esc(a.descrizione)+'</td>'
    +'<td data-col="dispBadge" title="'+esc(tt)+'">'+badge+'</td>'
    +'<td data-col="prezzoLordo">'+fmtEur(r.prezzoLordo)+'</td>'
    +'<td data-col="sconto1">'+inp('sconto',fmtDec(r.sconto1,2,true))+'</td>'
    +'<td data-col="sconto2">'+inp('sconto2',fmtDec(r.sconto2,2,true))+'</td>'
    +'<td data-col="scontoCliente">'+inp('scontoCliente',fmtDec(parseDec(a.scontoCliente||0),2,true))+'</td>'
    +'<td data-col="margine">'+inp('margine',fmtDec(r.margine,2,true))+'</td>'
    +'<td data-col="totaleNetto">'+fmtEur(r.totaleNettoUnit)+'</td>'
    +'<td data-col="trasporto">'+inp('costoTrasporto',fmtDec(r.trasporto,2,true))+'</td>'
    +'<td data-col="installazione">'+inp('costoInstallazione',fmtDec(r.installazione,2,true))+'</td>'
    +'<td data-col="qta">'+inp('quantita',a.quantita||1,'numeric')+'</td>'
    +'<td data-col="granTot">'+fmtEur(r.granTotRiga)+'</td>'
    +'<td data-col="venduto">'+inp('venduto',fmtDec(parseDec(a.venduto||0),2,true))+'</td>'
    +'<td data-col="diff" class="'+(r.differenza>=0?'tot-positive':'tot-negative')+'">'+fmtEur(r.differenza)+'</td>'
    +'<td data-col="azioni"><div class="azioni-wrap">'
    +'<button class="btn-remove" data-idx="'+idx+'" title="Rimuovi">✕</button>'
    +'<button class="btn-move btn-up" title="Su">↑</button>'
    +'<button class="btn-move btn-down" title="Giù">↓</button>'
    +'</div></td></tr>';
}

function aggiornaCalcoliRighe(){
  const body=$id('articoliBody');if(!body)return;
  body.querySelectorAll('tr[data-idx]').forEach(tr=>{
    const idx=parseInt(tr.dataset.idx);const a=articoliAggiunti[idx];if(!a)return;
    const r=computeRow(a);
    const setTd=(col,v)=>{const td=tr.querySelector('td[data-col="'+col+'"]');if(td)td.textContent=v;};
    setTd('totaleNetto',fmtEur(r.totaleNettoUnit));setTd('granTot',fmtEur(r.granTotRiga));
    const diffTd=tr.querySelector('td[data-col="diff"]');
    if(diffTd){diffTd.textContent=fmtEur(r.differenza);diffTd.className=r.differenza>=0?'tot-positive':'tot-negative';}
    const dispTd=tr.querySelector('td[data-col="dispBadge"]');
    if(dispTd){const dr2=findDispRow(a.codice);const n2=dr2?dr2.disponibilita:null;const ha=dr2?arriviTot(dr2)>0:false;dispTd.innerHTML=n2!==null?dispBadgeHTML(n2,ha):'—';}
  });
}

function aggiornaBadgePreventivo(){aggiornaCalcoliRighe();}

function aggiornaTotali(){
  const card=$id('totaliCard'),el=$id('totaleGenerale');if(!el)return;
  if(!articoliAggiunti.length){if(card)card.style.display='none';return;}
  if(card)card.style.display='block';
  let tN=0,tC=0,tV=0,tD=0;
  articoliAggiunti.forEach(a=>{const r=computeRow(a);tN+=r.conMargineUnit*r.qta;tC+=r.granTotRiga;tV+=r.venduto*r.qta;tD+=r.differenza;});
  tN=roundTwo(tN);tC=roundTwo(tC);tV=roundTwo(tV);tD=roundTwo(tD);
  const vat=clamp(parseDec(smartSettings.vatRate??22),0,100);
  const iva=roundTwo(tC*vat/100),totIva=roundTwo(tC+iva);
  const rows=[['Totale netto (senza servizi)',fmtEur(tN),false],['Totale (con trasp./inst.)',fmtEur(tC),true]];
  if(!smartSettings.hideVenduto) rows.push(['Totale venduto',fmtEur(tV),false]);
  if(!smartSettings.hideDiff)    rows.push(['Totale diff.',fmtEur(tD),false]);
  if(smartSettings.showVAT){rows.push(['IVA ('+vat.toFixed(1)+'%)',fmtEur(iva),false]);rows.push(['Totale + IVA',fmtEur(totIva),true,'highlight']);}
  el.innerHTML='<table class="totali-table">'+rows.map(row=>'<tr class="'+(row[3]||'')+'"><td>'+(row[2]?'<strong>'+row[0]+'</strong>':row[0])+'</td><td class="num">'+(row[2]?'<strong>'+row[1]+'</strong>':row[1])+'</td></tr>').join('')+'</table>';
}

function updateEquivDiscount(){
  const el=$id('smartEquivalentDiscount');if(!el)return;
  let base=0,fin=0;
  articoliAggiunti.forEach(a=>{const r=computeRow(a);base+=parseDec(a.prezzoLordo)*r.qta;fin+=r.conMargineUnit*r.qta;});
  base=roundTwo(base);fin=roundTwo(fin);
  el.textContent=base?clamp((1-fin/base)*100,-9999,9999).toFixed(2)+'%':'—';
}

function applyColumnVisibility(){
  const hide=(col,h)=>document.querySelectorAll('[data-col="'+col+'"]').forEach(e=>e.classList.toggle('col-hidden',!!h));
  const client=!!smartSettings.showClientDiscount,smart=!!smartSettings.smartMode;
  hide('sconto1',client);hide('sconto2',client);hide('scontoCliente',!client);
  hide('margine',smart||client);hide('prezzoLordo',smart);
  hide('venduto',smart||smartSettings.hideVenduto);hide('diff',smart||smartSettings.hideDiff);
}

function newArticoloFrom(base){
  return{codice:base.codice,descrizione:base.descrizione,prezzoLordo:base.prezzoLordo,
    sconto:0,sconto2:0,margine:0,scontoCliente:0,
    costoTrasporto:autoCosti?base.costoTrasporto:0,costoInstallazione:autoCosti?base.costoInstallazione:0,
    quantita:1,venduto:0};
}

function aggiungiDaListino(){
  const sel=$id('listinoSelect');if(!sel?.value){showToast('⚠️ Nessun articolo');return;}
  const item=listino.find(i=>i.codice===sel.value);if(!item)return;
  const dr=findDispRow(item.codice);
  if(dr){
    const arr=arriviLabel(dr),hint=$id('dispHint');
    if(hint){
      hint.innerHTML='<span style="color:var(--tran);font-weight:600">📦 '+esc(item.codice)+' — Disp: '+dr.disponibilita+(arr?' | '+arr:'')+(dr.note?' | '+esc(dr.note):'')+' </span>';
      hint.style.display='block';
    }
  }
  articoliAggiunti.push(newArticoloFrom(item));
  renderTabellaArticoli();aggiornaTotali();updateEquivDiscount();salvaPreventivo();refreshTranLinkSelect();
  showToast('✅ Aggiunto: '+item.descrizione);
}

function aggiungiManuale(){
  const codice=$val('manCodice').trim(),descrizione=$val('manDescrizione').trim();
  if(!codice||!descrizione){showToast('⚠️ Codice e descrizione obbligatori');return;}
  articoliAggiunti.push({codice,descrizione,prezzoLordo:parseDec($val('manPrezzo')),
    costoTrasporto:parseDec($val('manTrasporto')),costoInstallazione:parseDec($val('manInstallazione')),
    sconto:0,sconto2:0,margine:0,scontoCliente:0,quantita:1,venduto:0});
  ['manCodice','manDescrizione','manPrezzo','manTrasporto','manInstallazione'].forEach(id=>$setVal(id,''));
  renderTabellaArticoli();aggiornaTotali();updateEquivDiscount();salvaPreventivo();refreshTranLinkSelect();
  showToast('✅ Aggiunto: '+codice);
}

function computeEquivClientDiscount(a){
  const pL=parseDec(a.prezzoLordo||0);if(pL<=0)return 0;
  const r=computeRow({...a,__skipClient:true});
  return clamp((1-r.conMargineUnit/pL)*100,0,100);
}

function applyClientDiscountMode(enabled){
  articoliAggiunti=articoliAggiunti.map(a=>{
    const item={...a};
    if(enabled){
      item._bakSconto=item._bakSconto??parseDec(item.sconto||0);
      item._bakSconto2=item._bakSconto2??parseDec(item.sconto2||0);
      item._bakMargine=item._bakMargine??parseDec(item.margine||0);
      item.scontoCliente=computeEquivClientDiscount(item);
      item.sconto=0;item.sconto2=0;item.margine=0;
    }else{
      if(item._bakSconto!==undefined)item.sconto=item._bakSconto;
      if(item._bakSconto2!==undefined)item.sconto2=item._bakSconto2;
      if(item._bakMargine!==undefined)item.margine=item._bakMargine;
    }
    return item;
  });
  renderTabellaArticoli();aggiornaTotali();updateEquivDiscount();
}

async function salvaPreventivo(){
  try{await idbSet('prev_wip',{savedAt:Date.now(),titolo:$val('preventivoTitolo')||'',articoli:articoliAggiunti});}catch(_){}
}

async function ripristinaPreventivo(){
  try{
    const p=await idbGet('prev_wip');if(!p?.articoli?.length)return;
    articoliAggiunti=p.articoli;if(p.titolo)$setVal('preventivoTitolo',p.titolo);
    renderTabellaArticoli();aggiornaTotali();updateEquivDiscount();refreshTranLinkSelect();
    showToast('🔄 Preventivo precedente ripristinato ('+articoliAggiunti.length+' articoli)',3500);
  }catch(_){}
}

function generaReport(opts){
  opts=opts||{};const noMargine=!!opts.noMargine;const client=!!smartSettings.showClientDiscount;
  const titolo=$val('preventivoTitolo')||'PREVENTIVO';
  const lines=[titolo.toUpperCase()+' — '+today(),'═'.repeat(44),''];
  let tN=0,tC=0;
  articoliAggiunti.forEach((a,i)=>{
    const r=computeRow(a);const pD=noMargine?r.totaleNettoUnit:r.conMargineUnit;
    lines.push((i+1)+'. '+a.codice+' — '+a.descrizione);
    if(!smartSettings.hideDiscounts&&!noMargine){
      if(client){lines.push('   Sc.cliente: '+clamp(parseDec(a.scontoCliente||0),0,100).toFixed(2)+'%');}
      else{if(r.sconto1)lines.push('   Sc.1: '+fmtDec(r.sconto1,2,true)+'%');if(r.sconto2)lines.push('   Sc.2: '+fmtDec(r.sconto2,2,true)+'%');if(r.margine)lines.push('   Marg.: '+fmtDec(r.margine,2,true)+'%');}
    }
    lines.push('   Prezzo netto: '+fmtEur(pD));lines.push('   Qtà: '+r.qta);
    if(r.trasporto)lines.push('   Trasporto: '+fmtEur(r.trasporto));
    if(r.installazione)lines.push('   Installazione: '+fmtEur(r.installazione));
    const totRiga=roundTwo((pD+r.trasporto+r.installazione)*r.qta);
    lines.push('   Totale riga: '+fmtEur(totRiga));
    if(!smartSettings.hideVenduto&&!noMargine)lines.push('   Venduto a: '+fmtEur(r.venduto));
    if(!smartSettings.hideDiff&&!noMargine)lines.push('   Diff.: '+fmtEur(r.differenza));
    lines.push('');tN+=pD*r.qta;tC+=totRiga;
  });
  lines.push('─'.repeat(44));
  lines.push('Totale netto:       '+fmtEur(roundTwo(tN)));
  lines.push('Totale complessivo: '+fmtEur(roundTwo(tC)));
  if(smartSettings.showVAT){const vat=clamp(parseDec(smartSettings.vatRate??22),0,100);const iva=roundTwo(tC*vat/100);lines.push('IVA ('+vat.toFixed(1)+'%):        '+fmtEur(iva));lines.push('TOTALE + IVA:       '+fmtEur(roundTwo(tC+iva)));}
  return lines.join('\n');
}

function mostraPreview(content){
  const el=$id('reportPreview');if(!el)return;
  el.textContent=content;el.style.display='block';
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function downloadBlob(content,filename,type){
  type=type||'text/plain;charset=utf-8';
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
  if(isIOS){const w=window.open(url,'_blank');if(!w)showToast('⚠️ Popup bloccato',4000);else showToast('📄 Aperto: Condividi → Salva in File',5000);setTimeout(()=>URL.revokeObjectURL(url),30000);return;}
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}

function bindSmartControls(){
  const map={toggleSmartMode:'smartMode',toggleShowVAT:'showVAT',toggleHideVenduto:'hideVenduto',toggleHideDiff:'hideDiff',toggleHideDiscounts:'hideDiscounts',toggleShowClientDiscount:'showClientDiscount'};
  Object.entries(map).forEach(([id,key])=>{const el=$id(id);if(el)el.checked=!!smartSettings[key];});
  $setVal('vatRate',String(smartSettings.vatRate));
  const elAC=$id('toggleAutoCosti');if(elAC)elAC.checked=autoCosti;
  const onChange=()=>{
    const prevClient=!!smartSettings.showClientDiscount;
    Object.entries(map).forEach(([id,key])=>{const el=$id(id);if(el)smartSettings[key]=el.checked;});
    smartSettings.vatRate=clamp(parseDec($val('vatRate')||'22'),0,100);
    autoCosti=!!$id('toggleAutoCosti')?.checked;
    if(smartSettings.smartMode)smartSettings.hideVenduto=smartSettings.hideDiff=smartSettings.hideDiscounts=true;
    saveSettings();
    if(prevClient!==smartSettings.showClientDiscount){applyClientDiscountMode(smartSettings.showClientDiscount);return;}
    applyColumnVisibility();aggiornaCalcoliRighe();aggiornaTotali();updateEquivDiscount();
  };
  [...Object.keys(map),'vatRate','toggleAutoCosti'].forEach(id=>$id(id)?.addEventListener('change',onChange));
}

// ══════════════════════════════════════════════════════════
// MOTORE TRASPORTO
// Portato da app.js di Trasporti-Use-Friendly
// © Alessandro Pezzali – PezzaliAPP
// ══════════════════════════════════════════════════════════

async function loadTranData(){
  const statusEl=$id('tranDataStatus'),errEl=$id('tranDataError');
  try{
    const [palletRates,groupageRates,geo,articles] = await Promise.all([
      fetch('data/pallet_rates_by_region.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('pallet_rates');return r.json();}),
      fetch('data/groupage_rates.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('groupage_rates');return r.json();}),
      fetch('data/geo_provinces.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('data/articles.json',{cache:'no-store'}).then(r=>r.ok?r.json():[]).catch(()=>[]),
    ]);
    TRAN.palletRates=palletRates;
    TRAN.groupageRates=groupageRates;
    TRAN.geo=geo;
    TRAN.articles=Array.isArray(articles)?articles:[];
    TRAN.loaded=true;

    if(statusEl){statusEl.textContent='✅ Tariffe caricate: '+Object.keys(palletRates.rates||{}).length+' regioni PALLET · '+Object.keys(groupageRates.provinces||{}).length+' gruppi Groupage · '+TRAN.articles.length+' articoli';statusEl.style.display='block';}
    if(errEl)errEl.style.display='none';

    populateTranSelects();
    updateTranServiceUI();
    updateTranDebug();

  }catch(err){
    console.error('loadTranData:',err);
    if(errEl){errEl.textContent='❌ Errore caricamento tariffe: '+err.message+'. Verifica che i file JSON siano nella cartella /data/';errEl.style.display='block';}
    if(statusEl)statusEl.style.display='none';
  }
}

function populateTranSelects(){
  // Regioni (da palletRates)
  const regionSel=$id('tranRegion');if(!regionSel)return;
  regionSel.innerHTML='<option value="">— Seleziona Regione —</option>';
  const regions=TRAN.palletRates?.meta?.regions||Object.keys(TRAN.palletRates?.rates||{});
  regions.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;regionSel.appendChild(o);});

  // Tipi bancale (da palletRates)
  const palletSel=$id('tranPalletType');if(palletSel){
    palletSel.innerHTML='<option value="">— Tipo bancale —</option>';
    const types=TRAN.palletRates?.meta?.palletTypes||[];
    types.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;palletSel.appendChild(o);});
  }

  // Province inizialmente vuote (popolate on region change)
  updateTranProvinces('');
}

function updateTranProvinces(region){
  const sel=$id('tranProvince');if(!sel)return;
  sel.innerHTML='<option value="">— Seleziona Provincia —</option>';
  if(!region)return;

  // Usa geo_provinces.json se disponibile
  let provinces=[];
  if(TRAN.geo&&TRAN.geo[region]){
    provinces=TRAN.geo[region];
  }else{
    // Fallback: ricava le province dai gruppi groupage
    const seen=new Set();
    Object.keys(TRAN.groupageRates?.provinces||{}).forEach(grp=>{
      grp.split(/[\s,\/\-]+/).forEach(p=>{p=p.trim();if(p.length===2)seen.add(p);});
    });
    provinces=[...seen].sort();
  }

  provinces.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;sel.appendChild(o);});
}

function updateTranServiceUI(){
  const svc=$val('tranService');
  const isPallet=svc==='PALLET';
  const show=(id,yes)=>{const e=$id(id);if(e)e.style.display=yes?'':'none';};
  show('tranPalletTypeField',isPallet);
  show('tranQtyField',        isPallet);  // qty bancali: solo per PALLET
  show('tranProvinceField',  !isPallet);
  show('tranLmField',        !isPallet);
  show('tranQuintaliField',  !isPallet);
  show('tranPalletCountField',!isPallet);
}

function updateTranDebug(){
  const el=$id('tranDebug');if(!el)return;
  if(!TRAN.loaded){el.textContent='—';return;}
  const regionCount=Object.keys(TRAN.palletRates?.rates||{}).length;
  const groupCount=Object.keys(TRAN.groupageRates?.provinces||{}).length;
  el.innerHTML='<b>PALLET:</b> '+regionCount+' regioni | '
    +'<b>Groupage:</b> '+groupCount+' gruppi province | '
    +''
    +'<b>Assicurazione:</b> '+(TRAN.palletRates?.meta?.insurance_pct*100||3)+'%';
}

// ── LOGICA CALCOLO (portata da app.js Trasporti-Use-Friendly) ──

function round2(x){return Math.round((x+Number.EPSILON)*100)/100;}

function normalizeProvince(p){
  const x=(p||'').trim().toUpperCase();
  if(x==='SU')return'CI';
  return x;
}

function resolveGroupageProvinceKey(rawProvince){
  const province=normalizeProvince(rawProvince);
  if(!province||!TRAN.groupageRates?.provinces)return null;
  const provinces=TRAN.groupageRates.provinces;

  // 1) corrispondenza esatta con chiave singola
  if(provinces[province])return{key:province,data:provinces[province],matchedBy:'exact'};

  // 2) cerca nel gruppo per token di 2 lettere (es. "TO BI VB VC", "MT / PZ")
  for(const[key,data]of Object.entries(provinces)){
    const tokens=key.split(/[\s,\/\-;]+/).map(t=>t.trim().toUpperCase()).filter(t=>t.length===2&&/^[A-Z]{2}$/.test(t));
    if(tokens.includes(province))return{key,data,matchedBy:'group'};
  }

  // 3) fallback per regione: usa il campo "region" della chiave groupage
  // Necessario per province come CA/SS/NU/OR/SU (Sardegna → chiave "TUTTE")
  // e per qualsiasi altra provincia coperta da una chiave regionale
  if(TRAN.geo){
    // Trova la regione della provincia tramite geo_provinces.json
    let provRegion=null;
    const rawUp=(rawProvince||'').trim().toUpperCase();
    for(const[reg,provs]of Object.entries(TRAN.geo)){
      if(provs.includes(rawUp)||provs.includes(province)){provRegion=reg;break;}
    }
    if(provRegion){
      for(const[key,data]of Object.entries(provinces)){
        const dr=(data.region||'').toUpperCase();
        // match esatto o parziale (es "EMILIA R." vs "EMILIA + SAN MARINO")
        if(dr&&(dr===provRegion.toUpperCase()||provRegion.toUpperCase().startsWith(dr.replace(/[^A-Z]/g,'').slice(0,5)))){
          return{key,data,matchedBy:'region_fallback',region:provRegion};
        }
      }
    }
  }

  return null;
}

function matchGroupageBracket(value,brackets){
  if(!Array.isArray(brackets)||brackets.length===0)return{bracket:null,overflow:false};
  const bs=brackets.slice().sort((a,b)=>(a.min??0)-(b.min??0));
  for(const b of bs){
    const okMin=value>=(b.min??0);
    const okMax=(b.max==null)?true:value<=b.max;
    if(okMin&&okMax)return{bracket:b,overflow:false};
  }
  return{bracket:bs[bs.length-1],overflow:true};
}

function applyKmAndDisagiata({base,shipments,opts,rules,alerts,mode}){
  const kmThreshold=TRAN.groupageRates?.meta?.km_threshold??30;
  const kmSurcharge=TRAN.groupageRates?.meta?.km_surcharge_per_km??0;
  const disFee=TRAN.groupageRates?.meta?.disagiata_surcharge??0;
  const kmOver=Math.max(0,parseInt(opts?.kmOver||0,10)||0);

  if(kmOver>0){
    alerts.push('Distanza extra: +'+kmOver+' km (oltre '+kmThreshold+' km). Verificare condizioni.');
    if(kmSurcharge>0){
      base+=(kmOver*kmSurcharge)*(mode==='PALLET'?shipments:1);
      rules.push('km+'+kmOver);
    }
  }
  if(opts?.disagiata){
    alerts.push('Località disagiata: possibile extra / preventivo.');
    if(disFee>0){base+=disFee*(mode==='PALLET'?shipments:1);rules.push('disagiata');}
    else rules.push('disagiata(info)');
  }
  return base;
}

function computePallet({region,palletType,qty,opts}){
  const rules=[],alerts=[];
  if(!region)return{cost:null,rules:['Manca regione'],alerts:['Seleziona una regione.']};
  if(!palletType)return{cost:null,rules:['Manca tipo bancale'],alerts:['Seleziona il tipo bancale.']};
  const rate=TRAN.palletRates?.rates?.[region]?.[palletType];
  if(rate==null)return{cost:null,rules:['Tariffa non trovata'],alerts:['Nessuna tariffa per '+region+' / '+palletType+'.']};
  const maxPerShipment=TRAN.palletRates?.meta?.maxPalletsPerShipment??5;
  const shipments=Math.ceil(qty/maxPerShipment);
  if(shipments>1){rules.push('split:'+shipments);alerts.push('Qty > '+maxPerShipment+': '+shipments+' spedizioni (stima).');}
  let base=rate*qty;
  if(opts.preavviso&&TRAN.palletRates?.meta?.preavviso_fee!=null){base+=TRAN.palletRates.meta.preavviso_fee*shipments;rules.push('preavviso');}
  if(opts.assicurazione&&TRAN.palletRates?.meta?.insurance_pct!=null){base=base*(1+TRAN.palletRates.meta.insurance_pct);rules.push('assicurazione');}
  base=applyKmAndDisagiata({base,shipments,opts,rules,alerts,mode:'PALLET'});
  return{cost:round2(base),rules,alerts};
}

function computeGroupage({province,lm,quintali,palletCount,opts}){
  const rules=[],alerts=[];
  if(!province)return{cost:null,rules:['Manca provincia'],alerts:['Seleziona una provincia.']};
  const resolved=resolveGroupageProvinceKey(province);
  if(!resolved)return{cost:null,rules:['Provincia non trovata'],alerts:['Nessuna tariffa groupage per '+province+'.']};
  const p=resolved.data;
  if(resolved.matchedBy==='group'){rules.push('provGroup:'+resolved.key);alerts.push('Provincia '+province+' → gruppo: '+resolved.key);}
  const candidates=[];let overflow=false;
  if(lm>0&&Array.isArray(p.linearMeters)){const r=matchGroupageBracket(lm,p.linearMeters);if(r.bracket&&r.bracket.price!=null){candidates.push({mode:'lm',price:r.bracket.price,overflow:r.overflow});if(r.overflow)overflow=true;}}
  if(quintali>0&&Array.isArray(p.quintali)){const r=matchGroupageBracket(quintali,p.quintali);if(r.bracket&&r.bracket.price!=null){candidates.push({mode:'quintali',price:r.bracket.price,overflow:r.overflow});if(r.overflow)overflow=true;}}
  if(palletCount>0&&Array.isArray(p.pallets)){const r=matchGroupageBracket(palletCount,p.pallets);if(r.bracket&&r.bracket.price!=null){candidates.push({mode:'pallets',price:r.bracket.price,overflow:r.overflow});if(r.overflow)overflow=true;}}
  if(overflow){alerts.push('Valori oltre fascia listino: stima a cap (consigliato preventivo).');rules.push('overflow');}
  if(candidates.length===0)return{cost:null,rules:['Nessun parametro valido'],alerts:['Inserisci almeno uno tra LM / Quintali / N° bancali.']};
  const selMode=(TRAN.groupageRates?.meta?.selection_mode||'max').toLowerCase();
  let picked;
  if(selMode==='min'){picked=candidates.reduce((b,c)=>(b==null||c.price<b.price)?c:b,null);rules.push('pick:min:'+picked.mode);}
  else{picked=candidates.reduce((w,c)=>(w==null||c.price>w.price)?c:w,null);rules.push('pick:max:'+picked.mode);}
  let base=picked.price;
  if(opts.sponda&&TRAN.groupageRates?.meta?.liftgate_fee!=null){base+=TRAN.groupageRates.meta.liftgate_fee;rules.push('sponda');}
  if(opts.preavviso&&TRAN.groupageRates?.meta?.preavviso_fee!=null){base+=TRAN.groupageRates.meta.preavviso_fee;rules.push('preavviso');}
  if(opts.assicurazione&&TRAN.groupageRates?.meta?.insurance_pct!=null){base=base*(1+TRAN.groupageRates.meta.insurance_pct);rules.push('assicurazione');}
  base=applyKmAndDisagiata({base,shipments:1,opts,rules,alerts,mode:'GROUPAGE'});
  return{cost:round2(base),rules,alerts};
}

// ── AZIONE CALCOLA TRASPORTO ──
function onTranCalc(){
  if(!TRAN.loaded){showToast('⚠️ Dati tariffe non ancora caricati',3000);return;}
  // Se c'è un articolo selezionato non ancora applicato, applicalo ora
  const linkIdx=parseInt($val('tranLinkArticle'));
  if(!isNaN(linkIdx)&&articoliAggiunti[linkIdx]){
    applyTranFromArticolo_byIdx(linkIdx);
  }

  const svc=$val('tranService');
  const region=($val('tranRegion')||'').trim().toUpperCase();
  const province=normalizeProvince($val('tranProvince'));
  const palletType=($val('tranPalletType')||'').trim();
  const qty=Math.max(1,parseInt($val('tranQty')||'1',10));
  const lm=parseFloat($val('tranLm')||'0')||0;
  const quintali=parseFloat($val('tranQuintali')||'0')||0;
  const palletCount=parseFloat($val('tranPalletCount')||'0')||0;
  const kmOver=parseInt($val('tranKmOver')||'0',10)||0;
  const opts={
    preavviso:!!$id('tranPreavviso')?.checked,
    assicurazione:!!$id('tranAssicurazione')?.checked,
    sponda:!!$id('tranSponda')?.checked,
    disagiata:!!$id('tranDisagiata')?.checked,
    kmOver
  };

  let out;
  if(svc==='PALLET') out=computePallet({region,palletType,qty,opts});
  else               out=computeGroupage({province,lm,quintali,palletCount,opts});

  // Costo + markup 30% (come nell'app originale)
  const costBase=out.cost;
  const costCliente=Number.isFinite(costBase)?round2(costBase*1.3):null;

  lastTranResult={svc,region,province,palletType,qty,lm,quintali,palletCount,opts,out,costBase,costCliente};

  // Render risultato
  const resultCard=$id('tranResultCard');if(resultCard)resultCard.style.display='block';
  $id('tranCostValue').textContent=moneyEUR(costCliente);
  $id('tranCostBase').textContent=Number.isFinite(costBase)?'Base (no markup): '+fmtEur(costBase):'';

  // Riepilogo
  const lines=[];
  lines.push('Servizio: '+svc);
  if(svc==='PALLET'){lines.push('Regione: '+(region||'—'));lines.push('Bancale: '+(palletType||'—'));lines.push('Quantità: '+qty);}
  else{lines.push('Provincia: '+province);if(lm)lines.push('LM: '+lm);if(quintali)lines.push('Quintali: '+quintali);if(palletCount)lines.push('N° bancali: '+palletCount);}
  if(kmOver)lines.push('Km extra: '+kmOver);
  const optsArr=[];
  if(opts.disagiata)optsArr.push('disagiata');if(opts.preavviso)optsArr.push('preavviso');if(opts.assicurazione)optsArr.push('assicurazione');if(opts.sponda)optsArr.push('sponda');
  if(optsArr.length)lines.push('Opzioni: '+optsArr.join(', '));
  if(out.rules?.length)lines.push('Regole: '+out.rules.join(' | '));
  lines.push('');
  lines.push('COSTO PREVENTIVATO: '+moneyEUR(costCliente));
  const extraNote=$val('tranNoteExtra');if(extraNote)lines.push('Note: '+extraNote);
  $id('tranSummary').textContent=lines.join('\n');

  // Alert
  const alertsEl=$id('tranAlerts');alertsEl.innerHTML='';
  (out.alerts||[]).forEach(a=>{
    const d=document.createElement('div');d.className='tran-alert';d.textContent='⚠️ '+a;alertsEl.appendChild(d);
  });
  if(!Number.isFinite(costBase)){
    const d=document.createElement('div');d.className='tran-alert danger';d.textContent='❌ Impossibile calcolare: '+(out.alerts||[]).join(' ');alertsEl.appendChild(d);
  }

  // Abilita pulsante aggiungi al preventivo
  const addBtn=$id('btnTranAddToPreventivo');
  if(addBtn)addBtn.disabled=!Number.isFinite(costCliente);

  resultCard?.scrollIntoView({behavior:'smooth',block:'nearest'});
}

// ── COLLEGA ARTICOLO DAL PREVENTIVO ──
function refreshTranLinkSelect(){
  // Aggiorna select singolo
  const sel=$id('tranLinkArticle');
  if(sel){
    sel.innerHTML='<option value="">— Seleziona articolo dal preventivo —</option>';
    articoliAggiunti.forEach((a,idx)=>{
      const o=document.createElement('option');
      o.value=idx;
      o.textContent=(idx+1)+'. '+a.codice+' — '+a.descrizione+(a.quantita>1?' (×'+a.quantita+')':'');
      sel.appendChild(o);
    });
  }
  // Aggiorna lista multi se visibile
  if($id('tranModeMulti')?.checked) refreshTranMultiList();

  $setText('tranLinkInfo', articoliAggiunti.length?'':'Aggiungi prima articoli nel tab Preventivo.');
}

// ── Normalizzazione per match articolo (identica a Trasporti-Use-Friendly) ──
function normCode(s){
  return (s||'').toString().trim().toLowerCase().replace(/[^a-z0-9]/g,'');
}

/**
 * Cerca in TRAN.articles l'articolo che corrisponde al codice o descrizione
 * del preventivo. Strategia (in ordine):
 * 1. match esatto codice (normalizzato)
 * 2. codice CSV contenuto nel code articolo o viceversa
 * 3. nome articolo contenuto nella descrizione CSV o viceversa
 */
function findTranArticle(codice, descrizione){
  if(!TRAN.articles.length) return null;
  const nc = normCode(codice);
  const nd = normCode(descrizione);

  // 1) codice esatto
  let found = TRAN.articles.find(a => normCode(a.code||'') === nc);
  if(found) return found;

  // 2) codice parziale
  found = TRAN.articles.find(a => {
    const ac = normCode(a.code||'');
    return ac && (ac.includes(nc) || nc.includes(ac));
  });
  if(found) return found;

  // 3) nome nella descrizione
  found = TRAN.articles.find(a => {
    const an = normCode(a.name||'');
    return an.length>3 && (an.includes(nd) || nd.includes(an));
  });
  return found || null;
}

// ── MULTI-ARTICOLO: aggiorna lista checkbox ──
function refreshTranMultiList(){
  const container=$id('tranMultiCheckList');
  if(!container)return;
  container.innerHTML='';
  if(!articoliAggiunti.length){
    container.innerHTML='<p class="muted small">Aggiungi prima articoli nel tab Preventivo.</p>';
    return;
  }
  articoliAggiunti.forEach((a,idx)=>{
    const div=document.createElement('div');
    div.className='tran-multi-item';
    div.dataset.idx=idx;
    div.innerHTML='<input type="checkbox" id="tranMultiChk'+idx+'" value="'+idx+'"/>'
      +'<label for="tranMultiChk'+idx+'" style="cursor:pointer;flex:1">'
      +'<strong>'+esc(a.codice)+'</strong> — '+esc(a.descrizione)
      +(a.quantita>1?' <span class="muted">(×'+a.quantita+')</span>':'')
      +'</label>';
    // click su tutta la riga seleziona il checkbox
    div.addEventListener('click',e=>{
      if(e.target.tagName==='INPUT')return;
      const chk=div.querySelector('input[type="checkbox"]');
      if(chk){chk.checked=!chk.checked;div.classList.toggle('selected',chk.checked);}
    });
    div.querySelector('input').addEventListener('change',e=>{
      div.classList.toggle('selected',e.target.checked);
    });
    container.appendChild(div);
  });
}

// ── MULTI-ARTICOLO: cerca combinazione in articles.json ──
function cercaCombinazione(){
  // Raccoglie gli articoli selezionati
  const checked=[...document.querySelectorAll('#tranMultiCheckList input[type="checkbox"]:checked')]
    .map(c=>parseInt(c.value))
    .filter(i=>!isNaN(i)&&articoliAggiunti[i]);

  if(checked.length===0){showToast('⚠️ Seleziona almeno un articolo');return;}

  const selItems=checked.map(i=>articoliAggiunti[i]);
  const selNorms=selItems.map(a=>({orig:a,n:normCode(a.codice)+' '+normCode(a.descrizione)}));

  const resultCard=$id('tranComboResult');
  const titleEl=$id('tranComboTitle');
  const optionsEl=$id('tranComboOptions');
  const manualEl=$id('tranComboManual');
  if(!resultCard)return;

  resultCard.style.display='block';
  optionsEl.innerHTML='';

  // Se articolo singolo: usa logica normale
  if(checked.length===1){
    applyTranFromArticolo_byIdx(checked[0]);
    resultCard.style.display='none';
    return;
  }

  // ── Costruisce le query di ricerca ──
  // Per ogni combinazione in articles.json, calcola quante parti matchano
  const results=[];

  TRAN.articles.forEach(art=>{
    const artName=(art.name||'');
    // Scompone il nome in parti (split su +)
    const artParts=artName.split('+').map(p=>normCode(p.trim())).filter(Boolean);
    if(artParts.length<2)return; // solo combinazioni

    // Conta quanti articoli selezionati matchano le parti
    let matchedParts=0;
    const matchDetail=[];

    artParts.forEach(ap=>{
      const matchedItem=selNorms.find(sn=>sn.n.includes(ap)||ap.includes(normCode(sn.orig.descrizione)));
      if(matchedItem){matchedParts++;matchDetail.push({part:ap,item:matchedItem.orig});}
    });

    const score=matchedParts/artParts.length;
    if(score>0){
      results.push({art,artParts,matchedParts,totalParts:artParts.length,score,matchDetail});
    }
  });

  // Ordina per score desc
  results.sort((a,b)=>b.score-a.score||b.matchedParts-a.matchedParts);

  const topResults=results.slice(0,5);
  const nomiSel=selItems.map(a=>a.descrizione).join(' + ');

  if(topResults.length===0){
    // Nessuna combinazione trovata → mostra selezione manuale
    titleEl.textContent='Nessuna combinazione trovata per: '+nomiSel;
    titleEl.style.color='var(--warning)';
    optionsEl.innerHTML='<p class="muted small">Nessuna combinazione corrispondente in archivio. Seleziona la taglia bancale manualmente:</p>';
    manualEl.style.display='block';
    populateComboPalletTypeSelect();
    $setText('tranLinkInfo','Combinazione non in archivio — seleziona taglia manualmente');
    return;
  }

  // Match esatto (score=1): applica subito
  const exact=topResults.find(r=>r.score===1);
  if(exact){
    titleEl.textContent='✅ Combinazione trovata: '+exact.art.name;
    titleEl.style.color='var(--tran)';
    optionsEl.innerHTML='';
    manualEl.style.display='none';
    applyTranArticleData(exact.art, selItems);
    // Mostra anche il risultato visivo
    const div=document.createElement('div');
    div.className='tran-combo-option exact';
    div.innerHTML='<span class="combo-name">'+esc(exact.art.name)+'</span>'
      +'<span class="combo-pallet">'+esc(exact.art.pack?.palletType||'—')+'</span>';
    optionsEl.appendChild(div);
    return;
  }

  // Risultati parziali: mostra opzioni cliccabili
  titleEl.textContent='Combinazioni simili trovate — scegli quella corretta:';
  titleEl.style.color='var(--warning)';
  manualEl.style.display='block';
  populateComboPalletTypeSelect();

  topResults.forEach(r=>{
    const pct=Math.round(r.score*100);
    const div=document.createElement('div');
    div.className='tran-combo-option';
    div.innerHTML='<span>'
      +'<span class="combo-name">'+esc(r.art.name)+'</span>'
      +'<span class="combo-match"> ('+pct+'% corrispondente)</span>'
      +'</span>'
      +'<span class="combo-pallet">'+esc(r.art.pack?.palletType||'—')+'</span>';
    div.addEventListener('click',()=>{
      // Evidenzia la scelta
      document.querySelectorAll('.tran-combo-option').forEach(el=>el.classList.remove('exact'));
      div.classList.add('exact');
      applyTranArticleData(r.art, selItems);
      titleEl.textContent='✅ Applicato: '+r.art.name;
      titleEl.style.color='var(--tran)';
    });
    optionsEl.appendChild(div);
  });

  $setText('tranLinkInfo','Seleziona la combinazione corretta tra quelle suggerite.');
}

function populateComboPalletTypeSelect(){
  const sel=$id('tranComboPalletType');
  if(!sel||sel.options.length>1)return; // già popolato
  const types=TRAN.palletRates?.meta?.palletTypes||[];
  types.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;sel.appendChild(o);});
}

// Applica dati da un articolo trasporti (usato sia dal singolo che dal multi)
function applyTranArticleData(tranArt, selItems){
  const rules=tranArt?.rules||{};
  const note=tranArt?.note||tranArt?.notes||tranArt?.nota||'';
  const noteUp=(note||'').toUpperCase();
  const forceGroupage=!!(rules.forceService==='GROUPAGE'||noteUp.includes('GROUPAGE'));

  // Servizio
  const svcToSet=forceGroupage?'GROUPAGE':'PALLET';
  $setVal('tranService',svcToSet);
  updateTranServiceUI();

  // Quantità (somma o 1)
  const totalQty=selItems.reduce((s,a)=>s+Math.max(1,parseInt(a.quantita||1)||1),0);
  $setVal('tranQty',String(Math.max(1,totalQty)));

  const msgs=['Servizio: '+svcToSet+' · Qtà totale: '+totalQty];
  // Highlight campi obbligatori ancora da compilare
  const needRegion=$id('tranRegion');
  const needProvince=$id('tranProvince');
  if(needRegion&&!needRegion.value){
    needRegion.style.borderColor='var(--warning)';
    needRegion.style.boxShadow='0 0 0 3px rgba(230,81,0,.18)';
  }
  if(svcToSet==='GROUPAGE'&&needProvince&&!needProvince.value){
    needProvince.style.borderColor='var(--warning)';
    needProvince.style.boxShadow='0 0 0 3px rgba(230,81,0,.18)';
  }

  if(svcToSet==='PALLET'){
    const pt=(tranArt?.pack?.palletType||'').trim();
    const palletSel=$id('tranPalletType');
    if(pt&&palletSel){
      const opts=[...palletSel.options].filter(o=>o.value);
      const match=opts.find(o=>o.value.toUpperCase()===pt.toUpperCase());
      if(match){palletSel.value=match.value;msgs.push('✅ Bancale: '+match.value);}
      else msgs.push('⚠️ Bancale "'+pt+'" non trovato — selezionalo manualmente');
    } else msgs.push('⚠️ Taglia bancale non disponibile — selezionala manualmente');
  }

  if(svcToSet==='GROUPAGE'){
    if(rules.groupageLm!=null){$setVal('tranLm',String(rules.groupageLm));msgs.push('LM: '+rules.groupageLm+' m');}
    if(rules.groupageQuintali!=null) $setVal('tranQuintali',String(rules.groupageQuintali));
    if(rules.groupagePalletCount!=null) $setVal('tranPalletCount',String(rules.groupagePalletCount));
    if(rules.noSponda){const sp=$id('tranSponda');if(sp){sp.checked=false;sp.disabled=true;}msgs.push('⚠️ Sponda N/D');}
    else{const sp=$id('tranSponda');if(sp)sp.disabled=false;}
    if(rules.forceQuote) msgs.push('⚠️ '+(rules.forceQuoteReason||'Quotazione consigliata'));
  }

  // Avvisa su cosa manca ancora
  if(!$id('tranRegion')?.value)
    msgs.push('👉 Seleziona la Regione per calcolare');
  else if(svcToSet==='GROUPAGE'&&!$id('tranProvince')?.value)
    msgs.push('👉 Seleziona la Provincia per calcolare');
  else
    msgs.push('👉 Premi Calcola Trasporto');
  $setText('tranLinkInfo',msgs.join(' — '));
  showToast('✅ '+msgs[0],2800);
}

// Wrapper: applica da singolo articolo per idx
function applyTranFromArticolo_byIdx(idx){
  const a=articoliAggiunti[idx];
  if(!a)return;
  const tranArt=findTranArticle(a.codice,a.descrizione);
  applyTranArticleData(tranArt||{pack:{palletType:(listino.find(i=>i.codice===a.codice)?.palletType||'')}},
    [a]);
  // Aggiunge il codice nell'info
  $setText('tranLinkInfo','Articolo: '+a.codice+' — '+$id('tranLinkInfo').textContent);
}

function applyTranFromArticolo(){
  const idx=parseInt($val('tranLinkArticle'));
  if(isNaN(idx)||!articoliAggiunti[idx]){showToast('⚠️ Seleziona un articolo');return;}
  applyTranFromArticolo_byIdx(idx);
}

// ── AGGIUNGI COSTO TRASPORTO AL PREVENTIVO ──
function addTranToPreventivo(){
  if(!lastTranResult||!Number.isFinite(lastTranResult.costCliente)){showToast('⚠️ Calcola prima il trasporto');return;}
  const {svc,region,province,costCliente}=lastTranResult;
  const dest=svc==='PALLET'?region:province;
  const codice='TRASP-'+svc;
  const descrizione='Trasporto '+svc+' → '+dest;
  articoliAggiunti.push({
    codice,descrizione,prezzoLordo:costCliente,
    sconto:0,sconto2:0,margine:0,scontoCliente:0,
    costoTrasporto:0,costoInstallazione:0,quantita:1,venduto:0,
  });
  renderTabellaArticoli();aggiornaTotali();updateEquivDiscount();salvaPreventivo();refreshTranLinkSelect();
  // Switcha al tab preventivo
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const tabPrev=document.querySelector('.tab[data-tab="preventivo"]');
  if(tabPrev)tabPrev.classList.add('active');
  $id('tab-preventivo')?.classList.add('active');
  showToast('✅ Trasporto aggiunto al preventivo: '+fmtEur(costCliente));
}

// ── REPORT TRASPORTO PER CONDIVISIONE ──
function buildTranReport(){
  if(!lastTranResult)return '';
  const{svc,region,province,costCliente,costBase,out}=lastTranResult;
  const lines=['COSTO TRASPORTO — '+today(),'─'.repeat(36)];
  lines.push('Servizio: '+svc);
  if(svc==='PALLET')lines.push('Regione: '+region);else lines.push('Provincia: '+province);
  lines.push('');lines.push('COSTO PREVENTIVATO: '+moneyEUR(costCliente));
  const extra=$val('tranNoteExtra');if(extra)lines.push('Note: '+extra);
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme(); loadSettings(); initTabs();

  $id('btnTheme')?.addEventListener('click',()=>setTheme(document.documentElement.getAttribute('data-theme')!=='dark'));

  // ── Listino ──
  $id('csvFileInput')?.addEventListener('change',handleCSVUpload);
  $id('searchListino')?.addEventListener('input',aggiornaListinoSelect);
  $id('btnLoadSavedCSV')?.addEventListener('click',async()=>{
    const p=await idbGet('listino').catch(()=>null);
    if(!p?.data?.length){showToast('⚠️ Nessun listino salvato');return;}
    listino=p.data;aggiornaListinoSelect();updateListinoStats();showToast('✅ Listino: '+listino.length+' art.');
  });
  $id('btnClearSavedCSV')?.addEventListener('click',async()=>{
    if(!safeConfirm('Cancellare il listino salvato?'))return;
    await idbDel('listino').catch(()=>{});listino=[];aggiornaListinoSelect();updateListinoStats();await updateSavedCsvInfo();showToast('🗑️ Listino cancellato');
  });

  // ── Disponibilità ──
  $id('xlsxFileInput')?.addEventListener('change',handleXLSXUpload);
  $id('btnLoadSavedXLSX')?.addEventListener('click',async()=>{
    const p=await idbGet('situazione').catch(()=>null);
    if(!p?.data?.length){showToast('⚠️ Nessuna situazione salvata');return;}
    situazione=p.data;renderDispTable();aggiornaListinoSelect();showToast('✅ Situazione: '+situazione.length+' righe');
  });
  $id('btnClearSavedXLSX')?.addEventListener('click',async()=>{
    if(!safeConfirm('Cancellare la situazione?'))return;
    await idbDel('situazione').catch(()=>{});situazione=[];
    const w=$id('dispTableWrap'),f=$id('dispFilters');if(w)w.style.display='none';if(f)f.style.display='none';
    await updateSavedXlsxInfo();showToast('🗑️ Situazione cancellata');
  });
  $id('searchDisp')?.addEventListener('input',e=>{_dispSearch=e.target.value;renderDispTable();});
  $id('filterDisp')?.addEventListener('change',e=>{_dispFilter=e.target.value;renderDispTable();});
  $id('btnExportDisp')?.addEventListener('click',exportDispCSV);

  // ── Preventivo ──
  $id('btnAddFromListino')?.addEventListener('click',aggiungiDaListino);
  $id('btnAddManual')?.addEventListener('click',aggiungiManuale);
  $id('preventivoTitolo')?.addEventListener('input',salvaPreventivo);

  const doExport=(opts,wa)=>()=>{
    if(!articoliAggiunti.length){showToast('⚠️ Nessun articolo');return;}
    const r=generaReport(opts);mostraPreview(r);
    if(wa)window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(r),'_blank');
    else{downloadBlob(r,'preventivo'+(opts?.noMargine?'_nomarg':'')+'_'+new Date().toISOString().slice(0,10)+'.txt');showToast('📄 TXT scaricato');}
  };
  $id('btnWA')?.addEventListener('click',doExport({},true));
  $id('btnTXT')?.addEventListener('click',doExport({},false));
  $id('btnWANoMarg')?.addEventListener('click',doExport({noMargine:true},true));
  $id('btnTXTNoMarg')?.addEventListener('click',doExport({noMargine:true},false));
  $id('btnCopyClip')?.addEventListener('click',async()=>{
    if(!articoliAggiunti.length){showToast('⚠️ Nessun articolo');return;}
    const r=generaReport();mostraPreview(r);
    try{await navigator.clipboard.writeText(r);showToast('📋 Copiato!');}
    catch(_){showToast('⚠️ Copia non supportata');}
  });
  $id('btnClearAll')?.addEventListener('click',()=>{
    if(!articoliAggiunti.length)return;
    if(!safeConfirm('Svuotare la lista?'))return;
    articoliAggiunti=[];renderTabellaArticoli();aggiornaTotali();updateEquivDiscount();salvaPreventivo();refreshTranLinkSelect();
    const prev=$id('reportPreview');if(prev)prev.style.display='none';
    showToast('🗑️ Lista svuotata');
  });
  bindSmartControls();

  // ── Trasporto ──
  updateTranServiceUI(); // inizializza visibilità campi subito (non aspetta loadTranData)
  $id('tranService')?.addEventListener('change',updateTranServiceUI);
  $id('tranRegion')?.addEventListener('change',e=>{
    updateTranProvinces(e.target.value);
    // Reset highlight
    const el=e.target; el.style.borderColor=''; el.style.boxShadow='';
  });
  $id('tranProvince')?.addEventListener('change',e=>{
    const el=e.target; el.style.borderColor=''; el.style.boxShadow='';
  });
  $id('btnTranCalc')?.addEventListener('click',onTranCalc);
  $id('btnTranAddToPreventivo')?.addEventListener('click',addTranToPreventivo);
  $id('btnTranApplyArticle')?.addEventListener('click',applyTranFromArticolo);
  // Auto-fill immediato alla selezione dell'articolo (senza dover premere 'Applica')
  $id('tranLinkArticle')?.addEventListener('change', function(){
    const idx=parseInt(this.value);
    if(!isNaN(idx)&&articoliAggiunti[idx]) applyTranFromArticolo_byIdx(idx);
  });

  // Modalità singolo/multi
  document.querySelectorAll('input[name="tranMode"]').forEach(radio=>{
    radio.addEventListener('change',()=>{
      const isMulti=$id('tranModeMulti')?.checked;
      const single=$id('tranSingleSection');
      const multi=$id('tranMultiSection');
      if(single) single.style.display=isMulti?'none':'';
      if(multi)  multi.style.display=isMulti?'':'none';
      if(isMulti) refreshTranMultiList();
    });
  });
  $id('btnTranApplyMulti')?.addEventListener('click',cercaCombinazione);
  $id('btnTranApplyCombo')?.addEventListener('click',()=>{
    const pt=$val('tranComboPalletType');
    if(!pt){showToast('⚠️ Seleziona una taglia bancale');return;}
    // Applica manualmente la taglia scelta
    $setVal('tranService','PALLET');
    updateTranServiceUI();
    $setVal('tranPalletType',pt);
    $setText('tranLinkInfo','Taglia impostata manualmente: '+pt+' — imposta Regione e calcola.');
    showToast('✅ Bancale impostato: '+pt);
  });
  $id('btnTranWA')?.addEventListener('click',()=>{
    const r=buildTranReport();if(!r)return;
    window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(r),'_blank');
  });
  $id('btnTranCopy')?.addEventListener('click',async()=>{
    const r=buildTranReport();if(!r)return;
    try{await navigator.clipboard.writeText(r);showToast('📋 Copiato!');}
    catch(_){showToast('⚠️ Copia non supportata');}
  });

  // Init renders
  renderTabellaArticoli();
  aggiornaTotali();
  applyColumnVisibility();
  updateEquivDiscount();

  // Load persisted data
  await initListinoMemory();
  await initXLSXMemory();
  await ripristinaPreventivo();

  // Carica tariffe trasporto
  await loadTranData();
});
