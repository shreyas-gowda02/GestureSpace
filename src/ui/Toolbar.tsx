// Top bar: brand · experience · camera indicator · FPS · Help · Debug · Settings.

import { MODE_META } from '@/modes/registry';
import { useAppStore, type CameraStatus } from '@/state/appStore';

const CAMERA_LABEL: Record<CameraStatus, string> = {
  idle: 'Camera off',
  requesting: 'Requesting camera…',
  loading: 'Loading hand tracker…',
  running: 'Camera on',
  stopped: 'Camera stopped',
  error: 'Camera error',
};

export function Toolbar() {
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
