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
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn, tabs));
    // Navigazione tastiera ARIA: frecce sinistra/destra spostano il focus tra i tab
    btn.addEventListener('keydown', (e) => {
      const arr = [...tabs];
      const idx = arr.indexOf(btn);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? (idx + 1) % arr.length : (idx - 1 + arr.length) % arr.length;
        arr[next].focus();
        activateTab(arr[next], tabs);
      } else if (e.key === 'Home') {
        e.preventDefault();
        arr[0].focus();
        activateTab(arr[0], tabs);
      } else if (e.key === 'End') {
        e.preventDefault();
        arr[arr.length - 1].focus();
        activateTab(arr[arr.length - 1], tabs);
      }
    });
  });

  $id('btnTheme')?.addEventListener('click', () =>
    setTheme(document.documentElement.getAttribute('data-theme') !== 'dark')
  );
}

function activateTab(btn, tabs) {
  tabs.forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
    b.setAttribute('tabindex', '-1');
  });
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  btn.setAttribute('tabindex', '0');
  const panel = $id('tab-' + btn.dataset.tab);
  if (panel) panel.classList.add('active');
  // Quando si apre il tab trasporto, aggiorna la lista articoli collegabili
  if (btn.dataset.tab === 'trasporto') refreshTranLinkSelect();
}
