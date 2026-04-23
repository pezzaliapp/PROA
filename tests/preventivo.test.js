import { describe, test, expect, beforeEach } from 'vitest';
import { computeRow } from '../js/modules/preventivo.js';
import { smartSettings } from '../js/modules/state.js';

// Riporta smartSettings a una baseline nota prima di ogni test
function resetSmartSettings() {
  smartSettings.smartMode = false;
  smartSettings.showVAT = false;
  smartSettings.vatRate = 22;
  smartSettings.hideVenduto = true;
  smartSettings.hideDiff = true;
  smartSettings.hideDiscounts = true;
  smartSettings.showClientDiscount = false;
}

beforeEach(() => {
  resetSmartSettings();
});

// ══════════════ Sconti cascata (Sc.1 + Sc.2) ══════════════

describe('computeRow — sconti a cascata', () => {
  test('senza sconti: totale netto = prezzo lordo', () => {
    const r = computeRow({ prezzoLordo: 1000, quantita: 1 });
    expect(r.totaleNettoUnit).toBe(1000);
    expect(r.conMargineUnit).toBe(1000);
    expect(r.granTotRiga).toBe(1000);
  });

  test('Sc.1 = 10%: 1000 → 900', () => {
    const r = computeRow({ prezzoLordo: 1000, sconto: 10 });
    expect(r.totaleNettoUnit).toBe(900);
  });

  test('Sc.1 + Sc.2 applicati in cascata (non sommati)', () => {
    // 1000 × 0.9 × 0.9 = 810 (non 1000 × 0.8 = 800)
    const r = computeRow({ prezzoLordo: 1000, sconto: 10, sconto2: 10 });
    expect(r.totaleNettoUnit).toBe(810);
  });

  test('Sc.1 = 50% + Sc.2 = 20%', () => {
    // 1000 × 0.5 × 0.8 = 400
    const r = computeRow({ prezzoLordo: 1000, sconto: 50, sconto2: 20 });
    expect(r.totaleNettoUnit).toBe(400);
  });

  test('Sc.1 = 100% → 0', () => {
    const r = computeRow({ prezzoLordo: 1000, sconto: 100 });
    expect(r.totaleNettoUnit).toBe(0);
  });

  test('sconti oltre 100% sono clampati', () => {
    const r = computeRow({ prezzoLordo: 1000, sconto: 150 });
    expect(r.totaleNettoUnit).toBe(0); // clamp a 100%
  });

  test('sconti negativi sono clampati a 0', () => {
    const r = computeRow({ prezzoLordo: 1000, sconto: -50 });
    expect(r.totaleNettoUnit).toBe(1000); // clamp a 0%
  });
});

// ══════════════ Margine ══════════════

describe('computeRow — margine', () => {
  test('margine 20% sul prezzo di vendita: costo 1000 → vendita 1250', () => {
    // Formula: prezzoVendita = costo / (1 - marg/100)
    // 1000 / (1 - 0.2) = 1250, margine = (1250-1000)/1250 = 20%
    const r = computeRow({ prezzoLordo: 1000, margine: 20 });
    expect(r.conMargineUnit).toBe(1250);
  });

  test('margine 0 → conMargineUnit = totaleNettoUnit', () => {
    const r = computeRow({ prezzoLordo: 1000, sconto: 10, margine: 0 });
    expect(r.conMargineUnit).toBe(r.totaleNettoUnit);
  });

  test('margine clampato a 99.99 per evitare divisione per zero', () => {
    const r = computeRow({ prezzoLordo: 100, margine: 99.99 });
    // 100 / (1 - 0.9999) = 100 / 0.0001 = ~1000000
    expect(r.conMargineUnit).toBeGreaterThan(100000);
    expect(Number.isFinite(r.conMargineUnit)).toBe(true);
  });

  test('sconto + margine: 1000 → 900 → 1125', () => {
    // 1000 - 10% = 900; 900 / (1 - 0.2) = 1125
    const r = computeRow({ prezzoLordo: 1000, sconto: 10, margine: 20 });
    expect(r.totaleNettoUnit).toBe(900);
    expect(r.conMargineUnit).toBe(1125);
  });
});

