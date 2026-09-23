# GestureSpace — Master Build Prompt

> You are a senior TypeScript / real-time graphics / computer-vision engineer. You are building **GestureSpace**, a browser-based webcam hand-tracking "spatial studio", from an empty folder. This prompt is the **source of truth**. Read all of it before writing any code. Build strictly **phase by phase** and **STOP after every phase** for my review (see §3). If anything here conflicts with a library's current API, follow the real API, keep the intent, and tell me what you changed.

---

## 0. Table of contents

1. Product vision (non-technical)
2. Hard rules for you, the coding agent
3. Phase-gate protocol (stop after each phase)
4. Tech stack
5. Architecture overview
6. Folder structure (authoritative)
7. Core data contracts (TypeScript)
8. Coordinate systems & camera/viewport mapping
9. Hand tracking (MediaPipe) details
10. Smoothing & confidence
11. Gesture engine
12. Two-hand transform controller
13. Experience 1 — Voxel Builder (incl. full depth system)
14. Experience 2 — Spatial Panel
15. Experience 3 — Air Draw
16. Experience 4 — Hand Strings
17. Shared Texture Surface engine
18. Experience 5 — Filter Lab (lens mode)
19. Experience 6 — Portal / Dimensions
20. Experience 7 — 3D Object Lab
21. UI / UX / visual design
22. Undo/redo, persistence
23. Performance engineering
24. Privacy & security
25. Testing strategy
26. Build phases 0–14 with acceptance criteria
27. Deployment & CI
28. Documentation deliverables
29. V1 Definition of Done
30. Out of scope

---

## 1. Product vision (non-technical)

**One-line definition:** GestureSpace is a single modular web app that turns an ordinary webcam into a spatial-computing studio. The user picks one of **seven experiences** and creates, manipulates, draws, and generates live visual effects using only their hands.

**The seven user-facing experiences (all selectable from one app, not separate demos):**

| # | Experience | What the user does |
|---|---|---|
| 1 | **Voxel Builder** | Builds turquoise-style block structures in the air with pinch; extrudes in depth; transforms the structure with two hands. |
| 2 | **Spatial Panel** | Holds a floating image/strip between two hands; moves, stretches, rotates it. |
| 3 | **Air Draw** | Draws glowing strokes in the air with the index finger; palette, width, erase, undo. |
| 4 | **Hand Strings** | Glowing particles on hand joints connected by elastic threads within and across hands. Pure visual effect. |
| 5 | **Filter Lab** | Holds a "magic lens" strip between two hands; the camera view *behind* the strip is shown filtered (thermal, sketch, glitch…); switches filters with a thumb-pinky tap. |
| 6 | **Portal / Dimensions** | Holds a glowing window between two hands that shows another world (procedural shader, alternate scene, image). |
| 7 | **3D Object Lab** | Spawns cubes/spheres/etc., selects, moves, rotates, scales, duplicates, deletes, groups them — "Iron-Man style". |

**Target users:** CV/graphics/HCI students and developers, creators wanting a portfolio/social demo, educators, hackathon teams exploring spatial UI without AR/VR hardware.

**Core value proposition:** "Use only your webcam and hands to create, manipulate, draw, and generate live visual effects in a shared spatial canvas." The differentiator is the **reusable interaction platform** behind all seven experiences, not any single effect.

**Success criteria:**
- A new user understands pinch/grab within 30–60 seconds (guided onboarding).
- Hand motion follows with low perceived latency; objects do not jitter when hands are still.
- All seven experiences reachable from one shell; switching never restarts camera or tracker.
- Clear/reset/undo always available — the user can never get stuck.
- Camera processing is 100% local; no frames uploaded or recorded by default.
- Looks deliberate and polished — portfolio quality, technically explainable.

**Cost constraint:** everything must be free and open source; no paid APIs, no backend, deployable on a free static host.

---

## 2. Hard rules for you, the coding agent

1. **Modes never touch MediaPipe, the camera, or the render loop directly.** They consume a normalized `InteractionFrame` only. This is the most important rule.
2. **Exactly one** camera stream, one `HandLandmarker` instance, one render loop, one `WebGLRenderer` — ever. Guard against React 18 StrictMode double-mounting (effects run twice in dev): core singletons must be idempotent (create-once, ref-counted or module-level guarded) and fully disposable.
3. **No high-frequency data in React state.** Landmarks, gesture frames, cursors live in core systems/refs. React only renders UI state (active mode, settings, status text throttled to ≤10 Hz).
4. **TypeScript strict mode.** No `any` (use `unknown` + narrowing). Named landmark constants — never magic indices in mode code.
5. **Do not allocate per frame** in hot paths (vectors, arrays, materials, geometries). Reuse scratch objects and typed buffers.
6. **Dispose everything** Three.js creates (geometry, material, texture, render target) on mode `dispose()`.
7. **Do not add dependencies** beyond §4 without stating why in your phase report.
8. **Verify library APIs** against the installed package types/docs (use current stable versions at build time; do not rely on memory for exact signatures). Note any deviation from this prompt.
9. **Tests alongside code**: pure math/gesture logic gets Vitest unit tests in the same phase it's written.
10. Keep all tunable numbers in `src/config/tuning.ts` (thresholds, smoothing params, timings) — never inline.
11. Create `AGENTS.md` (for Codex) and `CLAUDE.md` (for Claude Code) at repo root in Phase 0, both containing a condensed version of §2, §5, §6 and §7 so future sessions keep the architecture. (CLAUDE.md may simply say "See AGENTS.md" plus the rules.)
12. Commit to git at the end of every phase with a message `phase-N: <summary>`.
13. If something is ambiguous and a wrong guess is expensive, ask me in the phase report instead of guessing.

---

## 3. Phase-gate protocol (STOP after each phase)

Build phases in order (§26). At the end of **each** phase:

1. Run `npm run lint`, `npm run typecheck`, `npm run test` (and `npm run build`). All must pass.
2. Commit.
3. **STOP** and give me a report in exactly this format, then wait for me to say "continue":

```
## Phase N report — <name>
**Built:** <bullets>
**Files added/changed:** <list>
**How to try it (manual steps):** <numbered steps, what I should see>
**Checks:** lint ✅ typecheck ✅ tests ✅ (N passing) build ✅
**Deviations from spec:** <none | list with reason>
**Known issues / risks:** <list>
**Questions for you:** <none | list>
**Next phase:** <name + one-line plan>
```

Milestones (demo checkpoints): **M0** after Phase 3, **M1** after Phase 5, **M2** after Phase 7 + Phase 11, **M3** after Phase 10, **M4** after Phase 13.

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | |
| UI | React 18+ | App shell, dock, toolbar, panels, onboarding |
| Build | Vite (`react-ts` template) | |
| Camera | `navigator.mediaDevices.getUserMedia` | 1280×720 ideal, `facingMode: "user"` |
| Hand tracking | `@mediapipe/tasks-vision` — `HandLandmarker` | `runningMode: "VIDEO"`, `numHands: 2`, GPU delegate with CPU fallback |
| 3D | `three` (+ `@types/three`) | Direct Three.js core (NOT React Three Fiber) — keeps the render loop outside React |
| State (UI only) | `zustand` | Active mode, settings, status, undo availability flags |
| Styling | Plain CSS with CSS variables (CSS Modules OK) | No UI framework needed |
| Unit tests | `vitest` | + `jsdom` where needed |
| E2E | `@playwright/test` | Chromium fake camera flags |
| Quality | `eslint` (flat config, typescript-eslint, react-hooks), `prettier` | |
| Persistence | `localStorage` (settings) + IndexedDB via a tiny wrapper (`idb-keyval` allowed) | |
| Deploy | Vercel or Netlify (free tier), HTTPS | |
| VCS | Git + GitHub | |

