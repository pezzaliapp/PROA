import { describe, test, expect, beforeEach } from 'vitest';
import {
  normalizeListino,
  parseSituazioneRows,
  findDispRow,
  getDispNum,
  arriviTot,
  arriviLabel,
  dispBadgeHTML
} from '../js/modules/csv-parser.js';
import { state, setSituazione } from '../js/modules/state.js';

describe('normalizeListino', () => {
  test('riga tipica con header standard', () => {
    const result = normalizeListino([
      {
        Codice: '00100208',
        Descrizione: 'PUMA CE 1ph 230V',
        PrezzoLordo: '17000',
        CostoTrasporto: '390',
        CostoInstallazione: '320'
      }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      codice: '00100208',
      descrizione: 'PUMA CE 1ph 230V',
      prezzoLordo: 17000,
      costoTrasporto: 390,
      costoInstallazione: 320,
      palletType: null
    });
  });

  test('header case-insensitive (minuscole)', () => {
    const result = normalizeListino([
      {
        codice: 'X1',
        descrizione: 'Test',
        prezzoLordo: '100',
        costoTrasporto: '10',
        costoInstallazione: '5'
      }
    ]);
    expect(result[0].codice).toBe('X1');
    expect(result[0].prezzoLordo).toBe(100);
  });

  test('PalletType presente viene normalizzato in uppercase', () => {
    const result = normalizeListino([
      {
        Codice: 'A',
        Descrizione: 'a',
        PrezzoLordo: '1',
        CostoTrasporto: '0',
        CostoInstallazione: '0',
        PalletType: 'full'
      }
    ]);
    expect(result[0].palletType).toBe('FULL');
  });

  test('PalletType con nomi alternativi (TipoBancale, Bancale)', () => {
    const result = normalizeListino([
      { Codice: 'A', Descrizione: 'a', PrezzoLordo: '1', TipoBancale: 'half' },
      { Codice: 'B', Descrizione: 'b', PrezzoLordo: '2', Bancale: 'mini' }
    ]);
    expect(result[0].palletType).toBe('HALF');
    expect(result[1].palletType).toBe('MINI');
  });

  test('righe senza codice vengono scartate', () => {
    const result = normalizeListino([
      { Codice: 'A', Descrizione: 'valido', PrezzoLordo: '1' },
      { Codice: '', Descrizione: 'invalido', PrezzoLordo: '2' },
      { Codice: '   ', Descrizione: 'solo-spazi', PrezzoLordo: '3' }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].codice).toBe('A');
  });

  test('prezzo in formato italiano viene parsato', () => {
    const result = normalizeListino([
      { Codice: 'X', Descrizione: 't', PrezzoLordo: '1.234,56' }
    ]);
    expect(result[0].prezzoLordo).toBe(1234.56);
  });

  test('campi numerici assenti → 0', () => {
    const result = normalizeListino([{ Codice: 'X', Descrizione: 't' }]);
    expect(result[0].prezzoLordo).toBe(0);
    expect(result[0].costoTrasporto).toBe(0);
    expect(result[0].costoInstallazione).toBe(0);
  });
});

describe('parseSituazioneRows', () => {
  test('rileva riga header e parte dalla prima riga dati (codice >= 5 cifre)', () => {
    const raw = [
      ['Situazione settimanale al 23/04/2026'],
      ['COD. ART.', 'DESCRIZIONE', 'DISP.', 'S15', 'S18'],
      ['00100208', 'PUMA CE', 10, 2, 0, 0, 0, '', '', ''],
      ['00100210', 'CM 1200BB', 0, 5, 3, 1, 0, 'in arrivo', '', '']
    ];
    const rows = parseSituazioneRows(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0].codice).toBe('00100208');
    expect(rows[0].disponibilita).toBe(10);
    expect(rows[0].arriviS15).toBe(2);
    expect(rows[1].codice).toBe('00100210');
    expect(rows[1].note).toBe('in arrivo');
  });

  test('scarta righe con codice vuoto o header residuo', () => {
    const raw = [
      ['00100208', 'PUMA', 10],
      ['', '', ''],
      [null, 'vuota', 0],
      ['COD. ART.', 'x', 0],
      ['00100210', 'altra', 5]
    ];
    const rows = parseSituazioneRows(raw);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.codice)).toEqual(['00100208', '00100210']);
  });

  test('campi mancanti → 0 per numerici, stringa vuota per testuali', () => {
    const rows = parseSituazioneRows([['12345']]);
    expect(rows[0].disponibilita).toBe(0);
    expect(rows[0].descrizione).toBe('');
    expect(rows[0].note).toBe('');
  });
});

