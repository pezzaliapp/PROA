// ─── UTILS NUMERICI ───

export function parseDec(val) {
  let s = String(val ?? '')
    .trim()
    .replace(/\s+/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function fmtDec(n, d, trim) {
  d = d === undefined ? 2 : d;
  trim = trim === undefined ? true : trim;
  if (!Number.isFinite(n)) return '';
  let s = Number(n).toFixed(d);
  if (trim) s = s.replace(/\.?0+$/, '');
  return s.replace('.', ',');
}

export function roundTwo(n) {
  return Math.round(n * 100) / 100;
}

// Variante usata dal motore trasporto (portata da Trasporti-Use-Friendly)
export function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function fmtEur(n) {
  return '€ ' + fmtDec(roundTwo(n), 2, false);
}

export function moneyEUR(n) {
  return Number.isFinite(n) ? fmtEur(n) : '—';
}

export function parseIntSafe(v) {
  const n = parseInt(v);
  return Number.isFinite(n) ? n : 0;
}

export function sanitizeDecInput(s) {
  s = String(s ?? '').replace(/[^\d,.\-]/g, '');
  s = s.replace(/(?!^)-/g, '');
  const i = s.search(/[.,]/);
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/[.,]/g, '');
  return s;
}

export function today() {
  return new Date().toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// ─── DOM HELPERS ───
export const $id = (id) => document.getElementById(id);
export const $val = (id) => $id(id)?.value ?? '';
export const $setVal = (id, v) => {
  const e = $id(id);
  if (e) e.value = v;
};
export const $setText = (id, t) => {
  const e = $id(id);
  if (e) e.textContent = t;
};

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeConfirm(msg) {
  try {
    return window.confirm(msg);
  } catch (_) {
    return true;
  }
}

// ─── TOAST ───
export function showToast(msg, ms) {
  ms = ms || 2600;
  const t = $id('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}
