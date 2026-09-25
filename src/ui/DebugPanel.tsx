// Debug panel v1 (§21.9, toggled with ` or the Debug button). Polls a plain snapshot from the core
// at a few Hz — high-frequency data never flows through React state (§2 rule 3).
// Also hosts the dev-only landmark fixture recorder / player (§9).

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  debugSnapshot,
  getCore,
  leakCheck,
  type DebugSnapshot,
  type LeakCheckResult,
} from '@/app/bootstrap';
import { FEATURE_FLAGS, TUNING } from '@/config/tuning';
import { downloadFixture, parseFixture } from '@/core/input';
import type { SmoothingMode } from '@/vision/smoothing';
import { useAppStore } from '@/state/appStore';

const f1 = (n: number): string => n.toFixed(1);
const f2 = (n: number): string => n.toFixed(2);
const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

const GESTURE_LABEL: Record<string, string> = {
  pinch: 'pinch',
  grab: 'grab',
  point: 'point',
  openPalm: 'open',
  thumbPinky: 'thumb-pinky',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gs-debug__row">
      <span className="gs-debug__label">{label}</span>
      <span className="gs-debug__value">{children}</span>
    </div>
  );
}

const SMOOTHING_MODES: { mode: SmoothingMode; label: string }[] = [
  { mode: 'off', label: 'Off (raw)' },
  { mode: 'smooth', label: 'Smooth' },
  { mode: 'predict', label: 'Smooth + predict' },
];

