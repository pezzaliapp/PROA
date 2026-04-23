#!/usr/bin/env node
// ─── SYNC CACHE IN sw.js CON package.json version ───
// Esegue sostituzioni in sw.js:
//   - `const CACHE = 'proa-vX.Y.Z';`    → versione da package.json
//   - commento header `Service Worker vX.Y.Z`
//   - main.js: `navigator.serviceWorker.register('sw.js?v=X.Y.Z')`
//
// Uso:
//   node scripts/sync-sw-version.js           # scrive i file se cambiano
//   node scripts/sync-sw-version.js --check   # exit 1 se sw.js/main.js non sono in pari (utile in CI)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const check = process.argv.includes('--check');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`[sync-sw] package.json version non SemVer: "${version}"`);
  process.exit(1);
}

const swPath = join(root, 'sw.js');
const mainPath = join(root, 'js', 'main.js');

const swOriginal = readFileSync(swPath, 'utf8');
const mainOriginal = readFileSync(mainPath, 'utf8');

const swUpdated = swOriginal
  .replace(/^(\/\/ PROA — Service Worker v)[\d.]+/m, `$1${version}`)
  .replace(/^(const CACHE = 'proa-v)[\d.]+(';)/m, `$1${version}$2`);

const mainUpdated = mainOriginal.replace(
  /navigator\.serviceWorker\.register\('sw\.js\?v=[\d.]+'\)/,
  `navigator.serviceWorker.register('sw.js?v=${version}')`
);

const swChanged = swUpdated !== swOriginal;
const mainChanged = mainUpdated !== mainOriginal;

if (check) {
  if (swChanged || mainChanged) {
    console.error(
      `[sync-sw] versione non sincronizzata con package.json (${version}). Esegui: npm run sync:sw`
    );
    if (swChanged) console.error('  - sw.js da aggiornare');
    if (mainChanged) console.error('  - js/main.js da aggiornare');
    process.exit(1);
  }
  console.log(`[sync-sw] OK — versione ${version} già in sw.js e main.js`);
  process.exit(0);
}

if (swChanged) {
  writeFileSync(swPath, swUpdated);
  console.log(`[sync-sw] sw.js → proa-v${version}`);
}
if (mainChanged) {
  writeFileSync(mainPath, mainUpdated);
  console.log(`[sync-sw] main.js → sw.js?v=${version}`);
}
if (!swChanged && !mainChanged) {
  console.log(`[sync-sw] nessun cambiamento — già a versione ${version}`);
}
