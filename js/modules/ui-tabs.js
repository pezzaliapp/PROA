// ─── TABS + TEMA ───

import { $id } from './utils.js';
import { refreshTranLinkSelect } from './trasporto.js';

const THEME_KEY = 'theme_tran';

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  setTheme(saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme:dark)').matches));
}

function setTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn = $id('btnTheme');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
}

export function initTabsUI() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = $id('tab-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
      // Quando si apre il tab trasporto, aggiorna la lista articoli collegabili
      if (btn.dataset.tab === 'trasporto') refreshTranLinkSelect();
    });
  });

  $id('btnTheme')?.addEventListener('click', () =>
    setTheme(document.documentElement.getAttribute('data-theme') !== 'dark')
  );
}
