# AGENTS.md — GestureSpace

Instructions for coding agents (Codex, Claude Code, …). The full source of truth is
[`GestureSpace_Build_Prompt.md`](GestureSpace_Build_Prompt.md); this file condenses §2, §5, §6, §7.
**The folder layout below supersedes §6** (consolidated to fewer, cohesive files).

GestureSpace is a browser-only webcam hand-tracking "spatial studio": one React + Three.js app
with seven experiences (Voxel, Panel, Draw, Strings, Filter Lab, Portal, 3D Object Lab) sharing
one camera, one MediaPipe tracker, one gesture engine and one renderer.

## Hard rules

1. **Modes never touch MediaPipe, the camera, or the render loop.** They consume `InteractionFrame` only.
2. **Exactly one** camera stream, `HandLandmarker`, render loop and `WebGLRenderer`. Core singletons
   are created in `src/app/bootstrap.ts` (module-guarded, ref-counted) so React StrictMode
   double-mounting cannot duplicate them. Everything is disposable.
3. **No high-frequency data in React state.** Landmarks/gestures/cursors live in core systems/refs.
   Zustand (`src/state/appStore.ts`) holds UI state only; status text is throttled to ≤10 Hz.
4. **TypeScript strict, no `any`** (use `unknown` + narrowing). Use named landmark constants from
   `src/vision/landmarks.ts` — never magic indices in mode code.
5. **No per-frame allocation** in hot paths. Reuse scratch vectors and typed buffers.
6. **Dispose** every Three.js geometry/material/texture/render target in mode `dispose()`.
7. **No new dependencies** beyond the stack below without stating why.
8. **Verify library APIs** against installed types; note deviations.
9. **Tests alongside code**: pure math/gesture logic gets Vitest tests in the same change.
10. **All tunable numbers** in `src/config/tuning.ts` — never inline thresholds/timings.
11. Build **phase by phase** (§26). Each phase ends with `npm run lint`, `typecheck`, `test`,
    `build` all green, a commit `phase-N: <summary>`, and a stop for review.
12. If a wrong guess would be expensive, ask instead of guessing.
13. **Lean file structure.** No placeholder/empty files — create a file only when a phase fills it.
    Group small cohesive pieces in one module (e.g. all gesture detectors in one file, all filter
    presets in one file). Split a file only when it grows large (~400+ lines) or has a distinct owner.

## Stack

TypeScript (strict) · React · Vite · `@mediapipe/tasks-vision` HandLandmarker · `three` (direct,
no R3F) · `zustand` (UI state) · plain CSS variables · Vitest · Playwright · ESLint + Prettier ·
`localStorage` + `idb-keyval`. No backend, no cloud APIs. Model + WASM are self-hosted
(`public/models/hand_landmarker.task` committed; `public/mediapipe/wasm/` copied at postinstall).

## Architecture (layers)

```
L1 INPUT          CameraManager → <video> + shared THREE.VideoTexture; InputSource (live | fixture)
L2 PERCEPTION     HandTracker → HandNormalizer → LandmarkSmoother (One Euro) + confidence → HandFrame
L3 INTERPRETATION GestureEngine → GestureFrame; DepthEstimator; CoordinateMapper / ViewportMapper
L4 INTERACTION    RaycastCursor → SceneCursor; CaptureManager; ModeController → InteractionFrame
L5 EXPERIENCES    voxel | panel | draw | strings | filter | portal | objectLab
L6 PRESENTATION   SceneManager (one renderer, camera-background quad) · OverlayCanvas2D · React UI
```

One `requestAnimationFrame` (`src/core/timing/renderLoop.ts`): infer on new video frame (throttled,
never queue stale frames) → normalize/smooth/gate → gestures + depth → cursors → `activeMode.update`
→ render (background → 3D → 2D overlay) → perf monitor + throttled status. Render rate ≠ inference rate.

The camera is drawn **inside Three.js** as a full-screen quad using the same `ViewportMapper`
cover-crop + mirror math as lens shaders and overlays; the `<video>` is hidden.

Coordinate spaces (only `ViewportMapper`/`CoordinateMapper` convert): tracker raw → view-normalized
(mirrored, `xv = 1 - x`) → screen CSS px (cover-crop) → NDC → scene (raycast).
`TrackedHand.side` is always the user's PHYSICAL hand (`HANDEDNESS_LABEL_SWAP` in tuning).

## Folder map (authoritative — replaces §6)

Files marked `(Pn)` are created in that phase; nothing exists before it is implemented.

