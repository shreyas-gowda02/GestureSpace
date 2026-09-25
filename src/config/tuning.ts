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

  twoHand: {
    minScale: 0.2,
    maxScale: 5.0,
    ROTATION_SENSITIVITY: 1.0,
    /** Clamp on per-frame deltas to prevent explosions. */
    maxScaleStepPerFrame: 0.25,
    maxRotationStepPerFrame: 0.35,
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
  },

  voxel: {
    defaultColor: '#21d4d8',
    voxelSize: 1,
    worldBounds: 32,
    LAYER_STEP_DISTANCE: 0.06,
    initialInstanceCapacity: 256,
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

  draw: {
    MIN_STROKE_STEP: 0.004,
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
