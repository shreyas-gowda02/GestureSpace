// Downloads the MediaPipe Hand Landmarker model (float16) into public/models/.
// The model file is COMMITTED so builds/deploys are reproducible offline;
// run this script only to refresh it: `npm run fetch-model`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(root, 'public/models/hand_landmarker.task');

const res = await fetch(MODEL_URL);
if (!res.ok) {
  console.error(`[fetch-model] HTTP ${res.status} ${res.statusText} for ${MODEL_URL}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, buf);
console.log(`[fetch-model] saved ${(buf.length / 1e6).toFixed(2)} MB -> ${dest}`);
