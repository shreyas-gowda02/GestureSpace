// UI-only state (§2 rule 3). NEVER put landmarks, gesture frames or cursors here.

import { create } from 'zustand';
import type { CameraError, CameraState } from '@/core/camera';
import type { ModeId } from '@/core/types';
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
  setFps: (fps) => set({ fps }),
  toggleToolPanel: () => set((s) => ({ toolPanelOpen: !s.toolPanelOpen })),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  closeOverlays: () => set({ helpOpen: false, settingsOpen: false }),
}));