describe('findDispRow / getDispNum', () => {
  beforeEach(() => {
    setSituazione([
      {
        codice: '00100208',
        descrizione: 'PUMA',
        disponibilita: 10,
        arriviS15: 0,
        arriviS18: 0,
        arriviMaggio: 0,
        arriviGiugno: 0,
        note: '',
        prenotazioni: '',
        infoExtra: ''
      },
      {
        codice: '99001234-01 AZURE',
        descrizione: 'comp',
        disponibilita: 5,
        arriviS15: 0,
        arriviS18: 0,
        arriviMaggio: 0,
        arriviGiugno: 0,
        note: '',
        prenotazioni: '',
        infoExtra: ''
      }
    ]);
  });

  test('match esatto sul codice', () => {
    expect(findDispRow('00100208')?.disponibilita).toBe(10);
    expect(getDispNum('00100208')).toBe(10);
  });

  test('match per split su - o spazi', () => {
    expect(findDispRow('99001234')?.disponibilita).toBe(5);
    expect(findDispRow('AZURE')?.disponibilita).toBe(5);
  });

  test('nessun match → null', () => {
    setSituazione([]);
    expect(findDispRow('INESISTENTE')).toBeNull();
    expect(getDispNum('INESISTENTE')).toBeNull();
  });

  test('situazione vuota → null', () => {
    setSituazione([]);
    expect(findDispRow('qualsiasi')).toBeNull();
  });
});

describe('arriviTot / arriviLabel', () => {
  test('somma arrivi', () => {
    expect(arriviTot({ arriviS15: 1, arriviS18: 2, arriviMaggio: 3, arriviGiugno: 4 })).toBe(10);
    expect(arriviTot({ arriviS15: 0, arriviS18: 0, arriviMaggio: 0, arriviGiugno: 0 })).toBe(0);
  });

  test('label con arrivi non zero', () => {
    const label = arriviLabel({ arriviS15: 5, arriviS18: 0, arriviMaggio: 3, arriviGiugno: 0 });
    expect(label).toBe('S15:5 Mag:3');
  });

  test('label vuota se tutti arrivi a zero', () => {
    expect(arriviLabel({ arriviS15: 0, arriviS18: 0, arriviMaggio: 0, arriviGiugno: 0 })).toBe('');
  });
});

describe('dispBadgeHTML', () => {
  test('> 5 → badge ok', () => {
    expect(dispBadgeHTML(10, false)).toContain('disp-ok');
    expect(dispBadgeHTML(10, false)).toContain('>10<');
  });

  test('tra 1 e 5 → badge low', () => {
    expect(dispBadgeHTML(3, false)).toContain('disp-low');
    expect(dispBadgeHTML(1, false)).toContain('disp-low');
  });

  test('0 con arrivi → badge arriving', () => {
    expect(dispBadgeHTML(0, true)).toContain('disp-arriving');
    expect(dispBadgeHTML(0, true)).toContain('0+');
  });

  test('0 senza arrivi → badge zero', () => {
    expect(dispBadgeHTML(0, false)).toContain('disp-zero');
  });
});

describe('state isolation', () => {
  test('state è mutabile e condiviso tra i moduli', () => {
    setSituazione([{ codice: 'TEST', disponibilita: 42 }]);
    expect(state.situazione).toHaveLength(1);
    expect(state.situazione[0].codice).toBe('TEST');
  });
});
