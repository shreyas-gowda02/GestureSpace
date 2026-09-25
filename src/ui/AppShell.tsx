// Base layout (§21.1): full-bleed stage behind translucent chrome —
// top bar · mode dock · per-mode tool panel · status bar.

import { useEffect, useRef } from 'react';
import {
  acquireCore,
  clearMode,
  redo,
  releaseCore,
  reportCoreFailure,
  resetView,
  stopCamera,
  undo,
} from '@/app/bootstrap';
import { BUILT_MODES, MODE_META } from '@/modes/registry';
import { useAppStore, type CameraStatus } from '@/state/appStore';
import { DebugPanel } from './DebugPanel';
import { ModeDock } from './ModeDock';
import { PermissionScreen, TrackerNotice } from './PermissionScreen';
import { ModeTools } from './toolPanels';

const CAMERA_LABEL: Record<CameraStatus, string> = {
  idle: 'Camera off',
  requesting: 'Requesting camera…',
  running: 'Camera on',
  stopped: 'Camera stopped',
  error: 'Camera error',
};

/** Top bar: brand · experience · camera indicator · FPS · Help · Debug · Settings. */
function TopBar() {
  const activeMode = useAppStore((s) => s.activeMode);
  const cameraStatus = useAppStore((s) => s.cameraStatus);
  const trackerLoading = useAppStore((s) => s.trackerStatus === 'loading');
  const fps = useAppStore((s) => s.fps);
  const indicator = cameraStatus === 'running' && trackerLoading ? 'loading' : cameraStatus;
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
      <div className={`gs-camera-indicator is-${indicator}`} role="status" aria-live="polite">
        <span className="gs-camera-indicator__dot" aria-hidden="true" />
        {indicator === 'loading' ? 'Camera on · loading tracker…' : CAMERA_LABEL[cameraStatus]}
      </div>
      <div className="gs-topbar__fps" aria-label="Frames per second">
        {fps >= 1 ? `${Math.round(fps)} FPS` : fps > 0 ? '<1 FPS' : '— FPS'}
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

/** Right-hand per-mode tool panel (collapsible): the experience's controls + its gestures. */
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
          {BUILT_MODES.has(activeMode) ? (
            <p className="gs-muted">{meta.tagline}</p>
          ) : (
            <p className="gs-muted">
              Preview: a placeholder shape you can pinch and drag. The full experience and its tools
              arrive in Phase {meta.phase}.
            </p>
          )}
          <ModeTools mode={activeMode} />
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
 * Bottom bar: gesture status + the active experience's status + always-available recovery
 * controls (§21.1, §21.10). Undo/Redo act on the active experience's own history.
 */
function StatusBar() {
  const statusText = useAppStore((s) => s.statusText);
  const modeStatus = useAppStore((s) => s.modeStatus);
  const canUndo = useAppStore((s) => s.canUndo);
  const canRedo = useAppStore((s) => s.canRedo);
  const cameraStatus = useAppStore((s) => s.cameraStatus);
  const cameraOn = cameraStatus === 'running' || cameraStatus === 'requesting';

  return (
    <footer className="gs-panel gs-statusbar">
      <div className="gs-statusbar__text" role="status" aria-live="polite">
        <span className="gs-muted">Status:</span> {statusText}
        {modeStatus && <span className="gs-statusbar__mode"> — {modeStatus}</span>}
      </div>
      <div className="gs-statusbar__actions">
        <button
          type="button"
          className="gs-btn"
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          onClick={undo}
        >
          Undo
        </button>
        <button
          type="button"
          className="gs-btn"
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          onClick={redo}
        >
          Redo
        </button>
        <button
          type="button"
          className="gs-btn"
          aria-label="Clear current experience"
          title="Clear (C)"
          onClick={clearMode}
        >
          Clear
        </button>
        <button
          type="button"
          className="gs-btn"
          aria-label="Reset view"
          title="Reset view (R)"
          onClick={resetView}
        >
          Reset
        </button>
        <button
          type="button"
          className="gs-btn gs-btn--danger"
          disabled={!cameraOn}
          aria-label="Stop camera"
          onClick={stopCamera}
        >
          Stop cam
        </button>
      </div>
    </footer>
  );
}

/**
 * Full-bleed stage. The core (one renderer + hidden <video>) mounts its canvas here; React never
 * renders into it. Layers bottom→top: WebGL canvas → 2D overlay (Phase 2) → React chrome.
 */
function Stage() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let mounted = false;
    try {
      acquireCore().mount(el);
      mounted = true;
    } catch (err) {
      reportCoreFailure(err);
    }
    return () => {
      if (mounted) releaseCore();
    };
  }, []);

  return <div ref={ref} className="gs-stage" aria-hidden="true" />;
}

export function AppShell() {
  return (
    <div className="gs-app">
      <Stage />
      <PermissionScreen />
      <TrackerNotice />
      <DebugPanel />
      <TopBar />
      <ModeDock />
      <ToolPanel />
      <StatusBar />
    </div>
  );
}