**Not used in V1:** backend, database, LLM, cloud vision, physics engine, Python runtime.

**Model & WASM assets are self-hosted** (no runtime CDN dependency):
- Copy `node_modules/@mediapipe/tasks-vision/wasm/*` → `public/mediapipe/wasm/` via a `postinstall` script (`scripts/copy-mediapipe-assets.mjs`).
- Download `hand_landmarker.task` (float16) once into `public/models/hand_landmarker.task` (script `scripts/fetch-model.mjs`; document the official URL in README; **commit the file** — see §6.1).

npm scripts: `dev`, `build`, `preview`, `lint`, `format`, `typecheck` (`tsc -b --noEmit`), `test`, `test:watch`, `e2e`.

---

## 5. Architecture overview

```
LAYER 1  INPUT          CameraManager ─► HTMLVideoElement + shared THREE.VideoTexture
                        InputSource (LiveTracker | FixturePlayback)
LAYER 2  PERCEPTION     HandTracker ─► raw landmarks/handedness/score
                        HandNormalizer ─► handedness fix, mirrored view coords
                        LandmarkSmoother (One Euro per landmark) + confidence gate
                        ─► HandFrame
LAYER 3  INTERPRETATION GestureEngine (state machines) ─► GestureFrame
                        DepthEstimator ─► per-hand smoothed depth signal
                        CoordinateMapper / ViewportMapper ─► screen/NDC/scene
LAYER 4  INTERACTION    CursorSystem (raycast cursors) ─► SceneCursor per hand
                        CaptureManager (who owns which gesture/object)
                        ModeController (routes InteractionFrame to active mode)
LAYER 5  EXPERIENCES    Voxel | Panel | Draw | Strings | FilterLab | Portal | ObjectLab
LAYER 6  PRESENTATION   SceneManager (one WebGLRenderer, camera-background quad, scene)
                        OverlayCanvas2D (skeleton, draw strokes, HUD hints)
                        React UI (dock, toolbar, status, panels)
```

**Runtime loop (one `requestAnimationFrame` owned by `renderLoop.ts`):**
1. If a new video frame is available (`video.currentTime` changed / `requestVideoFrameCallback`) and inference isn't throttled, call `detectForVideo(video, performance.now())`. Never queue stale frames.
2. Normalize → smooth → confidence gate → `HandFrame`.
3. Update gesture state machines → `GestureFrame`; update depth estimator.
4. Compute cursors via raycast → `InteractionFrame`.
5. `activeMode.update(frame, dt)`.
6. Render: camera background → 3D scene → 2D overlay.
7. Update `PerformanceMonitor`; push throttled status to zustand.

Between inference results the renderer keeps drawing with the latest smoothed state (render rate ≠ inference rate).

**Layering decision (deviation from a plain `<video>` background — intentional):** render the camera **inside Three.js** as a full-screen background quad sampling the shared `VideoTexture` through the same `ViewportMapper` cover-crop + mirror math used by the Filter Lab lens and by overlays. This guarantees pixel-perfect alignment between background, lens, and hand overlays. The `<video>` element is hidden (still in DOM, `playsInline`, `muted`).

Layers bottom→top: WebGL canvas (background quad + 3D) → 2D overlay canvas (skeleton, strokes, hints) → React UI.

---

## 6. Folder structure (authoritative)

