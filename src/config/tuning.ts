// ALL tunable numbers + feature flags live here (§2 rule 10). Never inline thresholds/timings elsewhere.
// Final tuned values are documented in docs/GESTURES.md.

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
     * MediaPipe labels handedness assuming a mirrored (selfie) input; we feed the
     * un-mirrored video, so labels are swapped. Per MediaPipe docs → true.
     * Verify: raise your physical RIGHT hand — the overlay must say "Right".
     */
    HANDEDNESS_LABEL_SWAP: true,
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
    /** Visual profile: stronger, for overlays/objects. */
    visual: { minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 },
    /** Trigger profile: lighter, for gesture distances. */
    trigger: { minCutoff: 2.5, beta: 0.02, dCutoff: 1.0 },
    /** Settings slider (0..1) maps onto visual.minCutoff within this range. */
    sliderMinCutoffRange: [0.3, 3.0],
    defaultSlider: 0.65,
  },

  confidence: {
    MIN_HAND_SCORE: 0.6,
    /** Max wrist travel (view units) per inference step before the sample is rejected. */
    MAX_JUMP: 0.25,
    HAND_LOSS_GRACE_MS: 150,
  },

  gestures: {
    CANDIDATE_MS: 60,
    RELEASE_DEBOUNCE_MS: 80,
    HOLD_MS: 600,
    pinch: { start: 0.35, end: 0.5 },
    /** Tip must be this much farther from the wrist than the PIP to count as extended. */
    fingerExtendedRatio: 1.15,
    grab: { start: 0.9, end: 1.1 },
    thumbPinky: { start: 0.35, end: 0.5, cooldownMs: 400 },
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
    oneEuro: { minCutoff: 0.5, beta: 0.004, dCutoff: 1.0 },
  },

  voxel: {
    defaultColor: '#21d4d8',
    voxelSize: 1,
    worldBounds: 32,
    LAYER_STEP_DISTANCE: 0.06,
    initialInstanceCapacity: 256,
  },

  scene: {
    fov: 50,
    near: 0.1,
    far: 1000,
    cameraZ: 20,
    /** Cap devicePixelRatio to keep fill-rate sane on 4K / HiDPI screens. */
    maxPixelRatio: 2,
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

// ---------- Feature flags (stretch goals + dev-only tools) ----------
export const FEATURE_FLAGS = {
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
