// Copies the MediaPipe Tasks Vision WASM runtime into public/ so it is self-hosted
// (no runtime CDN dependency). Runs on `postinstall`; output is git-ignored.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dest = resolve(root, 'public/mediapipe/wasm');

if (!existsSync(src)) {
  console.warn('[copy-mediapipe-assets] @mediapipe/tasks-vision not installed yet; skipping.');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-mediapipe-assets] copied WASM runtime -> ${dest}`);
