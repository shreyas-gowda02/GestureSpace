// ALL tunable numbers + feature flags live here (§2 rule 10). Never inline thresholds/timings elsewhere.
// Final tuned values are documented in docs/GESTURES.md.

import type { Settings } from '@/core/types';

export const TUNING = {
  camera: {
    idealWidth: 1280,
    idealHeight: 720,
    facingMode: 'user',
  },

  tracker: {
    /** Relative to Vite's BASE_URL so sub-path deployments keep working. */
    modelAssetPath: 'models/hand_landmarker.task',
    wasmBasePath: 'mediapipe/wasm',
    /**
     * Hands MediaPipe looks for. 2, not 4 (D41): MediaPipe skips its palm detector only once it
     * tracks `numHands` hands, so 4 re-ran it on every frame (10.1 vs 13.2 hand updates/s with two
     * hands on the user's laptop) and produced phantom duplicate hands. The main-user lock
     * (handPipeline) still vets the ≤ 2 hands it gets. Trade-off: while one of the user's hands is
     * out of view, a background hand can take the free slot until it leaves.
     */
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    /** Default inference rate in Hz (setting: 15 / 30 / 60). */
    defaultInferenceHz: 30,
    /**
     * Accept the next inference once this fraction of the interval has passed, so camera-frame
     * jitter doesn't halve the effective rate (e.g. 30 Hz camera + 30 Hz target).
     */
    throttleSlack: 0.8,
    /**
     * Whether to swap MediaPipe's "Left"/"Right" labels to get the user's PHYSICAL hand.
     * MediaPipe's docs say labels assume a mirrored (selfie) input, which would imply `true` for
     * our un-mirrored feed — but on a real webcam (2026-09-24, tasks-vision 1.0.1) the labels
     * already match the physical hand, so this is `false`.
     * Verify: raise your physical RIGHT hand — the overlay must say "Right".
     */
    HANDEDNESS_LABEL_SWAP: false,
  },

  overlay: {
    showSkeleton: true,
    lineWidth: 2.5,
    jointRadius: 3,
    tipRadius: 5,
    colors: { right: '#21d4d8', left: '#ff3dcb' },
  },

  perf: {
    /** EMA weight for average inference time. */
    inferenceMsEma: 0.1,
    inferenceFpsWindowMs: 1000,
    debugPanelPollMs: 250,
  },

  smoothing: {
    // One Euro filter. Units: coordinates are view-normalized (0..1), so `beta` is per
    // view-unit/s. (The spec's beta ≈ 0.007 assumed pixels: 0.007 × ~1280 px ≈ 9 per unit.)
    // Tuned 2026-09-24 with a jitter/lag simulation after the user saw lag (see CLAUDE.md D30):
    // higher beta + dCutoff detect motion ~2× sooner; prediction removes the rest of the lag.
    /** Visual profile: stronger, for overlays/objects. minCutoff comes from the Smoothing slider. */
    visual: { beta: 40, dCutoff: 2.0 },
    /** Trigger profile: lighter / lower lag, for gesture distances (never predicted). */
    trigger: { minCutoff: 2.5, beta: 40, dCutoff: 2.0 },
    /** Smoothing slider 0..1 → visual minCutoff (Hz): 0 = responsive (max), 1 = smooth (min). */
    sliderMinCutoffRange: { min: 0.3, max: 3.0 },
    /** 0.78 → ≈0.9 Hz. */
    defaultSlider: 0.78,
    /**
     * Visual prediction: between inferences (30 Hz) each render frame (60 Hz) extrapolates the
     * smoothed landmarks along their velocity to "now". Costs a brief ~5 px overshoot on sudden stops.
     */
    predict: {
      /** Low-pass (Hz) on the velocity used for prediction; higher = reacts faster, noisier. */
      velocityCutoff: 5,
      /** Never extrapolate further than this past the last inference (e.g. tracker stalls). */
      maxAheadMs: 50,
    },
  },

  confidence: {
    /** Handedness/detection score below which a detection is ignored. */
    MIN_HAND_SCORE: 0.6,
    /** Max wrist travel (aspect-corrected view units) per inference before the sample is rejected. */
    MAX_JUMP: 0.25,
    /** A jump seen this many inferences in a row is accepted as real (filters reset). */
    JUMP_ACCEPT_AFTER: 2,
    HAND_LOSS_GRACE_MS: 150,
  },

  /** Main-user lock: pick ONE person's two hands when several people are in view. */
  userLock: {
    /** Max wrist distance (aspect-corrected view units) to continue an already-tracked hand. */
    matchMaxDist: 0.3,
    /** A second hand joins the main user only if its palm scale is within this ratio of theirs… */
    partnerScaleRatio: { min: 0.6, max: 1.65 },
    /**
     * …and its wrist is within this many of the main user's palm lengths (arms spread wide for a
     * two-hand stretch can reach ~12). Background people are mostly rejected by the scale ratio.
     */
    partnerMaxDistPalms: 14,
  },

  /**
   * Which physical hand is which (D42). Each tracked hand collects two votes per inference —
   * MediaPipe's label and the 3D "thumb check" (chirality of the hand's own axes) — each weighted
   * by how trustworthy it is. Calibrated on the user's recordings (tests/fixtures/landmarks/real).
   */
  handedness: {
    /**
     * Box overlap (IoU) above which the less confident of two detections is a phantom duplicate.
     * Measured: phantoms ≥ 0.17 (median 0.47); the user's real hands, even crossed, ≤ 0.14.
     */
    phantomOverlap: 0.15,
    /** MediaPipe score → vote weight 0..1: 0.55 or less is a coin flip (60% right), 0.85+ is 99%. */
    labelScore: { min: 0.55, full: 0.85 },
    /** |chirality| → vote weight 0..1: < 0.02 is flat/edge-on (54% right), 0.12+ is ≥ 99.5%. */
    chirality: { min: 0.02, full: 0.12 },
    /** Per inference, old evidence keeps this share, so a track can recover from a bad start. */
    decay: 0.8,
    /** Each vote's running total is clamped to ±cap, so no history is ever unbeatable. */
    cap: 3,
    /** Evidence (per hand, both votes summed) needed to rename a tracked hand. */
    switchMargin: 1.5,
    /**
     * While a gesture holds something (identity lock) a rename needs more evidence AND the 3D vote
     * must agree on its own — labels alone are unreliable exactly then (crossed hands).
     */
    lockedSwitchMargin: 3,
    locked3dMargin: 1.5,
    /**
     * Hands crossing close together: with BOTH hands tracked, a detection whose own votes (≥ this
     * much, of ±2) contradict a track's settled side costs this much extra distance to continue it
     * (aspect-corrected view units; continuity radius is userLock.matchMaxDist = 0.3).
     */
    contradictVote: 1,
    contradictPenalty: 0.2,
    /**
     * A hand that just came into view is shown once its evidence reaches this (a hand entering
     * edge-on can give weak, wrong votes for a few frames)… In the user's recordings 14 of 17
     * arrivals were clear on the first frame; the rest took 83–300 ms.
     */
    commitVote: 1,
    /** …or after this long at the latest, with the best guess (0 = show new hands immediately). */
    maxNamingWaitMs: 250,
  },

  gestures: {
    CANDIDATE_MS: 60,
    RELEASE_DEBOUNCE_MS: 80,
    HOLD_MS: 600,
    pinch: { start: 0.35, end: 0.5 },
    /** Tip must be this much farther from the wrist than the PIP to count as extended. */
    fingerExtendedRatio: 1.15,
    /** Thumb tip vs thumb MCP distance to the pinky MCP, for "thumb extended". */
    thumbExtendedRatio: 1.1,
    /**
     * Farthest fingertip→palm-centre distance / palmScale. Open hand ≈ 1.1, fist ≈ 0.2–0.4
     * (the spec's 0.9/1.1 guess sat right on an open hand).
     */
    grab: { start: 0.6, end: 0.75 },
    thumbPinky: { start: 0.35, end: 0.5, cooldownMs: 400 },
    /** minVelocity in aspect-corrected view units / second. */
    swipe: { enabled: false, minVelocity: 2.0, windowMs: 120, cooldownMs: 500 },
    TWO_HAND_JOIN_MS: 150,
  },

  /** Two-hand transform (§12, `modes/shared/TwoHandTransform.ts`). Distances in view heights. */
  twoHand: {
    /** Limits on one grab's size change (× the size at the grab). */
    minScale: 0.2,
    maxScale: 5.0,
    ROTATION_SENSITIVITY: 1.0,
    /**
     * Hands closer than this don't scale: a few px of tracking noise between nearly touching hands
     * is a big ratio (the user's crossing recording: a grab begun 0.05 apart read 10.6×).
     */
    minSpan: 0.15,
    /**
     * Turning fades out as the hands come together (their angle is noise): none → full. Hands that
     * pass each other flip the hand line 180°; this keeps the object to ~11° (0.02 apart vertically).
     */
    turnFade: { none: 0.08, full: 0.25 },
    /**
     * Safety limits, per second (modes run every display frame, 60–144 Hz): how fast the object may
     * follow the hands, so a one-frame tracking glitch is a small blip. Kept above the fastest real
     * grab in the user's crossing recording (move 2.9 view heights/s, size 13 ln/s, turn 10 rad/s).
     */
    maxMoveRate: 5,
    /** ln(scale) per second. */
    maxScaleRate: 15,
    /** Radians per second. */
    maxTurnRate: 12,
  },

  /**
   * Fist + drag turns an object in 3D (`FistOrbit`): left / right spins it round (about the
   * screen's up axis), up / down tips it (about the screen's across axis), like dragging with a
   * mouse in a 3D viewer. Sweeping the fist across the whole picture (1.78 view heights) ≈ one turn.
   */
  orbit: {
    /** Radians of turn per view height of fist travel. */
    radPerViewHeight: 3.5,
    /**
     * A fist starts turning only once held this long AND moved `deadZone` view heights (~22 px at
     * 720p) from where it closed. The user's recordings: accidental fists (mid-motion) lasted
     * 133–250 ms and moved 0.015–0.045; deliberate ones 0.75–2.4 s, moving 0.05–0.22.
     */
    holdMs: 150,
    deadZone: 0.03,
    /** Safety limit, radians per second (a fast real fist drag ≈ 10). */
    maxTurnRate: 12,
  },

  depth: {
    W_PALM: 0.6,
    W_MPZ: 0.4,
    MPZ_GAIN: 4.0,
    DEPTH_STEP: 0.12,
    DEPTH_HYSTERESIS: 0.03,
    DEPTH_DWELL_MS: 120,
    DEAD_ZONE: 0.04,
    /** Stronger than cursor smoothing. beta is per signal-unit/s (signal ≈ 0..1). */
    oneEuro: { minCutoff: 0.6, beta: 3, dCutoff: 1.0 },
  },

  cursor: {
    /** Scene z of the default interaction plane (camera looks down −Z from z = scene.cameraZ). */
    planeZ: 0,
    /** Cursor ring radius in world units (≈13 px at 720p with the default camera). */
    ringRadius: 0.34,
    ringWidth: 0.09,
    dotRadius: 0.08,
    /** Ring scale while pinching (feels like "grabbing"). */
    pinchScale: 0.65,
    hoverColor: '#ffffff',
    /**
     * Steady aim (D43). Closing a pinch slides the index tip toward the thumb, so once the pinch
     * value drops below `freezeBelow` the aim moves rigidly with the hand (index knuckle) instead,
     * returning to the fingertip over `blendMs` once it rises above `releaseAbove`. On the user's
     * 104 real pinches, aim movement over the 250 ms before a pinch: fingertip 1.5 voxels median /
     * 5.3 p95 → steady aim 0.4 / 3.1; drift while held: 0.5 / 4.0 → 0.3 / 2.5.
     */
    aim: { freezeBelow: 0.75, releaseAbove: 0.9, blendMs: 150 },
  },

  voxel: {
    defaultColor: '#21d4d8',
    /** 8-colour palette (§13.1); the first is the default. */
    palette: [
      { name: 'Turquoise', hex: '#21d4d8' },
      { name: 'Magenta', hex: '#ff3dcb' },
      { name: 'Lime', hex: '#a6ff3d' },
      { name: 'Amber', hex: '#ffb62e' },
      { name: 'Coral', hex: '#ff5470' },
      { name: 'Violet', hex: '#b36bff' },
      { name: 'Blue', hex: '#4c7dff' },
      { name: 'White', hex: '#f2f5fa' },
    ],
    voxelSize: 1,
    /** Cells per axis; layers and coordinates run from −worldBounds/2 to worldBounds/2 − 1. */
    worldBounds: 32,
    /** Non-dominant pinch + vertical travel (view units) per layer step (§13.3 mechanism 4). */
    LAYER_STEP_DISTANCE: 0.06,
    initialInstanceCapacity: 256,
    /**
     * Resting orientation of the structure (radians): a gentle 3/4 view so top and side faces are
     * visible — and pinchable for face extrusion — instead of only front faces. Reset view returns here.
     */
    defaultView: { tiltX: 0.28, turnY: -0.4 },
    /**
     * A held pinch paints further voxels only after the aim has moved this far (voxels) from where
     * the pinch started, so a stationary pinch places exactly one voxel (§13.9).
     */
    paintDeadZone: 0.5,
    /** After that, the aim must be this far (voxels) past a cell's edge to paint the next cell. */
    cellHysteresis: 0.15,
    /**
     * Push / pull extrusion (§13.3 mechanism 3): depth-signal change since the pinch per voxel.
     * Finer than the layer quantizer (depth.DEPTH_STEP): one step ≈ 8% change in hand size, so
     * pulling a hand from ~60 to ~45 cm from the camera extrudes about 4 voxels. Not yet tuned on
     * real hands.
     */
    extrude: { step: 0.05, hysteresis: 0.015, dwellMs: 100, deadZone: 0.02 },
    /**
     * A face stroke's locked plane seen more edge-on than this (|cos| between the view ray and the
     * plane normal) gives unstable hits; the stroke then only follows voxel faces on that plane.
     */
    minPlaneFacing: 0.25,
    /** Push/pull extrusion: faces turned further away from the camera than this grow on "push". */
    awayFacing: -0.3,
    /** Longest push/pull column (voxels). */
    maxExtrude: 16,
    /** Uniform scale limits for the whole structure (two-hand transform). */
    rootScale: { min: 0.3, max: 3 },
    materials: { glassOpacity: 0.38 },
    /** Voxel edge shading: darker border on every face so cubes read clearly over video. */
    edge: { texSize: 32, borderPx: 2, borderShade: 0.5 },
    ghost: { opacity: 0.32, pulse: 0.14, pulseHz: 1.4, eraseColor: '#ff5470', edgeOpacity: 0.9 },
    grid: { color: '#9fe8ff', opacity: 0.13, flashOpacity: 0.55, flashMs: 300 },
    /** Tool-panel updates (voxel count while painting) are published at most this often. */
    uiHz: 10,
  },

  scene: {
    hemiLight: { sky: 0xdff6ff, ground: 0x1a1030, intensity: 1.1 },
    dirLight: { color: 0xffffff, intensity: 1.6, position: [4, 8, 10] as const },
    fov: 50,
    near: 0.1,
    far: 1000,
    cameraZ: 20,
    /** Cap devicePixelRatio to keep fill-rate sane on 4K / HiDPI screens. */
    maxPixelRatio: 2,
    /**
     * Most draws (WebGL + 2D overlay) per second; 0 = draw on every display frame. Only drawing is
     * paced — tracking, gestures and modes still run every frame. Uncapped, a 144 Hz screen redraws
     * each 30 fps camera frame ~5× on the GPU MediaPipe also needs, halving hand updates (D40).
     */
    maxRenderFps: 60,
    /** A display frame up to this fraction of the draw interval early still draws (vsync jitter). */
    renderPacingSlack: 0.2,
    clearColor: 0x05070b,
    /** Mirror (selfie) view by default; user-toggleable in Settings (Phase 12). */
    mirror: true,
  },

  /** Air Draw (§15). Sizes are fractions of the video height, so drawings scale with the view. */
  draw: {
    /** A pen point is kept only once it moved this far (aspect-corrected view units ≈ 3 px at 720p). */
    MIN_STROKE_STEP: 0.004,
    /** 8 neon colours (§15); the first is the default. */
    palette: [
      { name: 'Cyan', hex: '#2ef2ff' },
      { name: 'Magenta', hex: '#ff2bd6' },
      { name: 'Lime', hex: '#b6ff2e' },
      { name: 'Yellow', hex: '#ffe23d' },
      { name: 'Orange', hex: '#ff8a2b' },
      { name: 'Red', hex: '#ff3b5c' },
      { name: 'Violet', hex: '#a45bff' },
      { name: 'White', hex: '#ffffff' },
    ],
    /** 3 brush widths (≈ 4 / 9 / 17 px on a 720 px tall view). */
    widths: [
      { name: 'Thin', size: 0.006 },
      { name: 'Medium', size: 0.012 },
      { name: 'Thick', size: 0.024 },
    ],
    defaultWidth: 1,
    /**
     * Extra One Euro smoothing on the pen, on top of the hand smoothing (view units / s). Picked on
     * the user's 43 real moving pinches (720p px): wiggle 1.3 / 8.4 px (median / p95) without it →
     * 0.8 / 6.1 px, for a line trailing the pen by 4.4 / 11 px (β 10: 5.9 / 15 px, barely smoother).
     */
    oneEuro: { minCutoff: 2, beta: 20, dCutoff: 1 },
    /** Eraser reach around the fingertip (≈ 22 px at 720p), plus the stroke's own half-width. */
    eraserRadius: 0.03,
    /**
     * The other hand's fist = eraser (D49). A fist that drops out for this long (tracking) still
     * counts, so a flicker neither ends the erase nor lets a stray line start.
     */
    fistGraceMs: 150,
    /** The stroke the eraser would remove: a red halo (px wider than the line) + a dashed line. */
    eraseHighlight: { color: '#ff5470', alpha: 0.4, pad: 10, dash: [8, 6] },
    /**
     * Neon glow, drawn additively: wide see-through passes (× line width, alpha), the line, then a
     * whiter core (× width). Not canvas shadowBlur: repainting 200 glowing strokes took ~250 ms
     * with blur vs ~90 ms like this (browser pane, Intel iGPU, 1600×900). Repaints are rare: the
     * finished strokes are cached and a new stroke is just added on top (~1.5 ms).
     */
    glow: {
      layers: [
        { width: 4, alpha: 0.06 },
        { width: 2.9, alpha: 0.1 },
        { width: 1.9, alpha: 0.18 },
      ],
      core: 0.4,
      coreWhite: 0.55,
    },
    /** Points a new stroke's buffer holds before it doubles. */
    initialPoints: 256,
    /** Tool-panel updates (stroke count) are published at most this often. */
    uiHz: 10,
  },

  history: {
    cap: 200,
  },

  ui: {
    /** Max rate for pushing status text into React state. */
    statusHz: 10,
    toastMs: 1400,
  },

  persistence: {
    autosaveDebounceMs: 1000,
    settingsVersion: 1,
    sceneVersion: 1,
  },
} as const;