```
gesturespace/
├── .gitignore                       # see §6.1
├── .editorconfig
├── .nvmrc                           # Node LTS version
├── .github/
│   └── workflows/
│       └── ci.yml                   # §27
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── package.json
├── package-lock.json                # committed (pinned deps)
├── vite.config.ts
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── eslint.config.js
├── .prettierrc
├── playwright.config.ts
├── vercel.json                      # headers (CSP, cache)
├── scripts/
│   ├── copy-mediapipe-assets.mjs
│   └── fetch-model.mjs
├── docs/
│   ├── ARCHITECTURE.md
│   ├── GESTURES.md                  # thresholds + state diagrams
│   ├── MODES.md                     # spec per experience
│   ├── PERFORMANCE.md               # baseline + device/browser matrix
│   └── TROUBLESHOOTING.md           # known limitations
├── public/
│   ├── models/hand_landmarker.task
│   ├── mediapipe/wasm/              # copied at postinstall
│   ├── textures/                    # sample panel images, portal images
│   └── icons/
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx
│   │   ├── AppShell.tsx
│   │   └── bootstrap.ts             # creates core singletons once
│   ├── config/
│   │   ├── tuning.ts                # ALL thresholds/timings/smoothing params
│   │   ├── keybindings.ts
│   │   └── featureFlags.ts
│   ├── core/
│   │   ├── camera/
│   │   │   ├── CameraManager.ts
│   │   │   └── cameraPermissions.ts
│   │   ├── input/
│   │   │   ├── InputSource.ts       # interface
│   │   │   ├── LiveTrackerSource.ts
│   │   │   ├── FixturePlaybackSource.ts
│   │   │   └── FixtureRecorder.ts   # dev tool: record landmark JSON
│   │   ├── timing/
│   │   │   ├── renderLoop.ts
│   │   │   ├── FrameClock.ts
│   │   │   └── PerformanceMonitor.ts
│   │   └── types/
│   │       ├── common.ts            # Vec2, Vec3, Handedness, ModeId…
│   │       └── frames.ts            # HandFrame, GestureFrame, InteractionFrame
│   ├── vision/
│   │   ├── HandTracker.ts
│   │   ├── handLandmarks.ts         # named indices + skeleton connections
│   │   ├── HandNormalizer.ts        # handedness correction + mirrored coords
│   │   ├── LandmarkSmoother.ts
│   │   ├── OneEuroFilter.ts
│   │   ├── confidence.ts
│   │   └── handMetrics.ts           # palm scale, bbox, finger extension
│   ├── gestures/
│   │   ├── GestureEngine.ts
│   │   ├── GestureStateMachine.ts   # generic IDLE→CANDIDATE→ACTIVE→RELEASED
│   │   ├── pinch.ts
│   │   ├── point.ts
│   │   ├── grab.ts
│   │   ├── openPalm.ts
│   │   ├── thumbPinky.ts            # filter next/prev
│   │   ├── swipe.ts
│   │   ├── twoHand.ts               # scale/rotation/center
│   │   └── precedence.ts
│   ├── spatial/
│   │   ├── ViewportMapper.ts        # cover-crop + mirror; screen↔video UV
│   │   ├── CoordinateMapper.ts      # view-normalized ↔ screen ↔ NDC ↔ scene
│   │   ├── RaycastCursor.ts
│   │   ├── InteractionPlane.ts
│   │   ├── DepthEstimator.ts
│   │   ├── CaptureManager.ts
│   │   └── calibration.ts
│   ├── scene/
│   │   ├── SceneManager.ts
│   │   ├── CameraBackground.ts      # full-screen video quad
│   │   ├── OverlayCanvas2D.ts
│   │   ├── HandSkeletonOverlay.ts
│   │   ├── lighting.ts
│   │   ├── materials.ts
│   │   ├── selection.ts             # outline/highlight helpers
│   │   └── dispose.ts
│   ├── modes/
│   │   ├── ModeController.ts
│   │   ├── registry.ts              # ModeId → factory + metadata (name, icon, help)
│   │   ├── shared/
│   │   │   ├── SpatialMode.ts       # interface
│   │   │   ├── commandHistory.ts
│   │   │   ├── TwoHandTransformController.ts
│   │   │   ├── TransformableTextureSurface.ts   # used by Panel, FilterLab, Portal
│   │   │   ├── TextureSource.ts
│   │   │   └── shaders/common.glsl.ts          # coverUv, mirror, hsv helpers
│   │   ├── voxel/
│   │   │   ├── VoxelMode.ts
│   │   │   ├── VoxelGrid.ts         # Map<VoxelKey, Voxel>
│   │   │   ├── VoxelRenderer.ts     # InstancedMesh, growable capacity
│   │   │   ├── voxelCommands.ts
│   │   │   ├── DepthLayerController.ts
│   │   │   ├── FaceExtrusion.ts
│   │   │   ├── BuildPlaneGrid.ts    # faint active-layer grid visual
│   │   │   ├── GhostVoxel.ts
│   │   │   └── voxelLine.ts         # 3D DDA gap-filling
│   │   ├── panel/
│   │   │   └── PanelMode.ts
│   │   ├── draw/
│   │   │   ├── DrawMode.ts
│   │   │   ├── Stroke.ts
│   │   │   ├── strokeSmoothing.ts   # Catmull-Rom
│   │   │   └── StrokeRenderer.ts
│   │   ├── strings/
│   │   │   ├── StringsMode.ts
│   │   │   ├── ParticleHandRenderer.ts
│   │   │   └── springs.ts
│   │   ├── fx/
│   │   │   ├── FilterLabMode.ts
│   │   │   ├── FilterPipeline.ts
│   │   │   ├── presets.ts
│   │   │   └── filters/
│   │   │       ├── none.ts
│   │   │       ├── thermal.ts
│   │   │       ├── sketch.ts
│   │   │       ├── pixelate.ts
│   │   │       ├── glitch.ts
│   │   │       ├── redChannel.ts
│   │   │       ├── edge.ts
│   │   │       ├── blur.ts
│   │   │       ├── cartoon.ts
│   │   │       ├── rainbow.ts
│   │   │       ├── invert.ts
│   │   │       ├── rgbSplit.ts
│   │   │       └── popArt.ts
│   │   ├── portal/
│   │   │   ├── PortalMode.ts
│   │   │   ├── PortalMaterial.ts
│   │   │   ├── PortalContentSource.ts
│   │   │   └── portalScenes/        # off-screen scene(s) for render target
│   │   └── objectLab/
│   │       ├── ObjectLabMode.ts
│   │       ├── primitives.ts
│   │       ├── ObjectTransformController.ts
│   │       └── objectCommands.ts
│   ├── ui/
│   │   ├── ModeDock.tsx
│   │   ├── Toolbar.tsx
│   │   ├── StatusBar.tsx
│   │   ├── GestureStatus.tsx
│   │   ├── DebugPanel.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── HelpOverlay.tsx          # per-mode gesture help
│   │   ├── Onboarding.tsx
│   │   ├── PermissionScreen.tsx
│   │   ├── ModeToolPanels/          # per-mode controls (palette, depth, presets…)
│   │   └── styles/
│   ├── state/
│   │   ├── appStore.ts
│   │   └── selectors.ts
│   ├── persistence/
│   │   ├── settingsStore.ts
│   │   ├── localSceneStore.ts
│   │   └── serializers.ts
│   ├── workers/
│   │   └── visionWorker.ts          # OPTIONAL, only if profiling justifies
│   └── utils/
│       ├── math.ts
│       ├── vectors.ts
│       ├── pool.ts
│       └── logger.ts
└── tests/
    ├── unit/
    ├── fixtures/landmarks/          # *.json recorded sequences
    ├── integration/
    └── e2e/
```

### 6.1 `.gitignore` (create in Phase 0)

```gitignore
# dependencies
node_modules/

# build output
dist/
dist-ssr/
*.local

# generated at postinstall (copied from node_modules) — do not commit
public/mediapipe/wasm/

# test & tooling output
coverage/
playwright-report/
test-results/
blob-report/
playwright/.cache/
*.tsbuildinfo
.vite/
.eslintcache

# env / secrets (V1 has none, but never commit them)
.env
.env.*
!.env.example

# deploy tool folders
.vercel/
.netlify/

# logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
*.log

# editor / OS
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/
.DS_Store
Thumbs.db
*.swp

# dev-recorded landmark dumps (keep curated fixtures in tests/fixtures/)
recordings/
```

Rules:
- **Commit** `public/models/hand_landmarker.task` (~7–8 MB) so builds and deploys are reproducible offline; `scripts/fetch-model.mjs` exists only to refresh it. Do NOT ignore `public/models/`.
- **Commit** `package-lock.json` and curated fixtures in `tests/fixtures/landmarks/`.
- **Do not commit** the copied WASM (regenerated by `postinstall`), build output, test reports, or any `.env` file.

---

## 7. Core data contracts (TypeScript)

Implement in `src/core/types/`. Extend if needed; do not shrink.

```ts
export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type HandSide = 'left' | 'right';            // the user's PHYSICAL hand
export type ModeId = 'voxel' | 'panel' | 'draw' | 'strings' | 'filter' | 'portal' | 'objectLab';

export interface TrackedHand {
  side: HandSide;
  score: number;                 // handedness/detection confidence 0..1
  rawLandmarks: readonly Vec3[]; // 21, tracker-native normalized, immutable
  landmarks: readonly Vec3[];    // 21, smoothed, VIEW-normalized (mirrored), z = tracker relative z
  worldLandmarks?: readonly Vec3[];
  palmScale: number;             // aspect-corrected, view-normalized units
  bbox: { min: Vec2; max: Vec2 };
  lostForMs: number;             // 0 if seen this frame; >0 during grace period
}

export interface HandFrame {
  timestamp: number;
  inferenceTimestamp: number;
  left?: TrackedHand;
  right?: TrackedHand;
}

export type GesturePhase = 'idle' | 'candidate' | 'active' | 'released';
export interface GestureState {
  phase: GesturePhase;
  startedAt: number;       // when entered active
  justStarted: boolean;    // true for exactly one frame
  justEnded: boolean;      // true for exactly one frame
  value: number;           // e.g. normalized pinch distance
}

export interface HandGestures {
  pinch: GestureState;
  grab: GestureState;
  point: GestureState;
  openPalm: GestureState;
  thumbPinky: GestureState;
  swipe?: { direction: 'left' | 'right' | 'up' | 'down'; at: number };
  depthSignal: number;     // smoothed DepthEstimator output
}

export interface TwoHandState {
  active: boolean;         // both hands pinching and captured together
  justStarted: boolean;
  justEnded: boolean;
  center: Vec2;            // view-normalized midpoint
  distance: number;
  angle: number;           // radians, hand-to-hand vector
  // relative to baseline captured at start:
  scale: number;           // distance / baselineDistance
  rotation: number;        // angle - baselineAngle (unwrapped)
  translation: Vec2;       // center - baselineCenter
}

export interface GestureFrame {
  left?: HandGestures;
  right?: HandGestures;
  twoHand: TwoHandState;
}

export interface SceneCursor {
  side: HandSide;
  screen: Vec2;            // CSS pixels
  ndc: Vec2;
  hit?: { point: Vec3; normal?: Vec3; objectId?: string; kind: 'plane' | 'object' | 'voxel' };
}

export interface InteractionFrame {
  timestamp: number;
  dt: number;
  hands: HandFrame;
  gestures: GestureFrame;
  cursors: { left?: SceneCursor; right?: SceneCursor };
  dominant: HandSide;      // from settings, default 'right'
  activeMode: ModeId;
}

export interface ModeContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  overlay: OverlayCanvas2D;
  videoTexture: THREE.VideoTexture;
  viewport: ViewportMapper;
  coords: CoordinateMapper;
  cursors: RaycastCursor;
  capture: CaptureManager;
  history: CommandHistory;
  settings: Readonly<Settings>;
  emitStatus(text: string): void;
}

export interface SpatialMode {
  id: ModeId;
  enter(ctx: ModeContext): void;
  update(frame: InteractionFrame): void;
  render?(): void;             // extra passes (e.g. portal render target)
  reset(): void;               // clear this mode's content
  exit(): void;                // release all captures; keep state if preserving
  dispose(): void;             // free GPU resources
  serialize?(): unknown;
  deserialize?(data: unknown): void;
}

export interface Command { label: string; do(): void; undo(): void; }
```

