import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Copertura misurata solo sui moduli di business logic
      include: ['js/modules/**/*.js'],
      // Esclude il bootstrap e i wrapper di persistenza
      exclude: ['js/main.js', 'js/modules/storage.js'],
      // Threshold di qualità: le decisioni (branch) della logica di business
      // devono restare coperte sopra il 70% (cfr. CLAUDE.md §9, Fase 3).
      // La statement coverage per-file resta bassa perché le init UI e i
      // render DOM sono esclusi dai test unitari — questo è intenzionale.
      thresholds: {
        branches: 70
      }
    }
  }
});
