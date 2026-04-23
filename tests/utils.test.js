import { describe, test, expect, beforeEach } from 'vitest';
import {
  parseDec,
  fmtDec,
  roundTwo,
  round2,
  clamp,
  parseIntSafe,
  sanitizeDecInput,
  fmtEur,
  moneyEUR,
  today,
  esc,
  safeConfirm,
  $id,
  $val,
  $setVal,
  $setText,
  showToast
} from '../js/modules/utils.js';

describe('parseDec', () => {
  test('formato italiano con virgola decimale', () => {
    expect(parseDec('1234,56')).toBe(1234.56);
    expect(parseDec('0,5')).toBe(0.5);
  });

  test('formato italiano con punto migliaia + virgola decimale', () => {
    expect(parseDec('1.234,56')).toBe(1234.56);
    expect(parseDec('1.000.000,99')).toBe(1000000.99);
  });

  test('formato inglese con virgola migliaia + punto decimale', () => {
    expect(parseDec('1,234.56')).toBe(1234.56);
  });

  test('numero intero senza separatori', () => {
    expect(parseDec('1234')).toBe(1234);
    expect(parseDec('0')).toBe(0);
  });

  test('input non numerico → 0', () => {
    expect(parseDec('')).toBe(0);
    expect(parseDec('abc')).toBe(0);
    expect(parseDec(null)).toBe(0);
    expect(parseDec(undefined)).toBe(0);
  });

  test('numero già in formato JS', () => {
    expect(parseDec(1234.56)).toBe(1234.56);
    expect(parseDec(0)).toBe(0);
  });

  test('spazi e whitespace vengono ignorati', () => {
    expect(parseDec('  1 234 , 56 ')).toBe(1234.56);
  });
});

describe('fmtDec', () => {
  test('formatta con virgola come separatore decimale', () => {
    expect(fmtDec(1234.56)).toBe('1234,56');
    expect(fmtDec(0.5)).toBe('0,5');
  });

  test('trim degli zeri finali per default', () => {
    expect(fmtDec(10.0)).toBe('10');
    expect(fmtDec(10.5)).toBe('10,5');
    expect(fmtDec(10.0, 2, true)).toBe('10');
  });

  test('senza trim mantiene gli zeri', () => {
    expect(fmtDec(10, 2, false)).toBe('10,00');
    expect(fmtDec(10.5, 2, false)).toBe('10,50');
  });

  test('input non numerico → stringa vuota', () => {
    expect(fmtDec(NaN)).toBe('');
    expect(fmtDec(Infinity)).toBe('');
  });
});

describe('roundTwo / round2', () => {
  test('arrotonda a due decimali', () => {
    expect(roundTwo(1.235)).toBe(1.24);
    expect(roundTwo(1.234)).toBe(1.23);
    expect(roundTwo(1)).toBe(1);
  });

  test('round2 con epsilon gestisce imprecisione float', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
  });
});

describe('clamp', () => {
  test('limita entro range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });
});

describe('parseIntSafe', () => {
  test('parsa interi', () => {
    expect(parseIntSafe('42')).toBe(42);
    expect(parseIntSafe(42)).toBe(42);
    expect(parseIntSafe('42.7')).toBe(42);
  });

  test('input invalido → 0', () => {
    expect(parseIntSafe('')).toBe(0);
    expect(parseIntSafe('abc')).toBe(0);
    expect(parseIntSafe(null)).toBe(0);
  });
});

describe('sanitizeDecInput', () => {
  test('rimuove caratteri non numerici', () => {
    expect(sanitizeDecInput('12a34')).toBe('1234');
    expect(sanitizeDecInput('€ 100,50')).toBe('100,50');
  });

  test('mantiene solo un separatore decimale', () => {
    expect(sanitizeDecInput('1,2,3')).toBe('1,23');
    expect(sanitizeDecInput('1.2.3')).toBe('1.23');
  });

  test('segno negativo solo in testa', () => {
    expect(sanitizeDecInput('-123')).toBe('-123');
    expect(sanitizeDecInput('1-2-3')).toBe('123');
  });

  test('input vuoto → stringa vuota', () => {
    expect(sanitizeDecInput('')).toBe('');
    expect(sanitizeDecInput(null)).toBe('');
  });
});

describe('fmtEur / moneyEUR', () => {
  test('fmtEur formatta con simbolo euro', () => {
    const s = fmtEur(1234.5);
    expect(s).toContain('€');
    expect(s).toContain('1234,50');
  });

  test('moneyEUR con valore valido', () => {
    expect(moneyEUR(100)).toContain('100');
  });

  test('moneyEUR con input non valido → —', () => {
    expect(moneyEUR(null)).toBe('—');
    expect(moneyEUR(NaN)).toBe('—');
    expect(moneyEUR(Infinity)).toBe('—');
  });
});

describe('today', () => {
  test('restituisce data in formato italiano gg/mm/aaaa', () => {
    const d = today();
    expect(d).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('esc', () => {
  test('escape caratteri HTML pericolosi', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
    expect(esc('"quotes"')).toBe('&quot;quotes&quot;');
    expect(esc("o'brien")).toBe('o&#39;brien');
    expect(esc('a & b')).toBe('a &amp; b');
  });

  test('input non stringa viene convertito', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(123)).toBe('123');
  });
});

describe('safeConfirm (senza jsdom prompt reale)', () => {
  test('ritorna true se window.confirm non disponibile', () => {
    // jsdom ha confirm ma lancia eccezione; safeConfirm gestisce il throw
    const orig = window.confirm;
    window.confirm = () => {
      throw new Error('not implemented');
    };
    expect(safeConfirm('test')).toBe(true);
    window.confirm = orig;
  });
});

describe('DOM helpers $id / $val / $setVal / $setText', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="testInput" value="initial" />
      <span id="testSpan">original</span>
    `;
  });

  test('$id trova elemento', () => {
    expect($id('testInput')).toBeTruthy();
    expect($id('inesistente')).toBeNull();
  });

  test('$val legge valore di input', () => {
    expect($val('testInput')).toBe('initial');
    expect($val('inesistente')).toBe('');
  });

  test('$setVal scrive valore su input esistente', () => {
    $setVal('testInput', 'nuovo');
    expect($id('testInput').value).toBe('nuovo');
  });

  test('$setVal su id inesistente è no-op (nessuna eccezione)', () => {
    expect(() => $setVal('inesistente', 'x')).not.toThrow();
  });

  test('$setText aggiorna textContent', () => {
    $setText('testSpan', 'nuovo testo');
    expect($id('testSpan').textContent).toBe('nuovo testo');
  });
});

describe('showToast', () => {
  test('aggiunge classe show al toast', () => {
    document.body.innerHTML = '<div id="toast"></div>';
    showToast('messaggio');
    expect($id('toast').classList.contains('show')).toBe(true);
    expect($id('toast').textContent).toBe('messaggio');
  });

  test('senza elemento toast non lancia errori', () => {
    document.body.innerHTML = '';
    expect(() => showToast('test')).not.toThrow();
  });
});