Voxel model:
```ts
type VoxelKey = `${number},${number},${number}`;
type Voxel = { x: number; y: number; z: number; color: string; material: 'solid' | 'glass' | 'emissive' };
// VoxelGrid wraps Map<VoxelKey, Voxel> — prevents duplicate occupancy
```

Scene file (versioned):
```json
{ "version": 1, "mode": "voxel",
  "voxels": [{"x":0,"y":0,"z":0,"color":"#21d4d8","material":"solid"}],
  "objects": [], "strokes": [], "panel": null, "portal": null,
  "settings": {"mirror": true, "smoothing": 0.65} }
```

---

## 8. Coordinate systems & camera/viewport mapping

Define and document these spaces; only `CoordinateMapper`/`ViewportMapper` convert between them:

| Space | Definition |
|---|---|
| **Tracker (raw)** | MediaPipe output on the un-mirrored video frame; x,y ∈ [0,1] of the video image; z relative to wrist. Stored immutable in `rawLandmarks`. |
| **View-normalized** | Mirrored for selfie view: `xv = 1 - x`, `yv = y`, measured in the *video image* frame. All gesture math uses this, aspect-corrected where distances matter (multiply x by videoAspect before distance). |
| **Screen (CSS px)** | Where it appears on the displayed canvas after **object-fit: cover** cropping of the video into the viewport. |
| **NDC** | `xNdc = sx / width * 2 - 1`, `yNdc = -(sy / height * 2 - 1)`. |
| **Scene** | Three.js world units, via raycast from the camera through NDC. |

`ViewportMapper` owns the cover-crop: given video size and canvas size, it computes scale and offset so the video fills the viewport; exposes `viewToScreen`, `screenToView`, and the shader uniforms (`uCoverScale`, `uCoverOffset`, `uMirror`) used by `CameraBackground` and every lens shader. Unit-test it for landscape, portrait, and equal aspect ratios.

**Handedness:** MediaPipe's handedness label assumes a mirrored (selfie) input image. We feed the un-mirrored video, so the label may be **swapped**. Centralize this in `HandNormalizer` with a single `HANDEDNESS_LABEL_SWAP` flag in `tuning.ts`; in Phase 2 verify empirically (raise your physical right hand; the debug overlay must say "Right") and set the flag. `TrackedHand.side` always means the user's physical hand.

**Hand identity stability:** when a capture is active, lock identity by proximity (nearest wrist to previous frame) rather than trusting per-frame labels, so crossing hands never swaps captured handles. Re-acquire labels only after release.

---

## 9. Hand tracking (MediaPipe) details

- `FilesetResolver.forVisionTasks('/mediapipe/wasm')` → `HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence, minHandPresenceConfidence, minTrackingConfidence })` — values from `tuning.ts` (start 0.5/0.5/0.5). If GPU creation throws, retry with `'CPU'` and show that in the debug panel.
- Call `detectForVideo(video, timestampMs)` with strictly increasing timestamps; only when a new video frame exists.
- Inference throttle: target 30 Hz by default (setting: 15/30/60), render at display rate.
- Load exactly once; show "Loading hand tracker…" state during load; surface load errors in UI with Retry.
- `handLandmarks.ts`: export named indices (`WRIST=0, THUMB_CMC=1, THUMB_MCP=2, THUMB_IP=3, THUMB_TIP=4, INDEX_MCP=5, INDEX_PIP=6, INDEX_DIP=7, INDEX_TIP=8, MIDDLE_MCP=9 … PINKY_TIP=20`) and `HAND_CONNECTIONS` pairs.
- `InputSource` abstraction lets the pipeline run from `FixturePlaybackSource` (recorded JSON) with no camera — used for tests, demos, and debugging. `FixtureRecorder` (dev-only, toggled in debug panel) records `HandFrame` sequences to downloadable JSON.

---

## 10. Smoothing & confidence

- `OneEuroFilter` per landmark coordinate (x, y, z). Parameters in `tuning.ts`: `minCutoff` (~1.0), `beta` (~0.007), `dCutoff` (1.0) — expose in Settings as a single "Smoothing" slider mapping to minCutoff.
- Two smoothing profiles: **visual** (stronger, for overlays/objects) and **trigger** (lighter, for gesture distances). Compute gesture metrics from the trigger profile.
- Confidence gate: drop hands with score < `MIN_HAND_SCORE`. Reject impossible jumps (wrist moves > `MAX_JUMP` view units in one inference step) for one frame.
- **Grace period:** if a hand disappears, keep its last state with `lostForMs` increasing for `HAND_LOSS_GRACE_MS` (~150 ms); after that, remove it and force-release any capture it owned (objects stay where they were; no snapping).

---

## 11. Gesture engine

Generic `GestureStateMachine`: `idle → candidate → active → released → idle`, with separate **start/end thresholds** (hysteresis), **minimum hold** before active (`CANDIDATE_MS`, ~60 ms), and **release debounce** (~80 ms). `justStarted`/`justEnded` true for exactly one frame. All distances normalized by `palmScale` (e.g. `distance(WRIST, MIDDLE_MCP)`, aspect-corrected).

| Gesture | Detection | Semantic use |
|---|---|---|
| Pinch | `dist(THUMB_TIP, INDEX_TIP)/palmScale` < start (~0.35), > end (~0.5) | select, place, draw |
| Point | index extended (tip farther from wrist than PIP by ratio), middle/ring/pinky curled | cursor / hover |
| Grab (fist) | mean fingertip-to-palm-center distance / palmScale < threshold | move held object / alt select |
| Open palm | all fingers extended | release, pause, show menu (hold) |
| Thumb-pinky | `dist(THUMB_TIP, PINKY_TIP)/palmScale` < threshold, with 400 ms cooldown | Filter Lab next/prev |
| Swipe | wrist velocity > threshold over short window | optional mode/tool switch (off by default) |
| Two-hand pinch | both pinches active | transform (§12) |
| Hold | gesture stable for `HOLD_MS` | confirmation |