```
src/
  main.tsx
  app/        App.tsx (root + keyboard shortcuts) · bootstrap.ts (core singletons)
  config/     tuning.ts (ALL thresholds + feature flags) · keybindings.ts
  core/       types.ts (shared types + §7 frame contracts)
              camera.ts (P1: CameraManager + permission/capability checks)
              renderLoop.ts (P1: the one rAF loop + FrameClock + PerformanceMonitor)
              input.ts (P2: InputSource, LiveTrackerSource, FixturePlaybackSource, FixtureRecorder)
  vision/     HandTracker.ts (P2) · landmarks.ts (P2: named indices, connections, hand metrics)
              handPipeline.ts (P2/P3: normalizer, handedness, confidence gate, grace period)
              smoothing.ts (P3: OneEuroFilter + LandmarkSmoother)
  gestures/   GestureEngine.ts (P3: engine + precedence) · stateMachine.ts (P3)
              detectors.ts (P3: pinch, point, grab, openPalm, thumbPinky, swipe) · twoHand.ts (P3)
  spatial/    ViewportMapper.ts (P1: cover-crop + mirror) · CoordinateMapper.ts (P4: + raycast cursor,
              interaction plane) · DepthEstimator.ts (P4) · CaptureManager.ts (P4)
  scene/      SceneManager.ts (P1: renderer, camera, lighting, dispose helpers)
              CameraBackground.ts (P1) · overlay.ts (P2: OverlayCanvas2D + hand skeleton)
              materials.ts (P4: shared materials + selection highlight)
  modes/      registry.ts · types.ts (P4: SpatialMode, ModeContext) · ModeController.ts (P4)
    shared/   history.ts (P5: CommandHistory) · TwoHandTransform.ts (P6)
              TextureSurface.ts (P7: surface + TextureSources) · glsl.ts (P1: coverUv, mirror, hsv)
    voxel/    VoxelMode.ts · VoxelGrid.ts (grid + commands) · VoxelRenderer.ts (instancing, ghost,
              build-plane grid) · voxelMath.ts (DDA line, face extrusion, layer stepping)   (P5)
    panel/    PanelMode.ts (P7)
    draw/     DrawMode.ts · strokes.ts (model, Catmull-Rom, renderer)   (P8)
    strings/  StringsMode.ts · springs.ts   (P9)
    filter/   FilterLabMode.ts · filters.ts (all 13 presets + pipeline)   (P10)
    portal/   PortalMode.ts · portalContent.ts (material, presets, other-world scene)   (P10)
    objectLab/ ObjectLabMode.ts · objects.ts (primitives, commands, transform)   (P11)
  ui/         AppShell.tsx (top bar, tool panel, status bar) · ModeDock.tsx (+ icons) · styles.css
              PermissionScreen.tsx (P1) · DebugPanel.tsx (P2) · GestureStatus (P3, in AppShell)
              overlays.tsx (P12: Help, Settings, Onboarding) · toolPanels.tsx (per-mode controls)
  state/      appStore.ts (UI-only zustand) · persistence.ts (P12: settings, scenes, serializers)
  utils/      math.ts (scalar + vector helpers) · logger.ts
tests/        unit/ · integration/ · fixtures/landmarks/ · e2e/
docs/         (P13, per §28) ARCHITECTURE, GESTURES, MODES, PERFORMANCE, TROUBLESHOOTING
```

## Core contracts (`src/core/types/`)

```ts
type HandSide = 'left' | 'right';
type ModeId = 'voxel' | 'panel' | 'draw' | 'strings' | 'filter' | 'portal' | 'objectLab';
interface TrackedHand {
  side;
  score;
  rawLandmarks;
  landmarks /* smoothed, view-normalized */;
  worldLandmarks?;
  palmScale;
  bbox;
  lostForMs;
}
interface HandFrame {
  timestamp;
  inferenceTimestamp;
  left?;
  right?;
}
type GesturePhase = 'idle' | 'candidate' | 'active' | 'released';
interface GestureState {
  phase;
  startedAt;
  justStarted;
  justEnded;
  value;
}
interface HandGestures {
  pinch;
  grab;
  point;
  openPalm;
  thumbPinky;
  swipe?;
  depthSignal;
}
interface TwoHandState {
  active;
  justStarted;
  justEnded;
  center;
  distance;
  angle;
  scale;
  rotation;
  translation;
}
interface GestureFrame {
  left?;
  right?;
  twoHand;
}
interface SceneCursor {
  side;
  screen;
  ndc;
  hit?;
}
interface InteractionFrame {
  timestamp;
  dt;
  hands;
  gestures;
  cursors;
  dominant;
  activeMode;
}
interface SpatialMode {
  id;
  enter(ctx);
  update(frame);
  render?();
  reset();
  exit();
  dispose();
  serialize?();
  deserialize?();
}
interface Command {
  label;
  do();
  undo();
}
```

`ModeContext` gives modes: scene, camera, renderer, overlay, videoTexture, viewport, coords,
cursors, capture, history, settings, emitStatus. Modes get nothing else.

## Commands

`npm run dev` · `build` · `preview` · `lint` · `format` · `typecheck` · `test` · `test:watch` · `e2e` · `fetch-model`