// ══════════════ Modalità Sconto Cliente ══════════════

describe('computeRow — modalità showClientDiscount', () => {
  test('Sc.cliente 15% sostituisce Sc.1+Sc.2+margine', () => {
    smartSettings.showClientDiscount = true;
    const r = computeRow({
      prezzoLordo: 1000,
      scontoCliente: 15,
      sconto: 50, // ignorato
      sconto2: 30, // ignorato
      margine: 40 // ignorato
    });
    expect(r.totaleNettoUnit).toBe(850); // 1000 × (1 - 0.15)
    expect(r.conMargineUnit).toBe(850); // nessun margine applicato
    expect(r.sconto1).toBe(15); // scontoCliente è memorizzato come sc1 nel result
    expect(r.sconto2).toBe(0);
    expect(r.margine).toBe(0);
  });

  test('__skipClient forza modalità tradizionale anche se showClientDiscount=true', () => {
    smartSettings.showClientDiscount = true;
    const r = computeRow({
      prezzoLordo: 1000,
      sconto: 10,
      sconto2: 0,
      margine: 0,
      __skipClient: true
    });
    expect(r.totaleNettoUnit).toBe(900); // Sc.1 applicato, scontoCliente ignorato
  });
});

// ══════════════ Quantità e trasporto/installazione ══════════════

describe('computeRow — qta, trasporto, installazione', () => {
  test('qta moltiplica il granTotRiga', () => {
    const r = computeRow({ prezzoLordo: 100, quantita: 5 });
    expect(r.qta).toBe(5);
    expect(r.granTotRiga).toBe(500);
  });

  test('qta minima è sempre 1 (0 o negativi → 1)', () => {
    expect(computeRow({ prezzoLordo: 100, quantita: 0 }).qta).toBe(1);
    expect(computeRow({ prezzoLordo: 100, quantita: -3 }).qta).toBe(1);
    expect(computeRow({ prezzoLordo: 100 }).qta).toBe(1);
  });

  test('trasporto e installazione si sommano al netto unitario', () => {
    const r = computeRow({
      prezzoLordo: 1000,
      costoTrasporto: 50,
      costoInstallazione: 30,
      quantita: 2
    });
    // (1000 + 50 + 30) × 2 = 2160
    expect(r.granTotRiga).toBe(2160);
  });

  test('trasporto/installazione negativi vengono clampati a 0', () => {
    const r = computeRow({
      prezzoLordo: 100,
      costoTrasporto: -50,
      costoInstallazione: -20
    });
    expect(r.trasporto).toBe(0);
    expect(r.installazione).toBe(0);
  });

  test('prezzi in formato italiano (virgola decimale) vengono parsati', () => {
    const r = computeRow({ prezzoLordo: '1.500,50', quantita: 2 });
    expect(r.granTotRiga).toBe(3001);
  });
});

// ══════════════ Venduto e differenza ══════════════

describe('computeRow — venduto/differenza', () => {
  test('differenza = (conMargineUnit - venduto) × qta', () => {
    const r = computeRow({
      prezzoLordo: 1000,
      venduto: 800,
      quantita: 3
    });
    // conMargineUnit = 1000, diff unit = 200, diff totale = 600
    expect(r.venduto).toBe(800);
    expect(r.differenzaUnit).toBe(200);
    expect(r.differenza).toBe(600);
  });

  test('differenza negativa quando vendita > prezzo calcolato', () => {
    const r = computeRow({
      prezzoLordo: 100,
      sconto: 50,
      venduto: 80
    });
    // netto = 50, venduto = 80, diff = -30
    expect(r.differenzaUnit).toBe(-30);
  });

  test('venduto assente → 0', () => {
    const r = computeRow({ prezzoLordo: 100 });
    expect(r.venduto).toBe(0);
    expect(r.differenza).toBe(100);
  });
});