**Precedence (`precedence.ts`):**
1. Open UI menu/overlay consumes gestures before the scene.
2. An active two-hand transform suppresses single-hand pinch actions (place/draw) for both hands — and when the second hand joins within `TWO_HAND_JOIN_MS` (~150 ms) of the first pinch, **cancel** the first hand's single-hand action (undo the voxel/stroke it just started) so starting a two-hand grab never leaves stray marks.
3. Release events always go to the object that captured the gesture (`CaptureManager`), even if the cursor moved away.
4. No capture survives a mode switch.

`GestureStatus` UI shows e.g. "Right: pinch · Left: open".

---

## 12. Two-hand transform controller

`TwoHandTransformController` is shared by Voxel (group transform), Panel, Filter Lab, Portal, Object Lab.

- On `twoHand.justStarted` (and the target is within its capture zone), snapshot **baseline**: target's position/rotation/scale + hand center/distance/angle.
- Each frame: `position = baseline.position + mapDelta(translation)`; `scale = baseline.scale * clamp(twoHand.scale, min, max)`; `rotationZ = baseline.rotationZ + twoHand.rotation * ROTATION_SENSITIVITY`. Optional tilt from relative hand height/depth (off by default).
- Angle unwrapping to avoid ±π jumps. Clamp per-frame deltas to prevent explosions.
- If either hand is lost: freeze for grace period, then release and keep last transform.
- Optional non-uniform mode (width follows hand distance, height fixed) — used by the strip experiences.
- Emits a single `TransformObjectCommand` (before/after) on release for undo.

---

## 13. Experience 1 — Voxel Builder (including the full depth system)

### 13.1 Goal
Build block structures in the air with pinch, in true 3D, with depth control that is both natural and precise. Default voxel color `#21d4d8` (turquoise), palette of 8 colors + materials solid/glass/emissive.

### 13.2 World setup
- Voxel world lives in a `voxelRoot: THREE.Group` (so two-hand transforms move the whole structure while grid logic stays in local integer coords).
- Perspective camera (fov ~50) looking down −Z at the origin; voxel size 1 unit; world bounds e.g. 32×32×32 (from tuning).
- **Axes:** X left/right, Y up/down, **Z depth (toward camera = +Z)**.
- Rendering: `InstancedMesh` with growable capacity (double on overflow), per-instance color; separate instanced meshes per material. Logical `VoxelGrid` is the source of truth; renderer syncs from it.
- Soft lighting (hemisphere + directional) with subtle edges (EdgesGeometry or a shader outline) so cubes read clearly over video.

### 13.3 Depth: the core design principle
A webcam gives X/Y directly; Z is indirect. **Never map `landmark.z` directly to `voxel.z`.** Combine four mechanisms:

1. **Active build plane (Z layers).** The user always builds on one selected integer layer `activeZ`. An invisible raycast plane sits at `z = activeZ * voxelSize` (in `voxelRoot` local space). A **faint 3D grid** (`BuildPlaneGrid`) shows the active layer, with a small depth indicator `Depth: -3 -2 -1 [0] +1 +2 +3` in the tool panel. Fingertip at (5,4) on layer 3 → voxel (5,4,3).
2. **Face extrusion (primary depth method).** When the index-fingertip ray hits an existing voxel, use the hit face normal: `newVoxel = hitVoxel + faceNormal`. Works for all six faces. This is the most predictable way to build in depth ("Minecraft-style with hands").
3. **Push/pull extrusion.** Pinch on a voxel face and hold: moving the hand toward/away from the camera extrudes a column along the face normal. Uses the **relative** depth signal (change since pinch start), not absolute depth. Preview as ghost column; commit on release as ONE undo command. In Erase tool, pulling removes along the column.
4. **Explicit layer control.** `+Z / −Z` UI buttons, keyboard (`E` = +Z, `Q` = −Z), and a **non-dominant-hand depth gesture**: non-dominant hand pinch-and-hold, then move that hand up/down — every `LAYER_STEP_DISTANCE` (view units, ~0.06) of vertical travel steps `activeZ` by ±1 (like a scroll dial), with a tick animation. Optional alternative (setting): non-dominant hand push/pull via the depth estimator.

### 13.4 Depth estimator (`spatial/DepthEstimator.ts`)
Pipeline:
```
MediaPipe landmarks
   ↓  fingertip relative z (landmark 8 z) · palm scale · hand bbox size
   ↓  depth estimator (weighted combination)
   ↓  smoothing (One Euro)
   ↓  dead zone / threshold + dwell time
   ↓  intentional depth change only
   ↓  active Z layer / extrusion count
   ↓  voxel grid snapping
```
- `normalizedPalmScale = palmScale / baselinePalmScale` (baseline captured at calibration or at pinch start for relative use). Larger = closer.
- `normalizedMpZ = -(tipZ - baselineTipZ) * MPZ_GAIN` (MediaPipe z is **relative to the wrist**, not distance from camera — it mostly captures finger "poke", so palm scale must dominate).
- `depthSignal = W_PALM * (normalizedPalmScale - 1) + W_MPZ * normalizedMpZ` with starting weights `W_PALM = 0.6`, `W_MPZ = 0.4` in `tuning.ts` — tune experimentally and document final values in `docs/GESTURES.md`.
- Smooth with One Euro (stronger than cursor smoothing).
- Quantize: `steps = Math.round(depthSignal / DEPTH_STEP)` with **hysteresis** (must exceed step boundary by `DEPTH_HYSTERESIS` for `DEPTH_DWELL_MS` ~120 ms before the step changes). Dead zone around 0.

### 13.5 Depth Lock
- **ON by default.** While locked, ordinary hand motion affects X/Y only; natural forward/back drift never changes Z.
- Z changes only through: face extrusion, push/pull extrusion (while pinching a face), non-dominant layer gesture, +Z/−Z buttons/keys.
- Toggle with `L` or toolbar button; when unlocked, the dominant hand's absolute depth estimate selects the layer (experimental, clearly labelled).

### 13.6 Placement algorithm (every frame)
1. Raycast dominant index fingertip against voxel instances first, then the active build plane.
2. If voxel hit → candidate = hitVoxel + faceNormal (build) or hitVoxel (erase). If plane hit → candidate = round(hit / voxelSize) with z = activeZ.
3. Show `GhostVoxel` (semi-transparent, pulsing) at candidate; red tint in Erase tool; hide if out of bounds or occupied (build).
4. On pinch `justStarted` → place/erase at candidate, begin a **stroke command group**.
5. While pinch held → **continuous paint**: when candidate cell changes, fill from previous cell to new cell with 3D DDA (`voxelLine.ts`) so fast motion leaves no gaps; skip occupied cells. When the stroke started on a face, keep painting on that face's plane (lock the axis) for predictable walls.
6. On release → commit the group as one undoable command.
7. Stationary pinch never creates duplicates (occupancy map + only act on cell change).

### 13.7 Other voxel features
- Tools: Build / Erase / Paint (recolor existing) — toolbar + `X` toggles Build/Erase.
- Two-hand pinch (not on a voxel face) → transform whole `voxelRoot` (move/rotate/scale) via §12 — lets the user rotate the structure to see and extrude its side faces. "Reset view" button restores root transform.
- Clear (undoable), Undo/Redo (Ctrl+Z / Ctrl+Shift+Z), save/load (§22).

### 13.8 Interaction mapping (show in Help overlay)
```
Move index finger ............ move X/Y cursor (ghost cube shows target)
Pinch ........................ place a voxel
Hold pinch + move ............ paint voxels continuously
Point at voxel face + pinch .. add voxel on that face
Pinch face + push/pull ....... extrude in depth
Non-dominant pinch + up/down . change active Z layer
+Z / −Z (E / Q) .............. precise depth
Depth Lock (L) ............... prevent accidental Z changes (on by default)
Two-hand pinch ............... move / rotate / scale the structure
```

