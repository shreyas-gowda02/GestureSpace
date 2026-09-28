// UI-only state (§2 rule 3). NEVER put landmarks, gesture frames or cursors here.

import { create } from 'zustand';
import type { CameraError, CameraState } from '@/core/camera';
import { DEFAULT_SETTINGS } from '@/config/tuning';
import type { ModeId, ModeUiStates, Settings } from '@/core/types';
import {
  clearSettings,
  loadSettings,
  onboardingDone,
  prefersReducedMotion,
  saveSettings,
  setOnboardingDone,
} from './persistence';
import type { TrackerDelegate, TrackerStatus } from '@/vision/HandTracker';

export type CameraStatus = CameraState;

export interface AppState {
  activeMode: ModeId;
  cameraStatus: CameraStatus;
  cameraError: CameraError | null;
  trackerStatus: TrackerStatus;
  trackerError: string | null;
  trackerDelegate: TrackerDelegate | null;
  /** Hands currently visible (0–2). Only written when it changes. */
  handCount: number;
  /** Throttled (≤10 Hz) status line, e.g. "Right: pinch · Left: —". */
  statusText: string;
  /** Short message from the active experience (emitStatus), e.g. "Panel captured". */
  modeStatus: string;
  /** Tool-panel state each experience publishes (layer, tool, colour…), ≤ 10 Hz. */
  modeUi: Partial<ModeUiStates>;
  settings: Settings;
  fps: number;
  toolPanelOpen: boolean;
  helpOpen: boolean;
  debugOpen: boolean;
  settingsOpen: boolean;
  /** The first-run walkthrough (§21.4) is showing. */
  onboardingOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;

  setActiveMode(mode: ModeId): void;
  setCamera(status: CameraStatus, error: CameraError | null): void;
  setTracker(status: TrackerStatus, error: string | null, delegate: TrackerDelegate | null): void;
  setHandCount(count: number): void;
  setStatusText(text: string): void;
  setModeStatus(text: string): void;
  setModeUi<K extends keyof ModeUiStates>(id: K, state: ModeUiStates[K]): void;
  /** Change settings (saved at once). */
  updateSettings(patch: Partial<Settings>): void;
  /** Every setting back to its default (and forget the saved ones). */
  resetSettings(): void;
  setHistory(canUndo: boolean, canRedo: boolean): void;
  setFps(fps: number): void;
  toggleToolPanel(): void;
  toggleHelp(): void;
  toggleDebug(): void;
  toggleSettings(): void;
  /** Show the walkthrough (from Help / Settings, or the first time the camera starts). */
  openOnboarding(): void;
  /** Finish or skip it: it won't open by itself again. */
  closeOnboarding(): void;
  /** The walkthrough opens by itself the first time the camera runs, if never finished. */
  maybeStartOnboarding(): void;
  closeOverlays(): void;
}

export const useAppStore = create<AppState>()((set) => ({
  activeMode: 'voxel',
  cameraStatus: 'idle',
  cameraError: null,
  trackerStatus: 'idle',
  trackerError: null,
  trackerDelegate: null,
  handCount: 0,
  statusText: 'Right: — · Left: —',
  modeStatus: '',
  modeUi: {},
  settings: loadSettings(),
  fps: 0,
  toolPanelOpen: true,
  helpOpen: false,
  debugOpen: false,
  settingsOpen: false,
  onboardingOpen: false,
  canUndo: false,
  canRedo: false,

  setActiveMode: (activeMode) => set({ activeMode }),
  setCamera: (cameraStatus, cameraError) => set({ cameraStatus, cameraError }),
  setTracker: (trackerStatus, trackerError, trackerDelegate) =>
    set({ trackerStatus, trackerError, trackerDelegate }),
  setHandCount: (handCount) => set({ handCount }),
  setStatusText: (statusText) => set({ statusText }),
  setModeStatus: (modeStatus) => set({ modeStatus }),
  setModeUi: (id, state) => set((s) => ({ modeUi: { ...s.modeUi, [id]: state } })),
  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      saveSettings(settings);
      return { settings };
    }),
  resetSettings: () => {
    clearSettings();
    set({ settings: { ...DEFAULT_SETTINGS, reduceMotion: prefersReducedMotion() } });
  },
  setHistory: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setFps: (fps) => set({ fps }),
  toggleToolPanel: () => set((s) => ({ toolPanelOpen: !s.toolPanelOpen })),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen, settingsOpen: false })),
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen, helpOpen: false })),
  openOnboarding: () => set({ onboardingOpen: true, helpOpen: false, settingsOpen: false }),
  closeOnboarding: () => {
    setOnboardingDone(true);
    set({ onboardingOpen: false });
  },
  maybeStartOnboarding: () => {
    if (!onboardingDone()) set({ onboardingOpen: true });
  },
  closeOverlays: () => set({ helpOpen: false, settingsOpen: false }),
}));
