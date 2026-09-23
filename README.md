# GestureSpace

> Turn an ordinary webcam into a spatial-computing studio. Create, manipulate, draw and generate
> live visual effects using only your hands — entirely in the browser, entirely on your device.

<!-- TODO(phase 13): hero GIF / screenshots -->

## Experiences

| #   | Experience          | What you do                                                         |
| --- | ------------------- | ------------------------------------------------------------------- |
| 1   | Voxel Builder       | Pinch to build turquoise block structures in the air; extrude depth |
| 2   | Spatial Panel       | Hold a floating image between your hands; move, stretch, rotate     |
| 3   | Air Draw            | Draw glowing strokes with your index finger                         |
| 4   | Hand Strings        | Glowing particles and elastic threads on your hand joints           |
| 5   | Filter Lab          | A "magic lens" strip that filters the camera behind it              |
| 6   | Portal / Dimensions | Hold a glowing window into another world                            |
| 7   | 3D Object Lab       | Spawn, select, move, rotate, scale, group 3D primitives             |

## Status

🚧 Under construction — built phase by phase (see `GestureSpace_Build_Prompt.md` §26).
Current: **Phase 0 — Foundation** (app shell, tooling, architecture skeleton).

## Quick start

Requires Node.js 22+ (see `.nvmrc`).

```bash
npm install        # also copies MediaPipe WASM into public/mediapipe/wasm (postinstall)
npm run dev        # http://localhost:5173
```

The hand-landmark model is committed at `public/models/hand_landmarker.task`. To refresh it from
the official source
(`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`):

```bash
npm run fetch-model
```

## Scripts

| Script                | Purpose                            |
| --------------------- | ---------------------------------- |
| `dev`                 | Vite dev server                    |
| `build` / `preview`   | Production build / serve it        |
| `lint` / `format`     | ESLint / Prettier                  |
| `typecheck`           | `tsc -b --noEmit`                  |
| `test` / `test:watch` | Vitest unit + integration tests    |
| `e2e`                 | Playwright (Chromium, fake camera) |
| `fetch-model`         | Re-download the hand model         |

## Browser requirements

Chrome or Edge (primary), Firefox/Safari (secondary). Needs `getUserMedia`, WebGL2, WebAssembly,
and a secure context (HTTPS or `localhost`).

## Privacy

The camera starts only when you click **Enable camera**. Every frame is processed locally in your
browser — nothing is uploaded, recorded, or sent anywhere. The model and WASM runtime are
self-hosted. A visible **● Camera on** indicator and a **Stop cam** button are always present.

## Documentation

- [AGENTS.md](AGENTS.md) — architecture rules for contributors and coding agents
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/GESTURES.md](docs/GESTURES.md) ·
  [docs/MODES.md](docs/MODES.md) · [docs/PERFORMANCE.md](docs/PERFORMANCE.md) ·
  [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Deploy

Static build (`dist/`) on Vercel or Netlify. `vercel.json` sets CSP, `Permissions-Policy:
camera=(self)` and long-cache headers for `/models` and `/mediapipe`.