### 13.9 Acceptance criteria
- Stationary pinch creates exactly one voxel.
- Normal-speed drag leaves no gaps.
- Grid alignment exact after 1,000+ placements and after group transforms.
- With Depth Lock on, 2 minutes of drawing a wall never changes Z unintentionally.
- Face extrusion places on the correct face for all 6 normals (unit-tested with mocked hits).
- Push/pull commits one undo step; undo restores exactly.
- 5,000 voxels keeps ≥ 45 FPS on a mid laptop (instancing active).

---

## 14. Experience 2 — Spatial Panel

- Uses `TransformableTextureSurface` with a normal texture material.
- Both hands pinch near the panel's left/right handles (capture zone = panel bounds + margin) → capture; midpoint → position, distance → width/scale, angle → rotation (§12). Optional non-uniform width.
- Content sources (switcher in tool panel): bundled sample images, **freeze camera snapshot**, live camera crop, procedural animated shader.
- Handles glow when grabbable, brighten when captured.
- Controls: Change content, Reset transform. Rigid plane first; four-corner warp is a later flag.

---

## 15. Experience 3 — Air Draw

- 2D overlay canvas aligned to the camera (strokes stored in **view-normalized** coordinates so they survive resize).
- Pinch = pen down (dominant hand), release = pen up. Cursor dot follows index tip when not drawing.
- Sample a point only if moved > `MIN_STROKE_STEP`; smooth with One Euro; render with Catmull-Rom interpolation.
- Brush: color palette (8 neon colors), width (3 sizes), glow toggle (additive/shadowBlur).
- Eraser tool: removes the stroke under the cursor on pinch (stroke-level).
- Undo/redo stroke-level; Clear.
- Optional (later flag): export transparent PNG or composed screenshot — user-triggered only.

---

## 16. Experience 4 — Hand Strings

- `THREE.Points` with glow sprite texture + additive blending at all 21 landmarks per hand.
- `LineSegments` for anatomical connections, plus cross-links: fingertip-to-fingertip within a hand, and matching fingertips left↔right when both hands visible.
- **Elastic feel:** each line's midpoint is a spring-damper control point (`springs.ts`), rendered as a subdivided curve so strings sag and wobble.
- Fading motion trails per fingertip (ring buffer).
- Brightness/thickness driven by landmark velocity; hue drift over time.
- Controls: connection style (skeleton / web / full mesh), trail strength, reset.
- **Reuse typed arrays;** update `BufferAttribute`s in place with `needsUpdate`.

---

## 17. Shared Texture Surface engine

`TransformableTextureSurface`: a (subdivided) plane mesh + pluggable `ShaderMaterial` + `TextureSource` + capture/transform behaviour via `TwoHandTransformController`. Supports: rigid transform (V1), non-uniform width (V1 option), four-corner warp (flag, V1.1), glowing border/handles, alpha mask with rounded corners (content never leaks outside the boundary). Used by Panel, Filter Lab, Portal — one implementation.

`TextureSource` kinds: `liveCameraLens` (screen-space sampling), `liveCameraFull`, `snapshot`, `image`, `procedural`, `renderTarget`.

---

## 18. Experience 5 — Filter Lab (lens mode)

### 18.1 Behaviour
The strip held between both hands acts as a **magic lens**: it shows the camera pixels that are *behind* it on screen, filtered. Outside the strip the normal camera view continues. This is the reel-faithful look.

### 18.2 Lens implementation
In the fragment shader: `screenUv = gl_FragCoord.xy / uResolution` → convert to video UV with the same cover-crop + mirror uniforms as `CameraBackground` (`coverUv()` in `shaders/common.glsl.ts`) → sample `uVideo` → apply filter. Neighbour-sampling filters (edge, blur, sketch, cartoon) use `uVideoTexel = 1/videoSize`. Result: perfect alignment even as the strip moves/rotates/scales. Account for devicePixelRatio in `uResolution`.

### 18.3 Presets (all required unless marked)
| Preset | Implementation |
|---|---|
| None | pass-through |
| Thermal | luminance → false-color LUT (black→blue→magenta→orange→yellow→white) |
| Sketch | grayscale + edge emphasis, paper tint |
| Pixelate | quantize UV to cells (cell size uniform) |
| Glitch | time-based horizontal block displacement, scanlines, RGB offset |
| Red channel | keep red, attenuate G/B |
| Edge | Sobel on luminance, neon on black |
| Blur | 9–13 tap blur, quality-capped |
| Cartoon | posterize + edge lines |
| Rainbow | hue shift by x/y/time |
| Invert *(enhancement)* | 1 − rgb |
| RGB split *(enhancement)* | offset R/G/B samples |
| Pop-art *(enhancement)* | quantize to 4-color palette |

Each preset is a GLSL snippet + uniforms registered in `presets.ts`; `FilterPipeline` builds/caches one material per preset (compile once, switch by swapping material or a `uPreset` int — choose the faster, justify).

### 18.4 Controls
- Two-hand pinch: capture strip; midpoint move; distance stretch (non-uniform width); angle rotate.
- **Thumb-pinky tap** on dominant hand = next filter; on non-dominant hand = previous (normalized + debounced + 400 ms cooldown).
- Keyboard `←`/`→` (and `[`/`]`), UI prev/next buttons, preset list.
- Toast shows preset name on change.
- Source switcher: live lens (default), frozen snapshot, uploaded/bundled image.
- Reset strip.

### 18.5 Guardrails
Effects apply only inside the strip (no full-screen post-processing in V1). Quality preset Low reduces blur taps/edge kernel.

---

## 19. Experience 6 — Portal / Dimensions

Separately selectable, visually distinct from Filter Lab.
- Content sources/presets (at least 3 in V1):
  1. **Nebula** — procedural animated shader (fbm noise, swirling color).
  2. **Other World** — off-screen Three.js scene (e.g. floating crystals + starfield, slow camera drift) rendered to a `WebGLRenderTarget` in `render()`, shown through the portal with slight parallax driven by portal position.
  3. **Inverted Reality** — camera lens with a distinct palette/distortion (ripple).
  4. Bundled image(s).
- Glowing animated border (rim shader), alpha mask so content never leaks outside.
- Two-hand capture/transform (§12), no jump on engage; one hand lost → freeze then release.
- Opening animation: portal scales in from a line when first grabbed.
- Controls: preset/content switcher, Reset Portal. Four-corner warp behind a feature flag (stretch goal).
- Render target size scales with quality preset; dispose on exit.

---

## 20. Experience 7 — 3D Object Lab

- Primitives: cube, sphere, cylinder, plane, torus (≥ 3 required, all 5 targeted). Materials: solid / emissive / transparent; color palette.
- **Spawn:** toolbar button or open-palm hold (`HOLD_MS`) opens a radial spawn menu at the dominant hand; pinch an item to spawn at cursor on the interaction plane.
- **Select:** point at object (hover outline) + pinch = select; "Add to selection" toggle for multi-select.
- **Move:** one-hand pinch-drag moves selected object(s) on a camera-facing plane at the object's depth; depth via push/pull (depth estimator, relative) or `Q/E`.
- **Rotate/scale:** two-hand pinch on selection (§12).
- Duplicate (`D` with selection, offset +1 unit), Delete (`Delete`), Group/Ungroup (THREE.Group), Reset.
- All edits are commands (undoable).
- Later (not V1): GLTF import, snapping, physics.

