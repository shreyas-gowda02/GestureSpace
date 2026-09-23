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
    /**
     * Detect up to 4 hands so the main-user lock (handPipeline) can pick the MAIN user's pair
     * and ignore people in the background. Only 2 hands are ever used (single-user app).
     */
    numHands: 4,
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
    /** Visual profile: stronger, for overlays/objects. minCutoff comes from the Smoothing slider. */
    visual: { beta: 8, dCutoff: 1.0 },
    /** Trigger profile: lighter / lower lag, for gesture distances. */
    trigger: { minCutoff: 2.5, beta: 20, dCutoff: 1.0 },
    /** Smoothing slider 0..1 → visual minCutoff (Hz): 0 = responsive (max), 1 = smooth (min). */
    sliderMinCutoffRange: { min: 0.3, max: 3.0 },
    defaultSlider: 0.65,
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
    /** Consecutive inferences a contradicting handedness label must persist before sides flip. */
    labelSwitchFrames: 3,
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
