// Regenerates committed demo fixtures from the synthetic hand generator.
//   node scripts/make-fixtures.ts        (Node ≥ 22.18 / 24 runs TypeScript directly)
// Output: tests/fixtures/landmarks/synthetic-two-hands.json — play it from the Debug panel.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waveScenario } from '../tests/fixtures/syntheticHands.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'tests/fixtures/landmarks/synthetic-two-hands.json');

const fixture = waveScenario();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fixture));
console.log(`[fixtures] ${fixture.frames.length} frames -> ${out}`);
