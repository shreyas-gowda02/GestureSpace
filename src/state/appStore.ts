// UI-only state (§2 rule 3). NEVER put landmarks, gesture frames or cursors here.

import { create } from 'zustand';
import type { CameraError, CameraState } from '@/core/camera';
import type { ModeId } from '@/core/types';

/** Camera lifecycle as the UI sees it ('loading' = hand tracker initialising, Phase 2). */
export type CameraStatus = CameraState | 'loading';

export interface AppState {
  activeMode: ModeId;
  cameraStatus: CameraStatus;
  cameraError: CameraError | null;
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
  setStatusText: (statusText) => set({ statusText }),
  setFps: (fps) => set({ fps }),
  toggleToolPanel: () => set((s) => ({ toolPanelOpen: !s.toolPanelOpen })),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  toggleDebug: () => set((s) => ({ debugOpen: !s.debugOpen })),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  closeOverlays: () => set({ helpOpen: false, settingsOpen: false }),
}));
