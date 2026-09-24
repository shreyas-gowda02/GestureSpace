# CLAUDE.md — GestureSpace session handoff

> **Read this first in every new session.** It records what GestureSpace is, where the build
> stands, every decision made so far, and exactly how to continue. The architecture, folder map and
> data contracts are imported below from AGENTS.md. The full original spec is
> [GestureSpace_Build_Prompt.md](GestureSpace_Build_Prompt.md) (section refs like "§13" point into it);
> the product blueprint is `GestureSpace_One_Stop_Project_Guide_v2.docx` (background only — the
> Build Prompt wins on any conflict, and **this file + AGENTS.md win over both** where they record
> an agreed deviation).
>
> **Keep this file current:** at the end of every phase update §2 (status), §3 (next step),
> §6 (decisions) and §10 (session log) before committing.

@AGENTS.md

---

## 1. What we are building (one paragraph)

GestureSpace is a **browser-only webcam hand-tracking "spatial studio"**: one React + Three.js app
where the user picks one of **seven experiences** and creates/manipulates things with their hands —
(1) **Voxel Builder** (pinch to build turquoise blocks in 3D, depth layers, face extrusion),
(2) **Spatial Panel** (hold/stretch/rotate an image between two hands), (3) **Air Draw** (glowing
strokes with the index finger), (4) **Hand Strings** (glowing particles + elastic threads on hand
joints), (5) **Filter Lab** (a "magic lens" strip that shows the camera filtered — thermal, sketch,
glitch…), (6) **Portal / Dimensions** (a window into another world), (7) **3D Object Lab**
(spawn/select/move/rotate/scale primitives). All seven share ONE camera, ONE MediaPipe tracker, ONE
gesture engine and ONE renderer. Everything runs locally; no backend, no uploads, free to host.

---

## 2. Current status

| Phase | Name                                                                 | Status                                                                    | Commit               |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------- |
| 0     | Foundation (tooling, shell, lean structure)                          | ✅ done                                                                   | `18c7bbb`, `f4d6d00` |
| 1     | Camera (permission flow, mirrored cover-crop background)             | ✅ done — **awaiting user's real-webcam confirmation**                    | `80f5c7f`            |
| 2     | Hand tracker                                                         | ✅ done — handedness fixed after user's real-hand test; awaiting re-check | `phase-2` commits    |
| 3     | Smoothing + gestures + main-user lock (**M0** demo)                  | ✅ done — awaiting user's real-hand check                                 | `phase-3` commit     |
| 4     | Spatial cursor + ModeController                                      | ✅ done — awaiting user's real-hand check                                 | `phase-4` commit     |
| 5     | Voxel Builder (**M1** demo)                                          | ⏭ **next**                                                                | —                    |
| 6     | Two-hand transform core                                              | ⬜                                                                        | —                    |
| 7     | Spatial Panel + Texture Surface                                      | ⬜                                                                        | —                    |
| 8     | Air Draw                                                             | ⬜                                                                        | —                    |
| 9     | Hand Strings                                                         | ⬜                                                                        | —                    |
| 10    | Filter Lab + Portal (**M3** demo)                                    | ⬜                                                                        | —                    |
| 11    | 3D Object Lab (completes **M2**)                                     | ⬜                                                                        | —                    |
| 12    | Product polish (onboarding, settings, persistence…)                  | ⬜                                                                        | —                    |
| 13    | Performance + QA + docs + deploy (**M4**)                            | ⬜                                                                        | —                    |
| 14    | Optional AI layer — **do NOT start unless the user explicitly asks** | ⛔                                                                        | —                    |

