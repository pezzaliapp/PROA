import { describe, test, expect, beforeEach } from 'vitest';
import {
  normalizeProvince,
  resolveGroupageProvinceKey,
  matchGroupageBracket,
  applyKmAndDisagiata,
  computePallet,
  computeGroupage
} from '../js/modules/trasporto.js';
import { TRAN } from '../js/modules/state.js';

// ─── Fixture minima per i test del motore ───
const FIXTURE_PALLET_RATES = {
  meta: {
    regions: ['LOMBARDIA', 'SARDEGNA'],
    palletTypes: ['MINI', 'HALF', 'FULL'],
    maxPalletsPerShipment: 5,
    preavviso_fee: 2,
    insurance_pct: 0.03
  },
  rates: {
    LOMBARDIA: { MINI: 40, HALF: 60, FULL: 86 },
    SARDEGNA: { MINI: 120, HALF: 180, FULL: 250 }
  }
};

const FIXTURE_GROUPAGE_RATES = {
  meta: {
    selection_mode: 'max',
    insurance_pct: 0.03,
    preavviso_fee: null,
    liftgate_fee: null,
    km_threshold: 30,
    km_surcharge_per_km: 0,
    disagiata_surcharge: 0
  },
  provinces: {
    'TO BI VB VC': {
      region: 'PIEMONTE',
      linearMeters: [
        { min: 0, max: 3, price: 310 },
        { min: 3, max: 6, price: 450 }
      ],
      pallets: [
        { min: 0, max: 7, price: 310 },
        { min: 7, max: 14, price: 450 }
      ],
      quintali: [
        { min: 0, max: 10, price: 310 },
        { min: 10, max: 20, price: 450 }
      ]
    },
    TUTTE: {
      region: 'SARDEGNA',
      linearMeters: [{ min: 0, max: 6, price: 900 }],
      pallets: [{ min: 0, max: 14, price: 900 }],
      quintali: [{ min: 0, max: 20, price: 900 }]
    }
  }
};

const FIXTURE_GEO = {
  PIEMONTE: ['TO', 'BI', 'VB', 'VC', 'AL', 'AT', 'CN', 'NO'],
  SARDEGNA: ['CA', 'SS', 'NU', 'OR', 'SU']
};

function resetTRAN() {
  TRAN.palletRates = FIXTURE_PALLET_RATES;
  TRAN.groupageRates = FIXTURE_GROUPAGE_RATES;
  TRAN.geo = FIXTURE_GEO;
  TRAN.articles = [];
  TRAN.loaded = true;
}

beforeEach(() => {
  resetTRAN();
});

// ══════════════ normalizeProvince ══════════════

describe('normalizeProvince', () => {
  test('uppercase e trim', () => {
    expect(normalizeProvince(' to ')).toBe('TO');
    expect(normalizeProvince('mi')).toBe('MI');
  });

  test('SU (Sud Sardegna) viene rimappata a CI (Carbonia-Iglesias)', () => {
    expect(normalizeProvince('SU')).toBe('CI');
    expect(normalizeProvince('su')).toBe('CI');
  });

  test('input vuoto → stringa vuota', () => {
    expect(normalizeProvince('')).toBe('');
    expect(normalizeProvince(null)).toBe('');
    expect(normalizeProvince(undefined)).toBe('');
  });
});

// ══════════════ matchGroupageBracket ══════════════

describe('matchGroupageBracket', () => {
  const brackets = [
    { min: 0, max: 3, price: 100 },
    { min: 3, max: 6, price: 200 },
    { min: 6, max: 10, price: 300 }
  ];

  test('valore nel range restituisce lo scaglione corrispondente', () => {
    expect(matchGroupageBracket(2, brackets).bracket.price).toBe(100);
    expect(matchGroupageBracket(5, brackets).bracket.price).toBe(200);
    expect(matchGroupageBracket(8, brackets).bracket.price).toBe(300);
  });

  test('overflow oltre l\'ultima fascia → ultimo scaglione + flag overflow', () => {
    const r = matchGroupageBracket(100, brackets);
    expect(r.bracket.price).toBe(300);
    expect(r.overflow).toBe(true);
  });

  test('brackets vuoto o non array → overflow false, bracket null', () => {
    expect(matchGroupageBracket(5, []).bracket).toBeNull();
    expect(matchGroupageBracket(5, null).bracket).toBeNull();
    expect(matchGroupageBracket(5, undefined).bracket).toBeNull();
  });

  test('bracket con max null significa "senza limite superiore"', () => {
    const open = [{ min: 0, max: null, price: 500 }];
    const r = matchGroupageBracket(1000000, open);
    expect(r.bracket.price).toBe(500);
    expect(r.overflow).toBe(false);
  });
});

