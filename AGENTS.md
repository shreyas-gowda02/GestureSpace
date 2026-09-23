# AGENTS.md — GestureSpace

Instructions for coding agents (Codex, Claude Code, …). The full source of truth is
[`GestureSpace_Build_Prompt.md`](GestureSpace_Build_Prompt.md); this file condenses §2, §5, §6, §7.

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
   `src/vision/handLandmarks.ts` — never magic indices in mode code.
5. **No per-frame allocation** in hot paths. Reuse scratch vectors and typed buffers.
6. **Dispose** every Three.js geometry/material/texture/render target in mode `dispose()`.
7. **No new dependencies** beyond the stack below without stating why.
8. **Verify library APIs** against installed types; note deviations.
9. **Tests alongside code**: pure math/gesture logic gets Vitest tests in the same change.
10. **All tunable numbers** in `src/config/tuning.ts` — never inline thresholds/timings.
11. Build **phase by phase** (§26). Each phase ends with `npm run lint`, `typecheck`, `test`,
    `build` all green, a commit `phase-N: <summary>`, and a stop for review.
12. If a wrong guess would be expensive, ask instead of guessing.

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

## Folder map

```
src/app          App, AppShell, bootstrap (singletons)
src/config       tuning.ts, keybindings.ts, featureFlags.ts
src/core         camera/, input/, timing/, types/ (common.ts, frames.ts)
src/vision       HandTracker, handLandmarks, HandNormalizer, LandmarkSmoother, OneEuroFilter, confidence, handMetrics
src/gestures     GestureEngine, GestureStateMachine, pinch, point, grab, openPalm, thumbPinky, swipe, twoHand, precedence
src/spatial      ViewportMapper, CoordinateMapper, RaycastCursor, InteractionPlane, DepthEstimator, CaptureManager, calibration
src/scene        SceneManager, CameraBackground, OverlayCanvas2D, HandSkeletonOverlay, lighting, materials, selection, dispose
src/modes        ModeController, registry, shared/ (SpatialMode, commandHistory, TwoHandTransformController,
                 TransformableTextureSurface, TextureSource, shaders/), voxel/, panel/, draw/, strings/, fx/, portal/, objectLab/
src/ui           ModeDock, Toolbar, StatusBar, GestureStatus, DebugPanel, SettingsPanel, HelpOverlay, Onboarding, PermissionScreen, styles/
src/state        appStore, selectors
src/persistence  settingsStore, localSceneStore, serializers
src/utils        math, vectors, pool, logger
tests/           unit/, integration/, fixtures/landmarks/, e2e/
```

## Core contracts (`src/core/types/`)

```ts
type HandSide = 'left' | 'right';
type ModeId = 'voxel' | 'panel' | 'draw' | 'strings' | 'filter' | 'portal' | 'objectLab';
interface TrackedHand { side; score; rawLandmarks; landmarks /* smoothed, view-normalized */;
  worldLandmarks?; palmScale; bbox; lostForMs }
interface HandFrame { timestamp; inferenceTimestamp; left?; right? }
type GesturePhase = 'idle' | 'candidate' | 'active' | 'released';
interface GestureState { phase; startedAt; justStarted; justEnded; value }
interface HandGestures { pinch; grab; point; openPalm; thumbPinky; swipe?; depthSignal }
interface TwoHandState { active; justStarted; justEnded; center; distance; angle; scale; rotation; translation }
interface GestureFrame { left?; right?; twoHand }
interface SceneCursor { side; screen; ndc; hit? }
interface InteractionFrame { timestamp; dt; hands; gestures; cursors; dominant; activeMode }
interface SpatialMode { id; enter(ctx); update(frame); render?(); reset(); exit(); dispose(); serialize?(); deserialize?() }
interface Command { label; do(); undo() }
```

`ModeContext` gives modes: scene, camera, renderer, overlay, videoTexture, viewport, coords,
cursors, capture, history, settings, emitStatus. Modes get nothing else.

## Commands

`npm run dev` · `build` · `preview` · `lint` · `format` · `typecheck` · `test` · `test:watch` · `e2e` · `fetch-model`