**What works today:** app shell (top bar, 7-mode dock with keys 1–7, collapsible tool panel with
per-mode gesture help, status bar), camera permission/error/stopped screens, live mirrored
full-bleed camera rendered inside Three.js with object-fit-cover cropping, Stop/Start camera, FPS
counter, dev debug counters (`window.__gs_debug`). **Phase 2:** MediaPipe HandLandmarker (GPU→CPU,
loads once when the camera first starts, ~0.8 s), live two-hand skeleton overlay aligned to the
video (right = turquoise, left = magenta, with side + confidence label), "Loading hand tracker…" /
"Show your hand to the camera" notices, tracker error + Retry, status bar "Right: tracked · Left: —",
Debug panel (backtick key) with render/inference rates, inference ms, skipped frames, delegate,
per-hand data, and a landmark fixture recorder/player. **Phase 3:** One Euro smoothing (visual + trigger
profiles, **plus render-time velocity prediction** so visuals update at 60 Hz with ~6 ms lag —
D30; Debug panel Off / Smooth / Smooth + predict switch), confidence gate, jump rejection, 150 ms loss grace (hand drawn faded, status "lost…"),
**main-user lock** (detects up to 4 hands, keeps one person's pair — see D23), stable left/right
(label hysteresis + identity lock while a gesture holds), gestures pinch / grab / point / open palm /
thumb-pinky (+ swipe, off) with hysteresis + debounce, two-hand pinch (scale / rotation /
translation vs baseline), pinch ring + two-hand line/centre/×scale·angle overlay, status bar
"Right: pinch · Left: open · Two-hand ✓", Debug panel gesture chips + main-user stats.
**Phase 4:** per-hand **3D cursor** (index fingertip → raycast → hit on objects or the interaction
plane; ring marker turns white over objects, shrinks while pinching), depth estimator (palm scale +
fingertip poke, relative, quantised steps), CaptureManager (release goes to the captor; lost hand /
mode switch / open UI overlay drop captures), **ModeController** (clean switch contract, per-mode
state + undo history preserved), 7 **placeholder experiences** (a shape per mode you can pinch-drag),
working Undo/Redo/Clear/Reset buttons + keys, mode status line, Debug panel depth / cursor /
captures / renderer stats + **Leak check** (10× all modes → GPU memory flat). **Post-Phase 4:**
hand tracking runs in a **Web Worker** (D38; screen stays at 60 FPS while inference runs; auto
fallback to the main thread; `?vision=main` forces the old path) and all 4 detected hands now reach
the main-user lock (D39). 122 tests passing.

**What does not work yet:** the seven real experiences (placeholders only — Voxel Builder is next),
Help/Settings panels (buttons only toggle state; settings live in the store with defaults).

**Pushed to GitHub:** yes — everything up to `ba40b4d` (lag fix) was pushed by the user on
2026-09-24. Later commits: check with `git status` (the user pushes manually with `git push`).

---

## 3. How to resume (next steps)

1. `git status` / `git log --oneline -5` — confirm the tree is clean and matches §2.
2. `npm install` if `node_modules/` is missing (postinstall copies MediaPipe WASM into
   `public/mediapipe/wasm/`).
3. Run the phase gate once to confirm a green baseline (see §5).
4. **Pending before Phase 5 — handedness robustness (§7c).** Ask whether the user has made the
   real recordings (`tests/fixtures/landmarks/real/right-only.json`, `left-only.json`,
   `both-crossing.json`, optional `friend-right.json`) and the Debug panel check (friend's right
   hand → `MediaPipe “Right”` or `“Left”`?). With them: score current vs new handedness, then build
   §7c Layers 1–2. Also ask for the Debug panel Render / Inference numbers after the worker (D38).
5. Ask the user about the Phase 4 real-hand check (3D cursor ring follows the fingertip; pinch the
   placeholder shape and drag it; switch modes mid-drag; Leak check button). Earlier pending checks:
   lag fix feel (D30) and Phase 3 gestures (pinch, fist, point, open
   palm, thumb-pinky, two-hand pinch), steadiness when still, and the main-user lock with a second
   person in view. Also ask for the Debug panel's inference Hz / ms. Tune thresholds in
   `config/tuning.ts` from their feedback if needed.
6. Then start **Phase 5 — Voxel Builder** (§7 below): replace the `voxel` placeholder factory in
   `modes/registry.ts` with the real mode. Stop after it and report.

The user replies **"continue"** to approve moving to the next phase. Never start the next phase
without that.

---

## 4. Working agreements with the user (important)

- **Phase-gated:** build one phase, run all checks, commit, then **STOP** and report (format in §5).
  Wait for "continue".
- **Lean file structure** (user explicitly asked): no placeholder/empty files; group small cohesive
  modules; follow the folder map in AGENTS.md (it supersedes spec §6). Before creating a file, check
  whether the code belongs in an existing one.
- **Explain for testing:** each phase report must include plain-language "how to try it" steps the
  user can follow in their own browser.
- **Commit** at the end of each phase (`phase-N: <summary>`). **Do not push** unless the user asks;
  they push themselves with `git push`.
- **GitHub account = `shreyas-gowda02`** (repo `github.com/shreyas-gowda02/GestureSpace`). The local
  `gh` CLI is logged into a _different_ work account (`shreyas-apphelix`) — never use `gh` for this
  project unless `gh auth status` shows `shreyas-gowda02`. The remote URL is pinned to
  `https://shreyas-gowda02@github.com/shreyas-gowda02/GestureSpace.git` so Git Credential Manager
  uses the right login; do not change it or delete the apphelix credential.
- Commit author is `Shreyas Gowda <shreyasg778@gmail.com>` (repo-local git config).
- Never modify the two spec documents; `GestureSpace_Build_Prompt.md` is excluded from Prettier.
- Ask the user (in the phase report) when a wrong guess would be expensive.

---

## 5. Phase gate + report format

Run, all must pass:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx prettier --check .
```

Then commit and report **exactly** like this:

```
## Phase N report — <name>
**Built:** <bullets>
**Files added/changed:** <list>
**How to try it (manual steps):** <numbered steps, what the user should see>
**Checks:** lint ✅ typecheck ✅ tests ✅ (N passing) build ✅
**Deviations from spec:** <none | list with reason>
**Known issues / risks:** <list>
**Questions for you:** <none | list>
**Next phase:** <name + one-line plan>
```

Milestones: **M0** after Phase 3 · **M1** after 5 · **M2** after 7 + 11 · **M3** after 10 · **M4** after 13.

---

## 6. Decisions & deviations log (agreed — do not re-litigate)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Why                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| D1  | Project lives at repo root, not in a `gesturespace/` subfolder                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Repo already existed                                                                                          |
| D2  | Current stable deps: React 19, TS 6.0, Vite 8, Vitest 5, ESLint 10 (flat), three 0.186, @mediapipe/tasks-vision 1.0.1, zustand 5, idb-keyval 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Spec says use current stable. typescript-eslint supports TS < 6.1 — don't bump TS past 6.0.x without checking |
| D3  | **Lean folder map** (AGENTS.md) replaces spec §6; ~100 placeholder files deleted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | User request: fewer files                                                                                     |
| D4  | Single `tsconfig.json` (no app/node split); Prettier config lives in `package.json`; `typecheck` = `tsc --noEmit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Fewer files                                                                                                   |
| D5  | Feature flags live in `config/tuning.ts` (`FEATURE_FLAGS`), not a separate file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Fewer files                                                                                                   |
| D6  | `ModeContext`/`SpatialMode` types go in `src/modes/types.ts` (Phase 4), not `core/types.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | They depend on Three.js + Phase 1–4 classes                                                                   |
| D7  | Mode registry (`modes/registry.ts`) already holds metadata (name, hotkey, tagline, help); factories added in Phase 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Dock/help needed it in Phase 0                                                                                |
| D8  | No Google Fonts — system font stack (Inter if installed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | CSP `default-src 'self'`                                                                                      |
| D9  | Camera colours pass through unconverted (no colorspace chunk in background shader)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Feed looks identical to the raw camera                                                                        |
| D10 | Camera auto-retries without resolution constraints if 1280×720 is rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Better than failing on odd webcams                                                                            |
| D11 | `chunkSizeWarningLimit: 1000` in Vite; three.js makes the bundle ~770 kB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Code-splitting deferred to Phase 13                                                                           |
| D12 | Render loop runs **only while the camera is streaming or a fixture is playing**; canvases are `visibility:hidden` otherwise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Spec §21.3 "camera stopped: everything paused"                                                                |
| D13 | Playwright builds with `vite build --mode test` so `window.__gs_debug` exists in E2E                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Leak/duplication assertions                                                                                   |
| D14 | Debug counters: `coreCreated/Disposed`, `renderersCreated`, `renderLoopsStarted/Active`, `cameraStreamsStarted/Active`, `trackersCreated`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | E2E proves nothing is duplicated                                                                              |
| D15 | `.claude/launch.json` is committed (dev-server preview config); other `.claude/*` ignored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Shared tooling config                                                                                         |
| D16 | `HANDEDNESS_LABEL_SWAP = false`. MediaPipe docs imply `true` for an un-mirrored feed, but on the user's real webcam (2026-09-24, tasks-vision 1.0.1) `true` showed the right hand as "Left" — MediaPipe Tasks labels already match the physical hand. **Verified empirically; do not flip back.** A "swap hands" setting for odd (pre-mirrored) cameras can be added in Phase 12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | User test beats docs                                                                                          |
| D17 | Fixtures store tracker-native `RawDetection`s (not `HandFrame`s), so replays go through the whole pipeline incl. Phase 3 smoothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Better tests; spec said "HandFrame sequences"                                                                 |
| D18 | `@mediapipe/tasks-vision` is **dynamically imported** by `HandTracker` → separate ~150 kB chunk, fetched when the camera first runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Faster first paint                                                                                            |
| D19 | `CameraStatus` has no `'loading'`; tracker state is separate in the store (`trackerStatus`, `trackerError`, `trackerDelegate`, `handCount`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Camera and tracker fail independently                                                                         |
| D20 | Synthetic fixture generator `scripts/make-synthetic-fixture.mjs` → committed `tests/fixtures/landmarks/synthetic-two-hands.json` (labels follow the verified convention: physical right hand = MediaPipe "Right"); `tests/fixtures` excluded from Prettier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Test + demo the pipeline without a camera (browser pane blocks webcams)                                       |
| D21 | Ambiguous handedness (both hands same label) is resolved by **on-screen position**: the hand displayed on the right is the right hand (uses the mirror setting)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | MediaPipe occasionally mislabels; the view is meant to look like a mirror                                     |
| D22 | Model/WASM paths are `BASE_URL`-relative (`models/…`, `mediapipe/wasm`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Works on sub-path deploys                                                                                     |
| D23 | **Main-user lock** (user chose this over multi-user, 2026-09-24): `numHands: 4`; `HandNormalizer.select()` keeps ONE person's pair — continue tracked hands (≤ `userLock.matchMaxDist`), else the largest hand (closest person), plus a partner of similar palm scale (0.6–1.65×) within 14 palms. Costs a little extra inference time (palm detector runs every frame)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | People in the background must not steal tracking                                                              |
| D24 | One Euro `beta` is per **view-unit/s**: visual 8, trigger 20 (spec's 0.007 assumed pixels). Visual minCutoff comes from the Smoothing slider (`smoothingToMinCutoff`, default 0.65 → ≈1.25 Hz)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Spec values would lag badly in normalized units                                                               |
| D25 | Grab = **farthest** fingertip→palm-centre / palm (< 0.6 start, > 0.75 end); a fist never counts as a pinch (`pinchGestureValue`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Mean-based grab fired on 'point'; fists read as pinches                                                       |
| D26 | Contract extensions: `TrackedHand.triggerLandmarks`, `TwoHandState.cancelFirstHand`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Spec §10 trigger profile; §11 precedence rule 2                                                               |
| D27 | Side stability: a contradicting MediaPipe label must persist 3 inferences (`labelSwitchFrames`); while `GestureEngine.capturing` (pinch/grab/two-hand active) sides follow proximity only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | §8 hands crossing; label flicker                                                                              |
| D28 | Precedence rule 2 → `singleHandPinchAllowed()` + `cancelFirstHand`. Rule 1 (UI consumes gestures) and rules 3–4 (release to capturer, no capture survives a mode switch) are implemented with CaptureManager/ModeController in Phase 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Need those systems first                                                                                      |
| D29 | Synthetic hand generator is TypeScript: `tests/fixtures/syntheticHands.ts` (poses open/fist/point/pinch/thumbPinky + scenarios wave/pinch/tour/two-hand stretch/crowd); `node scripts/make-fixtures.ts` (Node 24 runs TS) regenerates the committed wave JSON. Replaced the old `.mjs` script                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | One generator for tests, demos and the browser pane                                                           |
| D30 | **Lag fix (user compared Phase 2 vs 3 on 2026-09-24: smoother but visibly laggier).** Measured with a jitter/lag simulation + a permanent test (`smoothing latency budget` in `tests/unit/vision.test.ts`). Now: visual beta 40 / dCutoff 2, trigger beta 40 / dCutoff 2, default slider 0.78 (≈0.9 Hz) **+ velocity prediction**: `tick()` extrapolates the smoothed landmarks to render time (≤ 50 ms, velocity low-pass 5 Hz). Real pipeline: jitter 0.70 px (raw 1.41), lag 5.6 ms (raw 8.7, old Phase 3 ≈ 27), fast-wave trailing 11.6 px (old ≈ 27). Cost: ~5 px overshoot on abrupt stops. Debug panel has an Off / Smooth / Smooth + predict switch (`SmoothingMode`, default `predict`)                                                                                                                                                                                                                                                | User feedback; keeps smoothness, removes lag, 60 Hz visual updates                                            |
| D31 | `app/bootstrap.ts` split (was 537 lines): `app/Core.ts` (engine + per-frame pipeline), `app/debug.ts` (counters, `DebugSnapshot`, `buildDebugSnapshot`, `runLeakCheck`), `app/bootstrap.ts` (ref-counted holder + UI actions + re-exports)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ~400-line split rule (D3)                                                                                     |
| D32 | `modes/shared/history.ts` (`CommandHistory`, cap 200, execute/push/undo/redo/onChange) created in Phase 4, not 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `ModeContext.history` needs it; Undo/Redo buttons wired now                                                   |
| D33 | `modes/PlaceholderMode.ts`: each unbuilt experience is a spinning shape you can hover + pinch-drag (tests cursor, captures, lifecycle). Registry `MODE_FACTORIES` uses it until each phase swaps in the real mode; delete the file after Phase 11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Spec §26 'placeholder modes'; gives the user something to test                                                |
| D34 | `SpatialMode` extensions: optional `resetView()`, `onKey(action)`, `drawOverlay(ctx2d)`; `ModeMeta.phase`. `ModeContext.settings` is one live object updated in place                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Keys/Reset/2D drawing need a home                                                                             |
| D35 | `Settings` type in `core/types.ts`; `DEFAULT_SETTINGS` in `config/tuning.ts`; `settings` + `updateSettings` in the zustand store; Core applies mirror / smoothing / inference rate / dominant / skeleton on change. Persistence + panel in Phase 12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Modes and Core need settings before the panel exists                                                          |
| D36 | Depth signal is relative to a baseline captured when the hand appears (`DepthEstimator.resetBaseline()` exists); modes use deltas from pinch start for push/pull. Depth One Euro minCutoff 0.6 / beta 3 (spec's beta assumed other units)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | §13.4 relative use                                                                                            |
| D37 | Precedence rules implemented: rule 1 via `ModeController.setUiCaptured` (help/settings open → no mode updates, captures dropped); rule 3 via `CaptureManager` callbacks; rule 4 via `releaseAll('modeSwitch')`. Lost hand → `release(side, 'lost')`; identity lock also while `capture.count > 0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | §11                                                                                                           |
| D38 | **Hand tracking in a Web Worker** (`workers/visionWorker.ts` + `vision/workerTracker.ts`). User saw 12 FPS; inference blocked the render loop. Main thread: `FrameGate` (new frame + throttle + increasing ts) → `createImageBitmap(video)` → worker (`HandTracker({ moduleWasm: true })`, MediaPipe's ES-module WASM build) → results packed into one `Float32Array` that ping-pongs (no per-frame allocation); max one frame in flight. `WorkerTracker` implements both `TrackerBackend` (status) and `InputSource`. Auto-fallback to the main-thread `HandTracker` + `LiveTrackerSource` if unsupported or the worker errors; `?vision=main` forces it. MediaPipe asset URLs are ABSOLUTE (Vite dev rewrites root-relative dynamic imports to `?import`, which broke the worker). `vite.config` `worker.format: 'es'`. Measured in the pane: worker 60 FPS / worst frame gap 17 ms vs main thread 46 FPS / 34 ms at the same 20 inferences/s | §23 profiling showed main-thread jank                                                                         |
| D39 | **Bug fix:** `LiveTrackerSource` kept only the first 2 of up to 4 hands MediaPipe reported, so the main-user lock (D23) never saw everyone. Hand pools are now sized to `numHands` (`makeHandPool`, `fillDetection`, wire protocol) and a unit test guards it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Fixtures bypassed that path, so tests missed it                                                               |

---

## 7. Remaining phases — scope & acceptance (condensed from spec §26 + mode sections)

Files listed are the planned **lean** files (see AGENTS.md folder map). Pure logic gets Vitest tests
in the same phase.

### Phase 2 — Hand tracker ✅ DONE

Built as planned — see §9 for what exists. User's real-hand test found left/right reversed →
fixed (D16, D21). Pending: user's re-check.

### Phase 3 — Smoothing + gestures (M0) ✅ DONE

Built — see §9. Includes the main-user lock (D23). Original plan kept below for reference.

- `vision/smoothing.ts`: One Euro filter per landmark coord; two profiles (visual stronger, trigger
  lighter — gesture metrics use trigger). Settings slider maps to `minCutoff`.
- Confidence gate (`MIN_HAND_SCORE`), jump rejection (`MAX_JUMP`), grace period
  (`HAND_LOSS_GRACE_MS` ≈150 ms, `lostForMs`), force-release captures after grace.
- `gestures/stateMachine.ts`: idle→candidate→active→released, hysteresis start/end thresholds,
  `CANDIDATE_MS`, release debounce, `justStarted`/`justEnded` true for exactly one frame.
- `gestures/detectors.ts`: pinch (`dist(THUMB_TIP,INDEX_TIP)/palmScale`, start 0.35 / end 0.5),
  point, grab, openPalm, thumbPinky (400 ms cooldown), swipe (off by default). All normalised by
  aspect-corrected `palmScale = dist(WRIST, MIDDLE_MCP)`.
- `gestures/twoHand.ts`: center/distance/angle + scale/rotation/translation vs baseline, angle unwrap.
- `gestures/GestureEngine.ts` + precedence (UI > two-hand > single-hand; cancel first hand's action
  if second joins within `TWO_HAND_JOIN_MS`; releases go to the capturer; no capture survives a mode
  switch). Hand identity locked by wrist proximity during captures.
- `GestureStatus` line in the status bar ("Right: pinch · Left: open"), ≤10 Hz.
- First recorded fixtures + integration tests replaying them.
- **Accept:** stationary hand overlay visibly stable; pinch never flickers; status accurate.

### Phase 4 — Spatial cursor + ModeController ✅ DONE

Built — see §9 and D31–D37. Leak check (10× all modes) verified flat in the browser pane.

### Phase 5 — Voxel Builder (M1: "I can build 3D structures in the air") — spec §13

- `modes/voxel/`: `VoxelMode.ts`, `VoxelGrid.ts` (Map occupancy + commands), `VoxelRenderer.ts`
  (InstancedMesh per material, growable capacity, ghost voxel, build-plane grid), `voxelMath.ts`
  (3D DDA gap fill, face-normal extrusion, layer stepping); `modes/shared/history.ts`
  (CommandHistory cap 200).
- Depth system: active Z layer + faint grid + `Depth: -3 … +3` indicator; face extrusion
  (hit voxel + face normal); push/pull extrusion (relative depth, one undo step); explicit layer
  control (+Z/−Z buttons, E/Q keys, non-dominant pinch + vertical travel per `LAYER_STEP_DISTANCE`);
  **Depth Lock ON by default** (L toggles).
- Tools Build/Erase/Paint (X), 8-colour palette (default `#21d4d8`), solid/glass/emissive,
  continuous paint with DDA, axis lock on face strokes, Clear, Undo/Redo (Ctrl+Z / Ctrl+Shift+Z),
  two-hand pinch transforms `voxelRoot`, Reset view.
- **Accept (§13.9):** stationary pinch = exactly one voxel; no gaps at normal speed; grid exact
  after 1000+ placements; Depth Lock prevents Z drift; all 6 face normals unit-tested; push/pull =
  one undo; 5,000 voxels ≥ 45 FPS.

### Phase 6 — Two-hand transform core — spec §12

- `modes/shared/TwoHandTransform.ts`: baseline snapshot on `twoHand.justStarted` (no jump on
  engage), position/scale/rotationZ relative to baseline, clamp per-frame deltas, freeze then release
  on hand loss, optional non-uniform width, emits one TransformObjectCommand on release. Apply to
  voxelRoot. **Accept:** no jump, safe release, crossing hands OK.

### Phase 7 — Spatial Panel + Texture Surface — spec §14, §17

- `modes/shared/TextureSurface.ts` (subdivided plane + pluggable ShaderMaterial + TextureSources:
  image, snapshot, liveCameraFull, procedural; later liveCameraLens, renderTarget; rounded alpha
  mask, glowing handles), `modes/panel/PanelMode.ts`, content switcher, Reset. Sample images in
  `public/textures/`.

### Phase 8 — Air Draw — spec §15

- `modes/draw/DrawMode.ts` + `strokes.ts` (strokes stored view-normalised, `MIN_STROKE_STEP`,
  One Euro, Catmull-Rom render on the 2D overlay, 8 neon colours, 3 widths, glow toggle,
  stroke-level eraser, undo/redo, clear). **Accept:** smooth strokes, stay aligned on resize.

### Phase 9 — Hand Strings — spec §16

- `modes/strings/StringsMode.ts` + `springs.ts` (THREE.Points glow sprites on 21 landmarks/hand,
  LineSegments anatomical + fingertip web + left↔right links, spring-damper midpoints, trails ring
  buffer, velocity-driven brightness, hue drift; styles skeleton/web/full mesh). Typed arrays
  updated in place. **Accept:** ≥55 FPS, zero per-frame allocations.

### Phase 10 — Filter Lab + Portal (M3) — spec §18, §19

- `modes/filter/FilterLabMode.ts` + `filters.ts`: lens shader samples the camera **behind** the
  strip via `coverUv(screenUv())` from `modes/shared/glsl.ts` (already written in Phase 1). 13
  presets: none, thermal, sketch, pixelate, glitch, redChannel, edge, blur, cartoon, rainbow +
  invert, rgbSplit, popArt. Switch via thumb-pinky (dominant = next, other = prev), ←/→ and [/],
  UI buttons; toast with preset name; sources live lens / snapshot / image.
- `modes/portal/PortalMode.ts` + `portalContent.ts`: ≥3 presets (Nebula fbm shader, Other World
  render-target scene with parallax, Inverted Reality lens, bundled image), animated rim, alpha
  mask, opening animation, Reset. **Accept:** lens perfectly aligned with background while moving.

### Phase 11 — 3D Object Lab (completes M2) — spec §20

- `modes/objectLab/ObjectLabMode.ts` + `objects.ts`: cube/sphere/cylinder/plane/torus,
  solid/emissive/transparent, spawn (toolbar or open-palm hold radial menu), point+pinch select,
  multi-select, one-hand move on camera-facing plane, depth via push/pull or Q/E, two-hand
  rotate/scale, duplicate (D), delete (Delete), group/ungroup, all undoable.

### Phase 12 — Product polish — spec §21, §22

- `ui/overlays.tsx` (Onboarding 5 steps, HelpOverlay per mode, SettingsPanel: dominant hand,
  mirror, smoothing, pinch sensitivity, rotation/scale sensitivity, inference rate, quality preset,
  camera resolution/device, skeleton, Depth Lock default, reset), full DebugPanel,
  `ui/toolPanels.tsx`, `state/persistence.ts` (versioned settings in localStorage; scenes in
  IndexedDB with 1 s debounced autosave + Save/Load/Export/Import JSON), full keyboard map
  (`config/keybindings.ts` already resolves every key), accessibility pass.

### Phase 13 — Performance + QA (M4) — spec §23, §25, §27, §28

- Profiling, leak check (switch all modes 10× → `renderer.info.memory` baseline), 5k-voxel test,
  E2E suite complete, manual matrix in `docs/PERFORMANCE.md`, write all docs (`docs/ARCHITECTURE.md`,
  `GESTURES.md`, `MODES.md`, `PERFORMANCE.md`, `TROUBLESHOOTING.md`), code-splitting, Vercel deploy +
  CI deploy step, release tags `v0.1-m0` … `v1.0-m4`.

### 7c. Handedness robustness — agreed plan, pending the user's recordings (do before Phase 5)

**Trigger (2026-09-24):** screenshot — the user's friend's RIGHT hand was labelled "Left 97%" while
pinching the placeholder cube. Position is NOT the cause (we never use it except as a tie-break).
Likely causes: (A) a wrong first MediaPipe label frozen by the identity lock (D27) because he was
pinching — a real flaw; or (B) our label convention (D16) is wrong. The on-screen % is MediaPipe's
own score, so it can't tell A from B; the Debug panel's `MediaPipe “…”` raw label can.

Plan (user agreed; "full-proof" = layered + measurable):

- **Layer 0 — real recordings** as permanent regression tests + a before/after accuracy score
  (% frames correct, number of wrong answers that stuck > 1 s).
- **Layer 1 — evidence voting per tracked hand:** MediaPipe label weighted by its score +
  **3D chirality** from `worldLandmarks` (the user's idea: thumb direction — generalised to
  thumb side × finger direction × palm-facing side, which is rotation-invariant; weak when the hand
  is flat, so confidence-weighted). Leaky log-odds per track; quick first decision (~150 ms), stable
  after.
- **Layer 2 — fix the lock trap:** the identity lock only prevents two hands swapping with EACH
  OTHER; a single hand can always be corrected. A relabel = swap identities: move gesture machines,
  captures (`CaptureManager` keys), depth estimators and smoothing state with the hand, so a held
  object is not dropped.
- **Layer 3 (Phase 12):** onboarding "raise your RIGHT hand" auto-calibrates the label convention
  per camera + Settings "Swap left/right hands".
- **Layer 4 — body/shoulder vote (the user's idea):** MediaPipe Pose Landmarker (same npm package,
  new ~5 MB model): a hand whose wrist is at the end of the RIGHT shoulder→elbow→wrist chain is
  the right hand; strongest vote when arms are visible; also makes the main-user lock "hands attached
  to this person". Run at 5–10 Hz in the vision worker (needs D38 first — done). Needs one more
  recording with pose data once added.

## 7b. Parked ideas (not now — may come back later)

### Multi-user mode (two or more people controlling GestureSpace together)

**Raised by the user on 2026-09-24** after testing with a friend: with four hands in view, only one
pair was tracked. We chose the **main-user lock** (D23) for V1 and parked multi-user as a V2 idea.

- **What it would be:** several people in front of one webcam, each with their own pair of hands,
  e.g. two people building one voxel structure, one holding the Filter Lab lens while another
  switches filters, or a "pass the portal" game.
- **Why parked:** the whole contract assumes ONE user (`HandFrame` has exactly `left`/`right`;
  `TwoHandState` assumes both hands belong to the same person; `CaptureManager` owns captures per
  hand side). Tracking 4 hands also costs inference time on every frame, and MediaPipe's palm
  detector gets less reliable with small/far hands.
- **Design sketch if we come back to it:**
  1. `HandNormalizer` → `PeopleTracker`: cluster detections into people (pair hands by palm scale +
     proximity — the D23 partner logic already does this for one person), give each person a stable
     `personId` with continuity across frames.
  2. Contracts: `HandFrame.people: Person[]` where `Person = { id, left?, right?, color }`; keep
     `left`/`right` as the "primary person" for backwards compatibility with single-user modes.
  3. `GestureEngine` runs per person; `TwoHandState` per person (optionally a cross-person
     two-hand state for "two people stretch one panel").
  4. `CaptureManager` keys captures by `(personId, side)`; conflict rule: first captor wins.
  5. UI: per-person colours for skeletons/cursors, a "players" indicator, a Settings toggle
     "Multi-user (experimental)" that raises `numHands` to 4+ only when enabled.
  6. Perf: measure inference ms at 4 hands on the target laptop before committing (Phase 13 matrix).
- **Where to start:** `src/vision/handPipeline.ts` (`select()` already scores candidates and
  pairs a partner), `src/core/types.ts` (`HandFrame`), `src/gestures/GestureEngine.ts`.

---

## 8. Environment & tooling notes

- **OS:** Windows 11; shells: PowerShell + Git Bash. Node 24 (`.nvmrc`), npm 11.
- **Scripts:** `dev` (Vite, port 5173) · `build` (`tsc --noEmit && vite build`) · `preview` (4173) ·
  `lint` · `format` · `typecheck` · `test` · `test:watch` · `e2e` · `fetch-model`.
- **Assets:** `public/models/hand_landmarker.task` (7.8 MB float16) is **committed**;
  `npm run fetch-model` refreshes it. `public/mediapipe/wasm/` is generated at postinstall and
  git-ignored.
- **E2E:** Playwright needs `npx playwright install chromium` first (not yet installed — ask the
  user before downloading). Uses fake camera flags.
- **Claude desktop browser pane blocks real webcams.** To exercise the video pipeline there,
  override `navigator.mediaDevices.getUserMedia` in the page with a `canvas.captureStream()` test
  pattern, and **reload the tab afterwards** (the user once saw the red/blue test pattern and was
  confused). Real-camera checks must be done by the user in their own Chrome/Edge at
  `http://localhost:5173`. The pane also throttles rAF (~1.5 fps) when not focused — low FPS there
  is not an app bug.
- `.claude/launch.json` defines the `dev` preview server.
- CSP (vercel.json): `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'
blob:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'` — no external
  fonts/CDNs.
- `.gitignore` excludes node_modules, dist, public/mediapipe/wasm, test output, .env, editor/OS
  junk, Office `~$*` lock files, `.claude/*` except `launch.json`.

---

## 9. Key implementation facts (things already built — reuse, don't rewrite)

- `src/app/Core.ts` — `Core` = the engine: camera, viewport, tracker, normalizer, gestureEngine,
  depth (per side), capture, coords, cursors (RaycastCursor), CursorMarkers, ModeController
  (`core.modes`), live `settings`, the reused `InteractionFrame`, and the per-frame pipeline
  `frame(now, dt)`: poll → process/tick → gestures → depth (→ `g.depthSignal`) → cursors → lost-hand
  capture release → identity lock → `modes.update` → `renderFrame` (mode passes, markers, WebGL,
  overlay skeleton + indicators + `modes.drawOverlay`) → FPS → status. Subscribes to the store
  (activeMode → switch, settings → apply, help/settings open → UI capture). Public actions: `undo`,
  `redo`, `clearMode`, `resetView`, `handleKey`, `playFixture`, `stopPlayback`, `setSmoothingMode`.
- `src/app/bootstrap.ts` — `createRefCounted()` holder (StrictMode-safe), `acquireCore/releaseCore/
getCore`, UI actions (`startCamera`, `stopCamera`, `retryTracker`, `undo`, `redo`, `clearMode`,
  `resetView`, `handleKeyAction`, `debugSnapshot`, `leakCheck`, `reportCoreFailure`). The `Stage`
  component in `ui/AppShell.tsx` acquires the core and calls `core.mount(el)`.
- `src/app/debug.ts` — `counters` (+ `modeSwitches`), `DebugSnapshot`, `buildDebugSnapshot(core)`,
  `runLeakCheck(core, cycles)`.
- `src/spatial/CoordinateMapper.ts` — `CoordinateMapper` (view↔screen↔NDC, `worldToScreen`,
  `rayThrough`, `ndcToPlane`), `InteractionPlane` (`setZ`, `setThrough` camera-facing),
  `RaycastCursor` (`addTarget/removeTarget/clearTargets`; targets carry `userData.gsId` and optional
  `gsKind: 'voxel'`; hit = first visible target else the plane; world face normal).
- `src/spatial/DepthEstimator.ts` — `StepQuantizer` (dead zone + hysteresis + dwell), `DepthEstimator`
  (`signal`, `steps`, `resetBaseline`). `src/spatial/CaptureManager.ts` — keys `left|right|twoHand`,
  `capture/get/isCaptured/release/releaseTarget/releaseAll/describe`, reasons released | lost |
  modeSwitch | ui | cancelled.
- `src/modes/types.ts` (`ModeContext`, `SpatialMode`, `ModeFactory`), `src/modes/ModeController.ts`
  (`switchTo`, `update`, `render`, `drawOverlay`, `setUiCaptured`, `undo/redo/clear/resetView/
handleKey`, `onHistoryChange`, `dispose`), `src/modes/registry.ts` (`MODE_META` incl. `phase`,
  `MODE_FACTORIES`), `src/modes/PlaceholderMode.ts`, `src/modes/shared/history.ts`.
- `src/scene/materials.ts` — `addDefaultLighting` (used by SceneManager), `CursorMarker`,
  `setHighlight` (emissive glow).
- `src/core/camera.ts` — `CameraManager` (state machine idle/requesting/running/stopped/error,
  `classifyCameraError`, `checkCameraSupport`, superseded-request guard, track `ended` handling).
- `src/spatial/ViewportMapper.ts` — cover-crop + mirror. `viewToScreen`, `screenToView`,
  `trackerToViewX`, `videoAspect`, `coverScale/coverOffset` uniforms, `version` bumps on change.
  **All overlays and lens shaders must use it.**
- `src/modes/shared/glsl.ts` — `COVER_UV_GLSL` (`screenUv()`, `coverUv()`), `FULLSCREEN_VERT`,
  `createCoverUniforms`, `syncCoverUniforms`. Filter Lab/Portal lens shaders reuse these.
- `src/scene/SceneManager.ts` — one WebGLRenderer (DPR capped at 2), PerspectiveCamera (fov 50,
  z=20), `drawingBuffer` size, `disposeObject3D()` helper.
- `src/core/renderLoop.ts` — idempotent `RenderLoop` (dt clamped to 0.1 s), `FpsMeter`,
  `InferenceStats` (inference Hz, EMA ms, skipped camera frames).
- `src/vision/HandTracker.ts` — the one `HandLandmarker`; `load()` idempotent (retry after error),
  GPU then CPU, `detect(image, ts)`, status listeners, `TrackerBackend` interface (`thread`,
  status, delegate, error, loadMs, ready, onChange, load, dispose), option `moduleWasm` (worker).
  Asset URLs are absolute (D38). Core calls `load()` when the camera first runs.
- `src/vision/workerTracker.ts` — wire protocol (`packResult`, `unpackDetection`, `WIRE_LENGTH`,
  `ToWorker`/`FromWorker`), `visionWorkerSupported()`, `WorkerTracker` (TrackerBackend +
  InputSource; one frame in flight; generation counter drops stale results on `reset()`).
  `src/workers/visionWorker.ts` — the worker entry. Core: `makeTracker(useWorker)`,
  `fallBackToMainThread()`, `core.tracker` getter; `counters.visionWorkers`.
- `src/core/input.ts` also has `FrameGate` (shared new-frame/throttle/timestamp logic, fakeable via
  `GateVideo`), `fillDetection`, `makeHandPool(numHands)`, `makeDetection`; `InputSource.reset?()`.
- `src/core/input.ts` — `RawDetection`/`RawHand` (serializable), `InputSource`,
  `LiveTrackerSource` (rVFC new-frame detection, throttle with `throttleSlack`, strictly increasing
  timestamps, reused buffers), `FixturePlaybackSource` (real-time, loops, jumps to newest),
  `FixtureRecorder` (deep copy, relative ts), `parseFixture` (validates untrusted JSON),
  `downloadFixture`.
- `src/vision/landmarks.ts` — `WRIST … PINKY_TIP`, `FINGERTIPS`, `HAND_CONNECTIONS`, `palmScale`
  (aspect-corrected), `boundsInto`, `makeLandmarkBuffer`.
- `src/vision/handPipeline.ts` — `HandNormalizer.process(det, mirror, now)` (per inference) and
  `tick(now)` (every frame, grace period) → reused `HandFrame`. Steps: confidence gate → main-user
  lock `select()` → `assignSides()` (labels + hysteresis, identity lock) → `updateSlot()` (jump
  rejection, smoothing, palmScale/bbox). `HandSlot` implements `TrackedHand` + pipeline state.
  `setIdentityLock()`, `setSmoothing(slider)`, debug counts `detectedCount/gatedCount/usedCount`.
- `src/vision/smoothing.ts` — `OneEuroFilter`, `LandmarkSmoother` (visual + trigger profiles,
  per-coordinate velocity, `predictVisual(out, aheadMs)`), `smoothingToMinCutoff(slider)`,
  `SmoothingMode` ('off' | 'smooth' | 'predict'). `HandNormalizer.setSmoothingMode()`,
  `HandSlot.sampledAt`; prediction runs in `HandNormalizer.tick()` every render frame (frozen at
  the filtered value during the loss grace period). `Core.setSmoothingMode()` for the debug switch.
- `src/gestures/stateMachine.ts` — `GestureStateMachine` (hysteresis, candidateMs, releaseMs,
  cooldown, `forceRelease`), `makeGestureState`.
- `src/gestures/detectors.ts` — pure metrics: `pinchValue`, `pinchGestureValue` (fist-exclusive),
  `grabValue` (max tip distance), `pointValue`, `openPalmValue`, `thumbPinkyValue`,
  `fingerExtended`, `thumbExtended`, `extendedMask`, `lmDist`.
- `src/gestures/twoHand.ts` — `TwoHandTracker` (baseline on start, unwrapped rotation,
  `cancelFirstHand`), `pinchPointInto` (thumb/index midpoint).
- `src/gestures/GestureEngine.ts` — `GestureEngine.update(hands, aspect, now)` every render frame;
  `capturing` (drives identity lock); `bothHandsVisible`; helpers `singleHandPinchAllowed`,
  `describeHand` (status text). Forced release is delivered for one frame when a hand is removed.
- `src/scene/overlay.ts` also has `drawGestureIndicators` (pinch ring: dashed = candidate, filled =
  active; two-hand line dashed when both visible, solid + centre dot + "×scale ±deg" when active).
- `src/scene/overlay.ts` — `OverlayCanvas2D` (DPR-scaled, draw in CSS px) + `drawHandSkeleton`.
- `Core` (bootstrap) per-frame order: `syncViewport` → `input.poll` → `recorder.record` (live only)
  → `normalizer.process` (or `tick`) → `gestureEngine.update` → `normalizer.setIdentityLock(
gestureEngine.capturing)` → `renderFrame` (WebGL, overlay skeletons + gesture indicators) → FPS →
  `pushStatus` (≤10 Hz, only on change). `core.gestures` = latest `GestureFrame`. Also `playFixture/stopPlayback`, `debugSnapshot()`,
  `retryTracker()`. `core.hands` = latest `HandFrame`.
- `src/ui/DebugPanel.tsx` polls `core.debugSnapshot()` every 250 ms while open; `TrackerNotice`
  lives in `ui/PermissionScreen.tsx`.
- In the browser pane you can drive the app from JS: find the app's module URL with
  `performance.getEntriesByType('resource')` (it may carry `?t=` after HMR — importing the plain
  URL creates a second module instance), then `getCore().playFixture(parseFixture(json))` with
  `/tests/fixtures/landmarks/synthetic-two-hands.json` (Vite serves it in dev), or import the
  generator directly: `await import('/tests/fixtures/syntheticHands.ts')` →
  `getCore().playFixture(synth.gestureTourScenario())` (also `pinchScenario`,
  `twoHandStretchScenario`, `crowdScenario`, `waveScenario`).
- `src/state/appStore.ts` — zustand UI state only: activeMode, cameraStatus (`CameraState |
'loading'`), cameraError, statusText, fps, panel toggles, canUndo/canRedo.
- `src/config/keybindings.ts` — `resolveKeyAction()` maps every §21.7 shortcut; `App.tsx` handles
  mode/help/debug/escape so far — later phases handle the rest.
- `src/config/tuning.ts` — every threshold/timing already has a starting value for all phases.

---

## 10. Session log

- **2026-09-23 — Session 1.** Read both spec files. Phase 0 built (tooling, shell, types, tuning,
  keybindings, registry, bootstrap). User asked for fewer files → deleted ~100 placeholders,
  consolidated modules, adopted lean folder map (D3–D5). Extended `.gitignore`. Phase 1 built and
  verified in the browser pane with a synthetic camera (mirror, cover-crop landscape + portrait,
  DPR, stop/start with no duplicate streams/loops, denied path). Repo created on GitHub under
  `shreyas-gowda02`; fixed a 403 caused by the cached apphelix credential by pinning the username in
  the remote URL; all commits pushed. **Next:** user to confirm real-webcam Phase 1 check, then
  Phase 2.
- **2026-09-23 — Session 1 (cont.).** CLAUDE.md turned into this full handoff doc (`6e88c4d`,
  pushed). Phase 2 built: HandTracker, input sources + fixtures, HandNormalizer, skeleton overlay,
  Debug panel, tracker notices. Verified in the browser pane: synthetic fixture plays with correct
  sides/colours and status text; MediaPipe loads on GPU in ~0.8 s and runs inference on a fake
  camera stream; `trackersCreated` = 1. Found/fixed an off-by-one in inference-rate stats.
  **Next:** user's real-hand checks (Phase 1 + 2), then Phase 3.
- **2026-09-24 — Session 1 (cont.).** User tested Phase 2 on their webcam: left/right labels were
  reversed. Set `HANDEDNESS_LABEL_SWAP = false` (D16), changed the tie-break to on-screen position
  (D21), regenerated the synthetic fixture with real-webcam label convention, tests now use the
  real TUNING value. **Next:** user re-checks handedness + reports inference Hz/ms, then Phase 3.
- **2026-09-24 — Session 1 (cont.).** User tested with a friend: 4 hands in view → only one pair
  tracked. User chose the **main-user lock** (D23) and asked to park multi-user (§7b). Phase 3
  built: smoothing, gate, jump rejection, grace, main-user lock, side stability, gesture machines,
  detectors, two-hand, engine, overlay indicators, status, debug panel. Found + fixed during tests:
  spec One Euro beta in pixel units (D24), grab mean fired on "point" and fists read as pinches
  (D25), partner distance too tight for spread arms (14 palms). Verified in the browser pane via
  synthetic scenarios (tour order, two-hand ✓, crowd 4 detected / 2 used). **Next:** user's
  real-hand gesture check, then Phase 4.
- **2026-09-24 — Session 1 (cont.).** User asked to compare with the pre-smoothing version: made a
  temporary git worktree of Phase 2 on port 5174 (since deleted). Verdict: smoother but laggier.
  Simulated jitter vs lag for several filter settings, picked faster motion detection + render-time
  velocity prediction (D30); added a permanent latency-budget test and a Debug-panel smoothing
  switch for live A/B. Note: the browser pane is often **hidden** (rAF = 0) — drive frames manually
  with `core['frame'](now)` there. **Next:** user re-tests feel (Debug panel → Smoothing switch),
  then Phase 4.
- **2026-09-24 — Session 1 (cont.).** User pushed everything; asked why no commit-message prompt
  (answer: Claude commits, `git push` only uploads) — user wants Claude to **keep committing**.
  Phase 4 built: split Core/debug/bootstrap (D31), CoordinateMapper + InteractionPlane +
  RaycastCursor, DepthEstimator + StepQuantizer, CaptureManager, CommandHistory, ModeController,
  PlaceholderMode for all 7 experiences, cursor markers + lighting, store settings, wired status-bar
  buttons + keys, Debug panel additions + leak check. Verified in the browser pane by stepping
  `core['frame']`: leak check 10× flat (14 geo / 1 tex), scripted pinch-drag captures + moves +
  releases the shape, mode switch mid-drag releases cleanly. The dev server had stopped — restart
  with `preview_start` name `dev`. **Next:** user's Phase 4 hand check, then Phase 5 (Voxel).
- **2026-09-24 — Session 1 (cont.).** User's screenshot: friend's right hand shown as "Left 97%"
  while pinching. Discussed causes and a layered fix (§7c) incl. the user's two ideas (thumb
  direction → 3D chirality; shoulders → pose vote). Needs real recordings first (user hasn't made
  them yet — step-by-step instructions given: Debug panel → Record, rename to right-only /
  left-only / both-crossing, put in `tests/fixtures/landmarks/real/`). Built the vision Web Worker
  (D38) since the screenshot showed 12 FPS; found + fixed the 2-of-4 hands bug (D39). Browser-pane
  A/B: worker 60 FPS / 17 ms worst gap vs main 46 FPS / 34 ms. Dev-server gotcha fixed: absolute
  MediaPipe URLs. **Next:** user's recordings + worker FPS check → §7c Layers 1–2 → Phase 5.