---

## 21. UI / UX / visual design

### 21.1 Layout
```
+----------------------------------------------------------------------+
| GestureSpace | Experience name | ● Camera on | FPS | Help | Debug | ⚙ |
+--------+--------------------------------------------------+----------+
| Voxel  |                                                  | Tool     |
| Panel  |          LIVE CAMERA + 3D CANVAS                 | panel    |
| Draw   |          (hand overlays, objects)                | (per     |
| Strings|                                                  |  mode)   |
| Filter |                                                  |          |
| Portal |                                                  |          |
| 3D Lab |                                                  |          |
+--------+--------------------------------------------------+----------+
| Status: Right: pinch · Left: — | Undo | Redo | Clear | Reset | Stop cam |
+----------------------------------------------------------------------+
```
- Mode dock left (icons + labels, keys `1`–`7`), per-mode tool panel right (collapsible), status bar bottom.
- The canvas stays full-bleed behind translucent UI chrome.

### 21.2 Visual language
Dark glassmorphism chrome (blurred translucent panels, 12px radius), neon accent palette (turquoise `#21d4d8` primary, magenta, lime, amber), Inter or system font, high-contrast focus rings. Subtle motion (150–250 ms). Avoid clutter over the video.

### 21.3 UI states
1. **Pre-permission:** explains what the camera is used for and that nothing leaves the device; "Enable camera" button (permission requested only on click).
2. **Denied/error:** clear message + how to re-enable + Retry. Also handles no camera / in-use camera / insecure context.
3. **Initializing:** "Loading hand tracker…" with progress.
4. **No hand visible:** subtle hint "Show your hand to the camera".
5. **One hand:** single-hand features on; two-hand features show "Bring your second hand in".
6. **Two hands:** two-hand indicators (line between hands, center dot).
7. **Tracking lost during capture:** brief freeze, "Tracking lost", then safe release.
8. **Camera stopped:** everything paused; "Start camera" button.

### 21.4 Onboarding (first run; skippable; re-openable from Help)
1. Privacy/camera explanation → 2. Place one hand in framing guide → 3. "Pinch your thumb and index finger" → live ✓ "Pinch detected" → 4. "Now pinch with both hands and spread them" → ✓ → 5. Choose "Start Voxel Builder" or "Explore all experiences".

### 21.5 Feedback principles
Highlight fingertips/handles when grabbable; change state on capture; ghost preview before placement; selection outline; concise status text ("Panel captured", "Depth layer +2", "Filter: Thermal").

### 21.6 Help overlay
Per-mode gesture cheatsheet (only gestures relevant to the active experience) + keyboard shortcuts.

### 21.7 Keyboard shortcuts (`config/keybindings.ts`)
`1–7` modes · `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Shift+Z` redo · `C` clear mode · `R` reset transform/view · `H` help · `` ` `` debug · `Q/E` depth −/+ · `L` depth lock · `X` build/erase · `←/→` filter prev/next · `Delete` delete selection · `D` duplicate · `Esc` close overlays / release.

### 21.8 Settings
Dominant hand (right/left), mirror view, smoothing, pinch sensitivity, rotation/scale sensitivity, inference rate (15/30/60), quality preset (Low/Medium/High), camera resolution, show skeleton, Depth Lock default, reset onboarding, reset all settings.

### 21.9 Debug panel
Render FPS, inference FPS, avg inference ms, dropped frames, delegate (GPU/CPU), per-hand score/side/palmScale/depthSignal, active gestures with phases, capture owner, cursor hit, draw calls/triangles (`renderer.info`), voxel/object count, heap (if available), fixture record/playback controls.

### 21.10 Accessibility
Every gesture-triggered critical action has a button + keyboard equivalent; buttons have aria-labels; respects `prefers-reduced-motion`; readable contrast over video.

### 21.11 Mode-switch contract
Camera stays on; tracker single instance; current mode gets `exit()` (all captures released) before next `enter()`; per-mode state preserved across switches (setting: "Reset on exit"); help overlay updates.

---

## 22. Undo/redo, persistence

- `CommandHistory` per mode (cap 200). Commands: `AddVoxels`, `RemoveVoxels`, `RecolorVoxels`, `AddStroke`, `RemoveStroke`, `TransformObject`, `SpawnObject`, `DeleteObjects`, `GroupObjects`, `ClearMode`.
- Settings → `localStorage` (versioned, migrate or reset on version mismatch).
- Scenes → IndexedDB: autosave per mode (debounced 1 s) + explicit Save/Load/Export JSON/Import JSON in toolbar. Never store camera frames (snapshots used as panel content are not persisted unless user exports).

---

## 23. Performance engineering

- Render ~60 FPS; inference 30 Hz default; interpolate between.
- 720p capture; avoid queuing stale frames.
- Instancing for voxels; object pooling; reuse buffers; no per-frame allocation.
- Shaders: lens only inside surfaces; quality presets; compile materials once.
- React: no landmark data in state; status updates throttled.
- Dispose GPU resources on mode exit/dispose; verify with `renderer.info.memory` returning to baseline after switching through all modes 10× (write this as a dev check).
- Pause inference + render when tab hidden (`visibilitychange`).
- Web Worker for vision only if profiling shows main-thread jank (document decision).

---

## 24. Privacy & security

- Camera only after explicit click; visible "● Camera on" indicator and Stop Camera button.
- No recording, no uploads, no analytics in V1.
- All processing local; model and WASM self-hosted.
- Exports only user-triggered.
- Production headers (vercel.json/netlify.toml): HTTPS, CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'`), `Permissions-Policy: camera=(self)`, long cache for `/models` and `/mediapipe`.
- Pin dependency versions (lockfile), `npm audit` in CI.

---

## 25. Testing strategy

**Unit (Vitest):** vector math, angle unwrap, cover-crop mapping, One Euro filter, pinch/grab/point/thumb-pinky state machines (synthetic landmark sequences), two-hand scale/rotation, depth estimator quantization + hysteresis, grid snapping, face-normal extrusion, 3D DDA line, VoxelGrid occupancy, command undo/redo, serializers round-trip.

**Fixtures (`tests/fixtures/landmarks/`):** record with `FixtureRecorder` — clean pinch, jittery pinch, hand disappears mid-grab, two-hand scale, two-hand rotation, hands crossing, push/pull depth, thumb-pinky tap, false-positive near face. Integration tests replay them through the full perception→gesture pipeline via `FixturePlaybackSource` and assert events.

**E2E (Playwright, Chromium):** launch args `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` (optionally `--use-file-for-fake-video-capture=tests/e2e/assets/hands.y4m`). Test: permission granted/denied UI, mode switching doesn't duplicate render loops/trackers (expose a dev-only `window.__gs_debug` counters object), reset/clear from every mode, scene save/load round trip, layout at 1280×720 and 1920×1080.

**Manual matrix (document results in docs/PERFORMANCE.md):** bright/dark room, one hand exits frame, hands cross, fast movement, stationary pinch, permission revoked mid-session, mode changed while holding object, 5,000-voxel scene, Chrome/Edge primary, Firefox/Safari secondary.

---

## 26. Build phases (STOP after each — §3)

