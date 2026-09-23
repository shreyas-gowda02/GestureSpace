// Base layout (§21.1): full-bleed stage behind translucent chrome.

import { MODE_META } from '@/modes/registry';
import { useAppStore } from '@/state/appStore';
import { ModeDock } from '@/ui/ModeDock';
import { StatusBar } from '@/ui/StatusBar';
import { Toolbar } from '@/ui/Toolbar';

export function AppShell() {
  const activeMode = useAppStore((s) => s.activeMode);
  const toolPanelOpen = useAppStore((s) => s.toolPanelOpen);
  const toggleToolPanel = useAppStore((s) => s.toggleToolPanel);
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
      <Toolbar />
      <ModeDock />

      <aside
        className={`gs-panel gs-toolpanel${toolPanelOpen ? '' : ' is-collapsed'}`}
        aria-label={`${meta.name} tools`}
      >
        <button
          type="button"
          className="gs-toolpanel__toggle"
          onClick={toggleToolPanel}
          aria-expanded={toolPanelOpen}
          aria-label={toolPanelOpen ? 'Collapse tool panel' : 'Expand tool panel'}
        >
          {toolPanelOpen ? '›' : '‹'}
        </button>
        {toolPanelOpen && (
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

      <StatusBar />
    </div>
  );
}