// ══════════════ resolveGroupageProvinceKey ══════════════

describe('resolveGroupageProvinceKey', () => {
  test('match esatto con chiave singola (non in fixture, ma token nel gruppo)', () => {
    const r = resolveGroupageProvinceKey('TO');
    expect(r?.key).toBe('TO BI VB VC');
    expect(r?.matchedBy).toBe('group');
  });

  test('SU → normalizzata a CI, fallback per regione (Sardegna → TUTTE)', () => {
    const r = resolveGroupageProvinceKey('SU');
    expect(r?.key).toBe('TUTTE');
    expect(r?.matchedBy).toBe('region_fallback');
  });

  test('CA (Sardegna) → fallback regionale a TUTTE', () => {
    const r = resolveGroupageProvinceKey('CA');
    expect(r?.key).toBe('TUTTE');
  });

  test('provincia inesistente → null', () => {
    expect(resolveGroupageProvinceKey('XX')).toBeNull();
  });

  test('input vuoto → null', () => {
    expect(resolveGroupageProvinceKey('')).toBeNull();
    expect(resolveGroupageProvinceKey(null)).toBeNull();
  });
});

// ══════════════ applyKmAndDisagiata ══════════════

describe('applyKmAndDisagiata', () => {
  test('senza km extra e senza disagiata → base invariata', () => {
    const rules = [];
    const alerts = [];
    const out = applyKmAndDisagiata({
      base: 100,
      shipments: 1,
      opts: { kmOver: 0, disagiata: false },
      rules,
      alerts,
      mode: 'GROUPAGE'
    });
    expect(out).toBe(100);
    expect(rules).toEqual([]);
    expect(alerts).toEqual([]);
  });

  test('km extra → alert sempre; supplemento solo se configurato > 0', () => {
    const rules = [];
    const alerts = [];
    applyKmAndDisagiata({
      base: 100,
      shipments: 1,
      opts: { kmOver: 15 },
      rules,
      alerts,
      mode: 'GROUPAGE'
    });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toContain('15');
    // km_surcharge_per_km è 0 nella fixture → nessuna rule "km+"
    expect(rules).not.toContain('km+15');
  });

  test('disagiata senza fee → alert + rule info (no costo extra)', () => {
    const rules = [];
    const alerts = [];
    const out = applyKmAndDisagiata({
      base: 100,
      shipments: 1,
      opts: { disagiata: true },
      rules,
      alerts,
      mode: 'GROUPAGE'
    });
    expect(out).toBe(100);
    expect(alerts[0]).toContain('disagiata');
    expect(rules).toContain('disagiata(info)');
  });

  test('PALLET applica km surcharge × shipments', () => {
    TRAN.groupageRates.meta.km_surcharge_per_km = 1.5;
    const rules = [];
    const alerts = [];
    const out = applyKmAndDisagiata({
      base: 100,
      shipments: 3,
      opts: { kmOver: 10 },
      rules,
      alerts,
      mode: 'PALLET'
    });
    // 100 + 10km * 1.5€ * 3 spedizioni = 145
    expect(out).toBe(145);
    expect(rules).toContain('km+10');
  });
});

// ══════════════ computePallet ══════════════

describe('computePallet', () => {
  test('calcolo base: 1 pallet LOMBARDIA FULL → 86€', () => {
    const r = computePallet({
      region: 'LOMBARDIA',
      palletType: 'FULL',
      qty: 1,
      opts: {}
    });
    expect(r.cost).toBe(86);
    expect(r.rules).toEqual([]);
  });

  test('qty × rate', () => {
    const r = computePallet({
      region: 'LOMBARDIA',
      palletType: 'MINI',
      qty: 3,
      opts: {}
    });
    expect(r.cost).toBe(120); // 40 × 3
  });

  test('split automatico oltre 5 bancali', () => {
    const r = computePallet({
      region: 'LOMBARDIA',
      palletType: 'MINI',
      qty: 11,
      opts: {}
    });
    // 11 pallet / 5 per spedizione = 3 spedizioni
    expect(r.rules).toContain('split:3');
    expect(r.alerts.some((a) => a.includes('3 spedizioni'))).toBe(true);
  });

  test('preavviso telefonico: +2€ per spedizione', () => {
    const r = computePallet({
      region: 'LOMBARDIA',
      palletType: 'FULL',
      qty: 1,
      opts: { preavviso: true }
    });
    expect(r.cost).toBe(88); // 86 + 2
    expect(r.rules).toContain('preavviso');
  });

  test('assicurazione: +3% sul totale', () => {
    const r = computePallet({
      region: 'LOMBARDIA',
      palletType: 'FULL',
      qty: 1,
      opts: { assicurazione: true }
    });
    expect(r.cost).toBeCloseTo(88.58, 2); // 86 × 1.03 = 88.58
    expect(r.rules).toContain('assicurazione');
  });

  test('manca la regione → cost null, alert esplicito', () => {
    const r = computePallet({
      region: '',
      palletType: 'FULL',
      qty: 1,
      opts: {}
    });
    expect(r.cost).toBeNull();
    expect(r.rules).toContain('Manca regione');
  });

  test('manca il tipo bancale → cost null', () => {
    const r = computePallet({
      region: 'LOMBARDIA',
      palletType: '',
      qty: 1,
      opts: {}
    });
    expect(r.cost).toBeNull();
    expect(r.rules).toContain('Manca tipo bancale');
  });

  test('tariffa non configurata per regione/tipo → cost null', () => {
    const r = computePallet({
      region: 'LAZIO', // non in fixture
      palletType: 'FULL',
      qty: 1,
      opts: {}
    });
    expect(r.cost).toBeNull();
    expect(r.rules).toContain('Tariffa non trovata');
  });
});

