// UI-only state (§2 rule 3). NEVER put landmarks, gesture frames or cursors here.

import { create } from 'zustand';
import type { CameraError, CameraState } from '@/core/camera';
import { DEFAULT_SETTINGS } from '@/config/tuning';
import type { ModeId, Settings } from '@/core/types';
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
  settings: Settings;
  fps: number;
  toolPanelOpen: boolean;
  helpOpen: boolean;
  debugOpen: boolean;
  settingsOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;

  setActiveMode(mode: ModeId): void;
  setCamera(status: CameraStatus, error: CameraError | null): void;
  setTracker(status: TrackerStatus, error: string | null, delegate: TrackerDelegate | null): void;
  setHandCount(count: number): void;
  setStatusText(text: string): void;
  setModeStatus(text: string): void;
  updateSettings(patch: Partial<Settings>): void;
  setHistory(canUndo: boolean, canRedo: boolean): void;
  setFps(fps: number): void;
  toggleToolPanel(): void;
  toggleHelp(): void;
  toggleDebug(): void;
  toggleSettings(): void;
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
  settings: DEFAULT_SETTINGS,
  fps: 0,
  toolPanelOpen: true,
  helpOpen: false,
  debugOpen: false,
  settingsOpen: false,
  canUndo: false,
  canRedo: false,

  setActiveMode: (activeMode) => set({ activeMode }),
  setCamera: (cameraStatus, cameraError) => set({ cameraStatus, cameraError }),
  setTracker: (trackerStatus, trackerError, trackerDelegate) =>
    set({ trackerStatus, trackerError, trackerDelegate }),
  setHandCount: (handCount) => set({ handCount }),
  setStatusText: (statusText) => set({ statusText }),
  setModeStatus: (modeStatus) => set({ modeStatus }),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setHistory: (canUndo, canRedo) => set({ canUndo, canRedo }),
  setFps: (fps) => set({ fps }),
  toggleToolPanel: () => set((s) => ({ toolPanelOpen: !s.toolPanelOpen })),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  closeOverlays: () => set({ helpOpen: false, settingsOpen: false }),
}));
