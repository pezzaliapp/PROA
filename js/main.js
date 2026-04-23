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

// ─── SERVICE WORKER + BANNER UPDATE ───
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js?v=1.3.0');
      await reg.update().catch(() => {});

      // Se è già pronto un SW in waiting all'avvio → mostra subito il banner
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);

      // Quando viene scoperta una nuova versione
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // "installed" + controller già presente = update (non primo install)
            showUpdateBanner(reg);
          }
        });
      });

      // Reload al cambio di controller (il nuovo SW ha preso il controllo)
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

function showUpdateBanner(reg) {
  const banner = document.getElementById('updateBanner');
  if (!banner || banner.hidden === false) return;
  banner.hidden = false;

  const reload = document.getElementById('btnUpdateReload');
  const dismiss = document.getElementById('btnUpdateDismiss');

  reload?.addEventListener(
    'click',
    () => {
      // Il click chiede al SW waiting di attivarsi; il controllerchange ricarica
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      reload.disabled = true;
      reload.textContent = 'Aggiornamento…';
    },
    { once: true }
  );

  dismiss?.addEventListener(
    'click',
    () => {
      banner.hidden = true;
    },
    { once: true }
  );
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
