// ─── EXPORT HELPERS ───
// downloadBlob è condiviso tra export preventivo (TXT) ed export disponibilità (CSV).

import { showToast } from './utils.js';

export function downloadBlob(content, filename, type) {
  type = type || 'text/plain;charset=utf-8';
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIOS) {
    const w = window.open(url, '_blank');
    if (!w) showToast('⚠️ Popup bloccato', 4000);
    else showToast('📄 Aperto: Condividi → Salva in File', 5000);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