/** Live A/B switch for the hand visuals (gesture detection always uses its own profile). */
function SmoothingSwitch({ current }: { current: SmoothingMode }) {
  return (
    <div className="gs-debug__buttons" role="group" aria-label="Smoothing mode">
      {SMOOTHING_MODES.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          className="gs-btn"
          aria-pressed={current === mode}
          onClick={() => getCore()?.setSmoothingMode(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function FixtureControls({ snap }: { snap: DebugSnapshot }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleRecord = (): void => {
    const core = getCore();
    if (!core) return;
    if (!core.recorder.recording) {
      core.recorder.start();
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fixture = core.recorder.stop(`gs-fixture-${stamp}`);
    if (fixture) downloadFixture(fixture);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const fixture = parseFixture(JSON.parse(await file.text()));
      getCore()?.playFixture(fixture);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="gs-debug__section">
      <h3 className="gs-debug__heading">Landmark fixtures</h3>
      <div className="gs-debug__buttons">
        <button
          type="button"
          className={`gs-btn${snap.recording ? ' gs-btn--danger is-recording' : ''}`}
          onClick={toggleRecord}
          disabled={snap.input !== 'live'}
        >
          {snap.recording ? `■ Stop & save (${snap.recordedFrames})` : '● Record'}
        </button>
        {snap.playback ? (
          <button type="button" className="gs-btn" onClick={() => getCore()?.stopPlayback()}>
            ■ Stop playback
          </button>
        ) : (
          <button type="button" className="gs-btn" onClick={() => fileRef.current?.click()}>
            ▶ Play fixture…
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => void onFile(e)}
        />
      </div>
      {error && <p className="gs-debug__error">{error}</p>}
    </div>
  );
}

/** §23 dev check: cycle all modes 10× and confirm GPU memory is back where it started. */
function LeakCheck() {
  const [result, setResult] = useState<LeakCheckResult | null>(null);
  return (
    <div className="gs-debug__buttons">
      <button type="button" className="gs-btn" onClick={() => setResult(leakCheck(10))}>
        Leak check (10× all modes)
      </button>
      {result && (
        <span className={result.ok ? 'gs-debug__ok' : 'gs-debug__error'}>
          {result.ok ? '✓ no leak' : '✗ leak'} · geo {result.before.geometries}→
          {result.after.geometries} · tex {result.before.textures}→{result.after.textures}
        </span>
      )}
    </div>
  );
}

export function DebugPanel() {
  const open = useAppStore((s) => s.debugOpen);
  const [snap, setSnap] = useState<DebugSnapshot | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setSnap(debugSnapshot()), TUNING.perf.debugPanelPollMs);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  return (
    <section className="gs-panel gs-debug" aria-label="Debug panel">
      <h2 className="gs-debug__title">Debug</h2>
      {!snap ? (
        <p className="gs-muted">Collecting…</p>
      ) : (
        <>
          <div className="gs-debug__section">
            <Row label="Render">{Math.round(snap.renderFps)} fps</Row>
            <Row label="Inference">
              {Math.round(snap.inferenceFps)} Hz · {f1(snap.inferenceMs)} ms avg
            </Row>
            <Row label="Inferences">{snap.inferenceCount}</Row>
            <Row label="Skipped cam frames">{snap.skippedFrames}</Row>
            <Row label="Tracker">
              {snap.tracker.status}
              {snap.tracker.delegate && ` · ${snap.tracker.delegate}`}
              {snap.tracker.thread === 'worker' ? ' · worker' : ' · main thread'}
              {snap.tracker.loadMs > 0 && ` · loaded in ${Math.round(snap.tracker.loadMs)} ms`}
            </Row>
            <Row label="Video">
              {snap.video.width}×{snap.video.height} · mirror {snap.mirror ? 'on' : 'off'}
            </Row>
            <Row label="Viewport">
              {snap.viewport.width}×{snap.viewport.height} @{snap.viewport.dpr}x
            </Row>
            <Row label="Hands seen">
              {snap.userLock.detected} detected · {snap.userLock.used} used (main user)
              {snap.userLock.phantoms > 0 && ` · ${snap.userLock.phantoms} phantom dropped`}
              {snap.userLock.waiting > 0 && ` · ${snap.userLock.waiting} waiting to be named`}
              {snap.userLock.identityLocked && ' · 🔒'}
            </Row>
            <Row label="Smoothing">{f2(snap.smoothingHz)} Hz min cutoff</Row>
            <SmoothingSwitch current={snap.smoothingMode} />
            <Row label="Input">
              {snap.playback
                ? `fixture “${snap.playback.name}” ${Math.round(snap.playback.progress * 100)}%`
                : 'live camera'}
            </Row>
          </div>

          <div className="gs-debug__section">
            <h3 className="gs-debug__heading">Hands</h3>
            {snap.hands.length === 0 && <p className="gs-muted">No hands detected</p>}
            {snap.hands.map((h) => (
              <div key={h.side} className={`gs-debug__hand is-${h.side}`}>
                <strong>{h.side === 'right' ? 'Right' : 'Left'}</strong> ·{' '}
                {Math.round(h.score * 100)}% · palm {f2(h.palmScale)} · wrist ({f2(h.wrist.x)},{' '}
                {f2(h.wrist.y)}){h.lostForMs > 0 && ` · lost ${Math.round(h.lostForMs)} ms`}
                <span className="gs-muted"> · MediaPipe “{h.rawLabel}”</span>
                <div className="gs-muted" title="Running votes: + = right hand, − = left hand">
                  votes: MediaPipe {signed(h.votes.label)} · 3D thumb check {signed(h.votes.hand3d)}
                </div>
                <div className="gs-muted">
                  depth {f2(h.depth.signal)} (step {h.depth.steps}) · cursor{' '}
                  {h.cursor
                    ? `${h.cursor.kind}${h.cursor.id ? ` “${h.cursor.id}”` : ''} (${f1(h.cursor.x)}, ${f1(h.cursor.y)}, ${f1(h.cursor.z)})`
                    : '—'}
                </div>
                <div className="gs-debug__gestures">
                  {h.gestures.map((g) => (
                    <span key={g.name} className={`gs-debug__gesture is-${g.phase}`}>
                      {GESTURE_LABEL[g.name] ?? g.name} {f2(g.value)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="gs-debug__section">
            <h3 className="gs-debug__heading">Two hands</h3>
            <Row label="Two-hand pinch">
              {snap.twoHand.active
                ? `active · ×${f2(snap.twoHand.scale)} · ${Math.round(snap.twoHand.rotationDeg)}°`
                : 'idle'}
            </Row>
            <Row label="Hand distance">{f2(snap.twoHand.distance)}</Row>
          </div>

          <div className="gs-debug__section">
            <h3 className="gs-debug__heading">Experience</h3>
            <Row label="Active mode">
              {snap.mode.active ?? '—'} · {snap.mode.created}/7 created
            </Row>
            <Row label="Captures">
              {snap.mode.captures.length ? snap.mode.captures.join(', ') : 'none'}
            </Row>
            <Row label="Cursor targets">{snap.mode.targets}</Row>
            <Row label="Undo / redo">
              {snap.mode.canUndo ? 'yes' : 'no'} / {snap.mode.canRedo ? 'yes' : 'no'}
            </Row>
          </div>

          <div className="gs-debug__section">
            <h3 className="gs-debug__heading">Renderer</h3>
            <Row label="Draw calls / tris">
              {snap.renderer.calls} / {snap.renderer.triangles}
            </Row>
            <Row label="GPU geometries / textures">
              {snap.renderer.geometries} / {snap.renderer.textures}
            </Row>
            <LeakCheck />
          </div>

          {FEATURE_FLAGS.fixtureRecorder && <FixtureControls snap={snap} />}
        </>
      )}
    </section>
  );
}
