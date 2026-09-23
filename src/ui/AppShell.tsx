// Base layout (§21.1): full-bleed stage behind translucent chrome —
// top bar · mode dock · per-mode tool panel · status bar.

import { MODE_META } from '@/modes/registry';
import { useAppStore, type CameraStatus } from '@/state/appStore';
import { ModeDock } from './ModeDock';

const CAMERA_LABEL: Record<CameraStatus, string> = {
  idle: 'Camera off',
  requesting: 'Requesting camera…',
  loading: 'Loading hand tracker…',
  running: 'Camera on',
  stopped: 'Camera stopped',
  error: 'Camera error',
};

/** Top bar: brand · experience · camera indicator · FPS · Help · Debug · Settings. */
function TopBar() {
  const activeMode = useAppStore((s) => s.activeMode);
  const cameraStatus = useAppStore((s) => s.cameraStatus);
  const fps = useAppStore((s) => s.fps);
  const helpOpen = useAppStore((s) => s.helpOpen);
  const debugOpen = useAppStore((s) => s.debugOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const toggleHelp = useAppStore((s) => s.toggleHelp);
  const toggleDebug = useAppStore((s) => s.toggleDebug);
  const toggleSettings = useAppStore((s) => s.toggleSettings);

  return (
    <header className="gs-panel gs-topbar">
      <div className="gs-topbar__brand">
        <span className="gs-logo" aria-hidden="true" />
        GestureSpace
      </div>
      <div className="gs-topbar__mode">{MODE_META[activeMode].name}</div>
      <div className="gs-topbar__spacer" />
      <div className={`gs-camera-indicator is-${cameraStatus}`} role="status" aria-live="polite">
        <span className="gs-camera-indicator__dot" aria-hidden="true" />
        {CAMERA_LABEL[cameraStatus]}
      </div>
      <div className="gs-topbar__fps" aria-label="Frames per second">
        {fps > 0 ? `${Math.round(fps)} FPS` : '— FPS'}
      </div>
      <button
        type="button"
        className="gs-btn gs-btn--ghost"
        aria-pressed={helpOpen}
        onClick={toggleHelp}
      >
        Help
      </button>
      <button
        type="button"
        className="gs-btn gs-btn--ghost"
        aria-pressed={debugOpen}
        onClick={toggleDebug}
      >
        Debug
      </button>
      <button
        type="button"
        className="gs-btn gs-btn--ghost gs-btn--icon"
        aria-pressed={settingsOpen}
        aria-label="Settings"
        onClick={toggleSettings}
      >
        ⚙
      </button>
    </header>
  );
}

/** Right-hand per-mode tool panel (collapsible). Mode-specific controls land with each mode. */
function ToolPanel() {
  const activeMode = useAppStore((s) => s.activeMode);
  const open = useAppStore((s) => s.toolPanelOpen);
  const toggle = useAppStore((s) => s.toggleToolPanel);
  const meta = MODE_META[activeMode];

  return (
    <aside
      className={`gs-panel gs-toolpanel${open ? '' : ' is-collapsed'}`}
      aria-label={`${meta.name} tools`}
    >
      <button
        type="button"
        className="gs-toolpanel__toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? 'Collapse tool panel' : 'Expand tool panel'}
      >
        {open ? '›' : '‹'}
      </button>
      {open && (
        <div className="gs-toolpanel__body">
          <h2 className="gs-toolpanel__heading">{meta.name}</h2>
          <p className="gs-muted">Tools for this experience appear here.</p>
          <h3 className="gs-toolpanel__sub">Gestures</h3>
          <ul className="gs-helplist">
            {meta.help.map((h) => (
              <li key={h.gesture}>
                <span className="gs-helplist__gesture">{h.gesture}</span>
                <span className="gs-helplist__action">{h.action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

/**
 * Bottom bar: gesture status + always-available recovery controls (§21.1, §21.10).
 * Actions are no-ops until their owning systems land (history: Phase 5, camera: Phase 1).
 */
function StatusBar() {
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

export function AppShell() {
  const activeMode = useAppStore((s) => s.activeMode);
  const meta = MODE_META[activeMode];

  return (
    <div className="gs-app">
      {/* Layer 1: WebGL canvas (camera background + 3D) — Phase 1 */}
      {/* Layer 2: 2D overlay canvas — Phase 2 */}
      <div className="gs-stage" aria-hidden="true">
        <div className="gs-stage__placeholder">
          <div className="gs-stage__orb" />
          <p className="gs-stage__title">{meta.name}</p>
          <p className="gs-stage__subtitle">{meta.tagline}</p>
          <p className="gs-stage__note">Camera and hand tracking arrive in Phases 1–2.</p>
        </div>
      </div>

      {/* Layer 3: React UI chrome */}
      <TopBar />
      <ModeDock />
      <ToolPanel />
      <StatusBar />
    </div>
  );
}
