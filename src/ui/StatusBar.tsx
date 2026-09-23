// Bottom bar: gesture status + always-available recovery controls (§21.1, §21.10).
// Actions are no-ops until their owning systems land (history: Phase 5, camera: Phase 1).

import { useAppStore } from '@/state/appStore';

export function StatusBar() {
  const statusText = useAppStore((s) => s.statusText);
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  const cameraStatus = useAppStore((s) => s.cameraStatus);
  const cameraOn = cameraStatus === 'running' || cameraStatus === 'loading';

  return (
    <footer className="gs-panel gs-statusbar">
      <div className="gs-statusbar__text" role="status" aria-live="polite">
        <span className="gs-muted">Status:</span> {statusText}
      </div>
      <div className="gs-statusbar__actions">
        <button type="button" className="gs-btn" disabled={!canUndo} aria-label="Undo">
          Undo
        </button>
        <button type="button" className="gs-btn" disabled={!canRedo} aria-label="Redo">
          Redo
        </button>
        <button type="button" className="gs-btn" aria-label="Clear current experience">
          Clear
        </button>
        <button type="button" className="gs-btn" aria-label="Reset view">
          Reset
        </button>
        <button
          type="button"
          className="gs-btn gs-btn--danger"
          disabled={!cameraOn}
          aria-label="Stop camera"
        >
          Stop cam
        </button>
      </div>
    </footer>
  );
}
