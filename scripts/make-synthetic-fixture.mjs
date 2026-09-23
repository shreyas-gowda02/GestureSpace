// Generates tests/fixtures/landmarks/synthetic-two-hands.json: two open hands gently waving, in
// the exact format FixtureRecorder produces. Used by integration tests and to demo the pipeline
// without a camera (Debug panel → "Play fixture…"). Real recordings should replace/augment it.
//
//   node scripts/make-synthetic-fixture.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'tests/fixtures/landmarks/synthetic-two-hands.json');

const VIDEO_W = 1280;
const VIDEO_H = 720;
const ASPECT = VIDEO_W / VIDEO_H;
const FPS = 30;
const SECONDS = 4;
const PALM = 0.16; // wrist→middle MCP, in video heights

// PHYSICAL right hand, palm facing the camera, fingers up, as seen in the RAW (un-mirrored)
// camera image: thumb points toward +x. Units: palm lengths, y down.
const RIGHT_TEMPLATE = [
  [0, 0], // wrist
  [0.25, -0.15],
  [0.45, -0.35],
  [0.6, -0.55],
  [0.72, -0.72], // thumb
  [0.28, -0.95],
  [0.32, -1.3],
  [0.34, -1.52],
  [0.36, -1.72], // index
  [0.0, -1.0],
  [0.0, -1.4],
  [0.0, -1.65],
  [0.0, -1.88], // middle
  [-0.22, -0.93],
  [-0.26, -1.28],
  [-0.28, -1.5],
  [-0.3, -1.68], // ring
  [-0.42, -0.82],
  [-0.5, -1.08],
  [-0.55, -1.25],
  [-0.58, -1.4], // pinky
];

const r4 = (v) => Math.round(v * 1e4) / 1e4;

function hand(template, wristX, wristY, angle, flip) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return template.map(([tx, ty]) => {
    const x = (flip ? -tx : tx) * PALM;
    const y = ty * PALM;
    const rx = x * c - y * s;
    const ry = x * s + y * c;
    return {
      x: r4(wristX + rx / ASPECT), // x is normalized by width
      y: r4(wristY + ry),
      z: r4(-0.03 * Math.hypot(tx, ty)),
    };
  });
}

const frames = [];
for (let i = 0; i < FPS * SECONDS; i++) {
  const t = i / FPS;
  const wave = Math.sin((2 * Math.PI * t) / 2);
  frames.push({
    timestamp: Math.round((i * 1000) / FPS),
    videoWidth: VIDEO_W,
    videoHeight: VIDEO_H,
    hands: [
      // Physical RIGHT hand: left side of the raw (un-mirrored) image. MediaPipe Tasks labels it
      // "Right" on a real webcam (verified 2026-09-24; see TUNING.tracker.HANDEDNESS_LABEL_SWAP).
      {
        handedness: 'Right',
        score: 0.97,
        landmarks: hand(RIGHT_TEMPLATE, 0.3 + 0.03 * wave, 0.72, 0.25 * wave, false),
      },
      // Physical LEFT hand: right side of the raw image; labelled "Left".
      {
        handedness: 'Left',
        score: 0.95,
        landmarks: hand(RIGHT_TEMPLATE, 0.7 - 0.03 * wave, 0.72, -0.25 * wave, true),
      },
    ],
  });
}

const fixture = {
  version: 1,
  name: 'synthetic-two-hands',
  recordedAt: '2026-09-23T00:00:00.000Z',
  videoWidth: VIDEO_W,
  videoHeight: VIDEO_H,
  frames,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fixture));
console.log(`[synthetic-fixture] ${frames.length} frames -> ${out}`);