**Phase 0 — Foundation.** Vite React TS app, strict tsconfig, ESLint/Prettier, Vitest, Playwright config, npm scripts, folder skeleton (§6) with placeholder modules, `tuning.ts`, AGENTS.md + CLAUDE.md, README stub, asset scripts (wasm copy + model fetch), git init, `.gitignore` (exactly §6.1), `.editorconfig`, `.nvmrc`, base AppShell layout with dark theme. *Accept:* `npm run dev` shows shell; all checks pass.

**Phase 1 — Camera.** `CameraManager` (start/stop/resolution, device change, errors), PermissionScreen and all camera UI states, hidden video + `VideoTexture`, `SceneManager` with one renderer, `CameraBackground` quad with `ViewportMapper` cover-crop + mirror, resize handling, camera-on indicator. *Accept:* mirrored full-bleed camera, correct aspect at any window size, stop/start works, denial handled.

**Phase 2 — Hand tracker.** `HandTracker` (load once, GPU→CPU fallback), `HandNormalizer` (handedness verified + flag set), `handLandmarks.ts`, skeleton overlay on 2D canvas aligned to video, debug panel v1 (FPS, inference FPS/ms, scores), render/inference decoupled, `InputSource` + fixture recorder/playback. *Accept:* two hands tracked with aligned skeletons labelled correctly; no duplicate tracker under StrictMode.

**Phase 3 — Smoothing + gestures. (M0)** One Euro smoothing (two profiles), confidence gate, jump rejection, grace period, `handMetrics`, `GestureStateMachine`, pinch/point/grab/openPalm/thumbPinky/twoHand, precedence, `GestureStatus` UI, first recorded fixtures + tests. *Accept:* stationary hand overlay visibly stable; pinch never flickers; status accurate. **Demo: "My browser understands my hands locally."**

**Phase 4 — Spatial cursor.** `CoordinateMapper`, `RaycastCursor`, `InteractionPlane`, `CaptureManager`, `DepthEstimator` (with debug readout), 3D cursor visual per hand, `ModeController` + `SpatialMode` interface + registry + ModeDock wired with placeholder modes. *Accept:* 3D cursor tracks fingertip stably; switching placeholder modes leaves no leaks.

**Phase 5 — Voxel Builder. (M1)** Everything in §13: grid, instanced renderer, ghost, build plane grid, placement, continuous paint + DDA, face extrusion, push/pull extrusion, Depth Lock, layer control (buttons/keys/non-dominant gesture), tools, palette/materials, undo/redo/clear, tool panel, help. *Accept:* §13.9. **Demo: "I can build 3D structures in the air."**

**Phase 6 — Two-hand transform core.** `TwoHandTransformController` extracted and unit-tested; apply to voxelRoot group transform; transform commands. *Accept:* no jump on engage, safe release on hand loss, handles crossing.

**Phase 7 — Spatial Panel + Texture Surface.** `TransformableTextureSurface`, `TextureSource`s (image/snapshot/liveCameraFull/procedural), handles, PanelMode, tool panel. *Accept:* §14.

**Phase 8 — Air Draw.** §15. *Accept:* smooth strokes at normal speed, palette/width/glow, eraser, undo/clear, strokes stay aligned on resize.

**Phase 9 — Hand Strings.** §16. *Accept:* elastic network with trails at ≥ 55 FPS, zero per-frame allocations in profiler.

**Phase 10 — Filter Lab + Portal. (M3)** `liveCameraLens` source + `coverUv` shader lib, FilterPipeline with all 13 presets, thumb-pinky/keys/UI switching, toast; PortalMode with ≥ 3 presets incl. render-target world, rim, opening animation. *Accept:* §18 and §19; lens perfectly aligned with background while moving/rotating. **Demo: "One camera, every reel-style creative experience."**

**Phase 11 — 3D Object Lab. (completes M2)** §20. *Accept:* create ≥ 3 primitives, select/move/rotate/scale/duplicate/delete/group, all undoable. **Demo: "I can grab and transform virtual content."**

**Phase 12 — Product polish.** Onboarding, HelpOverlay per mode, SettingsPanel, quality presets, full DebugPanel, persistence (settings + scenes + import/export), keyboard map, accessibility pass, visual polish pass.

**Phase 13 — Performance + QA. (M4)** Profiling, leak check across mode switches, 5k-voxel test, E2E suite complete, manual matrix run + documented, all docs (§28) written, deploy config + CI (§27), production deploy. **Demo: "A complete spatial interaction product, not a single effect."**

**Phase 14 — Optional AI layer. DO NOT START unless I explicitly ask.** Voice/text → constrained JSON command schema → validated → deterministic scene actions ("create a red sphere", "build a 5×5 wall of blue voxels"). Any API key must go through a backend proxy, never the frontend.

---

## 27. Deployment & CI

- Static build to Vercel (or Netlify) with headers from §24; long-cache model/wasm.
- Compatibility check at startup: `getUserMedia`, WebGL2, WebAssembly, secure context — show a friendly unsupported-browser message if missing.
- GitHub Actions: on PR → install, lint, typecheck, unit tests, build. On main → + Playwright smoke → deploy. Tag releases `v0.1-m0` … `v1.0-m4`.

---

## 28. Documentation deliverables

- **README:** what it is, GIF/screenshot placeholders, quick start, browser requirements, camera privacy note, controls per experience, scripts, deploy.
- **docs/ARCHITECTURE.md:** layers, data flow, module ownership, the "modes never touch the tracker" rule, coordinate spaces.
- **docs/GESTURES.md:** each gesture, thresholds (final tuned values), state diagrams (mermaid), precedence, depth estimator weights.
- **docs/MODES.md:** one section per experience; shared families documented once.
- **docs/PERFORMANCE.md:** baseline numbers, device/browser matrix, manual test results.
- **docs/TROUBLESHOOTING.md:** lighting, camera in use, permissions, GPU fallback, known limitations (no true world depth, webcam z is relative).

---

## 29. V1 Definition of Done

| Area | Done when… |
|---|---|
| Platform | One camera stream, one tracker, one render loop; no duplicates after any number of mode switches |
| Tracking | Two hands tracked with debug landmarks, correct handedness, confidence |
| Gestures | Pinch lifecycle, two-hand transforms, thumb-pinky stable in normal use |
| Voxel | Build, erase, paint, face extrusion, push/pull, Depth Lock, layers, undo/redo, clear; 5k voxels usable |
| Panel | Two-hand grab, move, scale, rotate a textured plane; content switch |
| Draw | Smooth strokes, color/width, erase, undo/clear |
| Strings | Reactive particles, elastic line network, trails |
| Filter Lab | All 10 required presets (+3 enhancements) in lens mode; gesture/key/UI switching; strip transform |
| Portal | Separately selectable, ≥ 3 distinct presets, two-hand transform, reset |
| 3D Lab | ≥ 3 primitives; select/transform/duplicate/delete/group; undo |
| UI | Mode dock, tool panels, help/onboarding, camera control, reset/clear, debug, settings |
| Persistence | Settings + local scene save/load + JSON import/export |
| Performance | No runaway memory; usable FPS on target laptop (Chrome) |
| Privacy | No upload/recording; Stop camera works; camera indicator |
| Docs | README + all docs in §28 |

---

## 30. Out of scope for V1

Room-scale AR anchoring, headset/WebXR modes, multi-user/networking, accounts/payments, physics, cloud AI per frame, custom-trained gesture models, GLTF import, video recording, mobile-first layout (desktop first; mobile later).

---

**Start now with Phase 0.** Restate in 5 bullets your understanding of the architecture rules (§2) before writing code, then build Phase 0 and stop with the Phase 0 report.