export type Tuning = typeof TUNING;

/** Default user settings (§21.8); persisted/editable from Phase 12. */
export const DEFAULT_SETTINGS: Settings = {
  dominant: 'right',
  mirror: TUNING.scene.mirror,
  smoothing: TUNING.smoothing.defaultSlider,
  showSkeleton: TUNING.overlay.showSkeleton,
  inferenceHz: TUNING.tracker.defaultInferenceHz,
  quality: 'medium',
  depthLockDefault: true,
};

// ---------- Feature flags (stretch goals + dev-only tools) ----------
export const FEATURE_FLAGS = {
  /**
   * Run hand tracking in a Web Worker so inference never blocks rendering (auto-falls back to the
   * main thread if unsupported or it fails; `?vision=main` forces the main thread).
   */
  visionWorker: true,
  /** Four-corner warp for texture surfaces (V1.1 stretch goal). */
  fourCornerWarp: false,
  /** Swipe gesture for mode/tool switching. */
  swipeGesture: false,
  /** Air Draw PNG export. */
  drawExport: false,
  /** Dev-only fixture recorder in the debug panel. */
  fixtureRecorder: import.meta.env.DEV,
  /** Dev-only window.__gs_debug counters for E2E leak checks. */
  debugCounters: import.meta.env.DEV || import.meta.env.MODE === 'test',
} as const;