// ══════════════ computeGroupage ══════════════

describe('computeGroupage', () => {
  test('calcolo base con solo LM', () => {
    const r = computeGroupage({
      province: 'TO',
      lm: 2,
      quintali: 0,
      palletCount: 0,
      opts: {}
    });
    expect(r.cost).toBe(310);
  });

  test('selection_mode=max tra LM / quintali / pallets prende il più alto', () => {
    // LM=2 → 310, quintali=12 → 450, pallets=1 → 310
    const r = computeGroupage({
      province: 'TO',
      lm: 2,
      quintali: 12,
      palletCount: 1,
      opts: {}
    });
    expect(r.cost).toBe(450);
    expect(r.rules.some((rule) => rule.startsWith('pick:max:'))).toBe(true);
  });

  test('selection_mode=min prende la tariffa più bassa', () => {
    TRAN.groupageRates.meta.selection_mode = 'min';
    const r = computeGroupage({
      province: 'TO',
      lm: 2,
      quintali: 12,
      palletCount: 1,
      opts: {}
    });
    expect(r.cost).toBe(310);
    expect(r.rules.some((rule) => rule.startsWith('pick:min:'))).toBe(true);
  });

  test('overflow oltre ultima fascia → alert + rule overflow', () => {
    const r = computeGroupage({
      province: 'TO',
      lm: 100, // oltre max 6
      quintali: 0,
      palletCount: 0,
      opts: {}
    });
    expect(r.rules).toContain('overflow');
    expect(r.alerts.some((a) => a.includes('oltre fascia'))).toBe(true);
  });

  test('nessun parametro valido → cost null', () => {
    const r = computeGroupage({
      province: 'TO',
      lm: 0,
      quintali: 0,
      palletCount: 0,
      opts: {}
    });
    expect(r.cost).toBeNull();
    expect(r.rules).toContain('Nessun parametro valido');
  });

  test('provincia mancante → cost null', () => {
    const r = computeGroupage({
      province: '',
      lm: 2,
      quintali: 0,
      palletCount: 0,
      opts: {}
    });
    expect(r.cost).toBeNull();
    expect(r.rules).toContain('Manca provincia');
  });

  test('provincia non mappata → cost null', () => {
    const r = computeGroupage({
      province: 'XX',
      lm: 2,
      quintali: 0,
      palletCount: 0,
      opts: {}
    });
    expect(r.cost).toBeNull();
    expect(r.rules).toContain('Provincia non trovata');
  });

  test('sponda attiva con liftgate_fee configurato', () => {
    TRAN.groupageRates.meta.liftgate_fee = 25;
    const r = computeGroupage({
      province: 'TO',
      lm: 2,
      quintali: 0,
      palletCount: 0,
      opts: { sponda: true }
    });
    expect(r.cost).toBe(335); // 310 + 25
    expect(r.rules).toContain('sponda');
  });

  test('assicurazione GROUPAGE: +3%', () => {
    const r = computeGroupage({
      province: 'TO',
      lm: 2,
      quintali: 0,
      palletCount: 0,
      opts: { assicurazione: true }
    });
    expect(r.cost).toBeCloseTo(319.3, 2); // 310 × 1.03
    expect(r.rules).toContain('assicurazione');
  });

  test('fallback regionale: CA (Sardegna) → chiave TUTTE', () => {
    const r = computeGroupage({
      province: 'CA',
      lm: 2,
      quintali: 0,
      palletCount: 0,
      opts: {}
    });
    expect(r.cost).toBe(900); // tariffa TUTTE
  });
});
