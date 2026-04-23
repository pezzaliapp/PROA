// ─── PROA — ENTRY POINT ───
// Registra Service Worker, carica preferenze e inizializza tutti i tab.

import { loadSettings } from './modules/state.js';
import { initTheme, initTabsUI } from './modules/ui-tabs.js';
import { initListinoUI, initDisponibilitaUI } from './modules/csv-parser.js';
import {
  initPreventivoUI,
  renderTabellaArticoli,
  aggiornaTotali,
  updateEquivDiscount,
  applyColumnVisibility,
  ripristinaPreventivo
} from './modules/preventivo.js';
import { initTrasportoUI } from './modules/trasporto.js';

// ─── SERVICE WORKER ───
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js?v=1.2.0');
      await reg.update().catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (sessionStorage.getItem('sw_r')) return;
        sessionStorage.setItem('sw_r', '1');
        location.reload();
      });
    } catch (e) {
      console.warn('SW:', e);
    }
  });
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  loadSettings();
  initTabsUI();

  // UI dei 4 tab
  await initListinoUI();
  await initDisponibilitaUI();
  initPreventivoUI();

  // Render iniziale preventivo (con stato vuoto o ripristinato più in basso)
  renderTabellaArticoli();
  aggiornaTotali();
  applyColumnVisibility();
  updateEquivDiscount();

  // Ripristino autosave preventivo
  await ripristinaPreventivo();

  // Inizializza tab trasporto e carica tariffe
  await initTrasportoUI();
});
