// Help, Settings and the first-run walkthrough (§21.4, §21.6, §21.8). While any of them is open the
// scene ignores the hands (§11 rule 1: Core sets ModeController.setUiCaptured).

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  listCameras,
  onboardingSnapshot,
  onlyLeftSeen,
  startCamera,
  stepMet,
  type OnboardingStep,
} from '@/app/bootstrap';
import { KEYBINDING_HELP } from '@/config/keybindings';
import { TUNING } from '@/config/tuning';
import type { CameraResolution, InferenceRate, QualityPreset, Settings } from '@/core/types';
import { MODE_META } from '@/modes/registry';
import { useAppStore } from '@/state/appStore';

const O = TUNING.onboarding;

// --- a modal window ----------------------------------------------------------------------------

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, [tabindex="0"]';

/**
 * A modal window: focus moves into it (and back afterwards), Tab stays inside, a click on the dim
 * background closes it. Esc is handled by the app's keyboard shortcuts (it closes windows).
 */
function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => before?.focus();
  }, []);

  const trapTab = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="gs-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`gs-panel gs-dialog${wide ? ' gs-dialog--wide' : ''}`}
        onKeyDown={trapTab}
      >
        <header className="gs-dialog__header">
          <h2 id={titleId} className="gs-dialog__title">
            {title}
          </h2>
          <button
            type="button"
            className="gs-btn gs-btn--ghost gs-btn--icon"
            aria-label="Close (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="gs-dialog__body">{children}</div>
      </section>
    </div>
  );
}

// --- Help ----------------------------------------------------------------------------------------

/** Help (H / ?): this experience's gestures and every keyboard shortcut (§21.6). */
export function HelpOverlay() {
  const open = useAppStore((s) => s.helpOpen);
  const mode = useAppStore((s) => s.activeMode);
  const toggle = useAppStore((s) => s.toggleHelp);
  const openOnboarding = useAppStore((s) => s.openOnboarding);
  if (!open) return null;
  const meta = MODE_META[mode];

  return (
    <Dialog title={`Help — ${meta.name}`} onClose={toggle} wide>
      <div className="gs-help">
        <section>
          <h3 className="gs-toolpanel__sub">Gestures in {meta.name}</h3>
          <ul className="gs-helplist">
            {meta.help.map((h) => (
              <li key={h.gesture}>
                <span className="gs-helplist__gesture">{h.gesture}</span>
                <span className="gs-helplist__action">{h.action}</span>
              </li>
            ))}
          </ul>
          <h3 className="gs-toolpanel__sub">The basic hand shapes</h3>
          <ul className="gs-helplist">
            <li>
              <span className="gs-helplist__gesture">Pinch</span>
              <span className="gs-helplist__action">Thumb tip and index fingertip touching</span>
            </li>
            <li>
              <span className="gs-helplist__gesture">Point</span>
              <span className="gs-helplist__action">Index finger out, the others curled</span>
            </li>
            <li>
              <span className="gs-helplist__gesture">Fist</span>
              <span className="gs-helplist__action">All four fingers curled in</span>
            </li>
            <li>
              <span className="gs-helplist__gesture">Open hand</span>
              <span className="gs-helplist__action">Fingers spread</span>
            </li>
          </ul>
          <p className="gs-muted">
            The status bar shows what the app sees each hand doing. The full guide is
            INSTRUCTIONS.md in the project folder.
          </p>
        </section>
        <section>
          <h3 className="gs-toolpanel__sub">Keyboard</h3>
          <table className="gs-keys">
            <tbody>
              {KEYBINDING_HELP.map((k) => (
                <tr key={k.keys}>
                  <th scope="row">
                    <kbd>{k.keys}</kbd>
                  </th>
                  <td>{k.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <div className="gs-dialog__actions">
        <button type="button" className="gs-btn" onClick={openOnboarding}>
          Show the walkthrough again
        </button>
      </div>
    </Dialog>
  );
}

// --- Settings --------------------------------------------------------------------------------------

function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="gs-setting">
      <span className="gs-setting__label">{label}</span>
      <div className="gs-segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className="gs-btn"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="gs-setting">
      <span className="gs-setting__label">
        {label}
        {hint && <span className="gs-setting__hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`gs-switch${value ? ' is-on' : ''}`}
        onClick={() => onChange(!value)}
      >
        <span className="gs-switch__knob" aria-hidden="true" />
      </button>
    </div>
  );
}

function Slider({
  label,
  low,
  high,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="gs-setting gs-setting--slider">
      <label className="gs-setting__label" htmlFor={id}>
        {label}
      </label>
      <div className="gs-slider">
        <span className="gs-muted">{low}</span>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="gs-muted">{high}</span>
      </div>
    </div>
  );
}

const QUALITY: readonly { value: QualityPreset; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const RATES: readonly { value: InferenceRate; label: string }[] = [
  { value: 15, label: '15 / s' },
  { value: 30, label: '30 / s' },
  { value: 60, label: '60 / s' },
];
const RESOLUTIONS: readonly { value: CameraResolution; label: string }[] = [
  { value: '480p', label: '640×480' },
  { value: '720p', label: '1280×720' },
  { value: '1080p', label: '1920×1080' },
];

/** Settings (⚙): every change applies at once and is remembered in this browser (§21.8). */
export function SettingsPanel() {
  const open = useAppStore((s) => s.settingsOpen);
  const s = useAppStore((st) => st.settings);
  const update = useAppStore((st) => st.updateSettings);
  const reset = useAppStore((st) => st.resetSettings);
  const toggle = useAppStore((st) => st.toggleSettings);
  const openOnboarding = useAppStore((st) => st.openOnboarding);
  const cameraOn = useAppStore((st) => st.cameraStatus === 'running');
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    if (open) void listCameras().then(setCameras);
  }, [open, cameraOn]);

  if (!open) return null;
  const set =
    <K extends keyof Settings>(key: K) =>
    (value: Settings[K]) =>
      update({ [key]: value });
  const range = TUNING.settings.sensitivity;

  return (
    <Dialog title="Settings" onClose={toggle} wide>
      <div className="gs-settings">
        <section>
          <h3 className="gs-toolpanel__sub">Hands</h3>
          <Choice
            label="Main hand (builds, draws, picks)"
            value={s.dominant}
            options={[
              { value: 'right', label: 'Right' },
              { value: 'left', label: 'Left' },
            ]}
            onChange={set('dominant')}
          />
          <Toggle
            label="Swap left / right"
            hint="If your right hand shows as “Left” — some cameras already mirror their picture"
            value={s.swapHands}
            onChange={set('swapHands')}
          />
          <Toggle label="Mirror view" value={s.mirror} onChange={set('mirror')} />
          <Toggle
            label="Show the hand skeleton"
            value={s.showSkeleton}
            onChange={set('showSkeleton')}
          />

          <h3 className="gs-toolpanel__sub">Feel</h3>
          <Slider
            label="Smoothing"
            low="Quick"
            high="Steady"
            min={0}
            max={1}
            step={0.05}
            value={s.smoothing}
            onChange={set('smoothing')}
          />
          <Slider
            label="Pinch sensitivity"
            low="Fingers must touch"
            high="Early"
            min={0}
            max={1}
            step={0.05}
            value={s.pinchSensitivity}
            onChange={set('pinchSensitivity')}
          />
          <Slider
            label={`Turning: ×${s.turnSensitivity.toFixed(2)}`}
            low="Less"
            high="More"
            min={range.min}
            max={range.max}
            step={0.05}
            value={s.turnSensitivity}
            onChange={set('turnSensitivity')}
          />
          <Slider
            label={`Resizing: ×${s.scaleSensitivity.toFixed(2)}`}
            low="Less"
            high="More"
            min={range.min}
            max={range.max}
            step={0.05}
            value={s.scaleSensitivity}
            onChange={set('scaleSensitivity')}
          />
        </section>
        <section>
          <h3 className="gs-toolpanel__sub">Camera and speed</h3>
          <div className="gs-setting">
            <label className="gs-setting__label" htmlFor="gs-camera-device">
              Camera
            </label>
            <select
              id="gs-camera-device"
              className="gs-select"
              value={s.cameraDeviceId}
              onChange={(e) => update({ cameraDeviceId: e.target.value })}
            >
              <option value="">Default camera</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <Choice
            label="Camera resolution"
            value={s.cameraResolution}
            options={RESOLUTIONS}
            onChange={set('cameraResolution')}
          />
          <Choice
            label="Hand tracking"
            value={s.inferenceHz}
            options={RATES}
            onChange={set('inferenceHz')}
          />
          <Choice label="Quality" value={s.quality} options={QUALITY} onChange={set('quality')} />
          <Toggle
            label="Reduce motion"
            hint="No pop-in or opening animations"
            value={s.reduceMotion}
            onChange={set('reduceMotion')}
          />

          <h3 className="gs-toolpanel__sub">Voxel Builder</h3>
          <Toggle
            label="Depth Lock on at start"
            value={s.depthLockDefault}
            onChange={set('depthLockDefault')}
          />
          <p className="gs-muted">
            Changes apply at once and are remembered in this browser. Low quality or a slower
            tracking rate help on slower laptops.
          </p>
          <div className="gs-dialog__actions">
            <button type="button" className="gs-btn" onClick={openOnboarding}>
              Show the walkthrough again
            </button>
            <button type="button" className="gs-btn gs-btn--danger" onClick={reset}>
              Reset all settings
            </button>
          </div>
        </section>
      </div>
    </Dialog>
  );
}

// --- the first-run walkthrough ---------------------------------------------------------------------

const STEPS: readonly OnboardingStep[] = ['welcome', 'hand', 'pinch', 'spread', 'done'];

const COPY: Record<OnboardingStep, { title: string; text: string; ok?: string }> = {
  welcome: {
    title: 'Your hands are the controller',
    text: 'GestureSpace follows your hands through the camera. Everything stays on this computer: nothing is recorded or sent anywhere.',
  },
  hand: {
    title: 'Show your right hand',
    text: 'Hold your right hand up inside the frame, palm towards the camera, about an arm’s length away.',
    ok: 'Right hand found',
  },
  pinch: {
    title: 'Pinch',
    text: 'Touch your thumb tip to your index fingertip. That’s how you grab, place and pick things.',
    ok: 'Pinch detected',
  },
  spread: {
    title: 'Now both hands',
    text: 'Pinch with both hands, then pull them apart. That’s how you stretch and turn things.',
    ok: 'Two-hand stretch detected',
  },
  done: {
    title: 'You’re ready',
    text: 'Start with the Voxel Builder, or look around all seven experiences. Help (H) shows the gestures of each one.',
  },
};

/** The walkthrough (§21.4): opens by itself the first time the camera runs; skippable. */
export function Onboarding() {
  const open = useAppStore((s) => s.onboardingOpen);
  return open ? <OnboardingCard /> : null; // mounted fresh each time it opens
}

function OnboardingCard() {
  const close = useAppStore((s) => s.closeOnboarding);
  const cameraOn = useAppStore((s) => s.cameraStatus === 'running');
  const setActiveMode = useAppStore((s) => s.setActiveMode);
  const swapHands = useAppStore((s) => s.settings.swapHands);
  const update = useAppStore((s) => s.updateSettings);
  // With the camera already on, start at "show your hand".
  const [step, setStep] = useState<OnboardingStep>(() =>
    useAppStore.getState().cameraStatus === 'running' ? 'hand' : 'welcome',
  );
  const [met, setMet] = useState(false);
  const [swapHint, setSwapHint] = useState(false);
  const hintDismissed = useRef(false);

  // Watch the hands a few times a second (never per frame through React, §2 rule 3).
  useEffect(() => {
    if (step === 'welcome' || step === 'done' || met) return;
    let since = -1;
    let leftSince = -1;
    const id = setInterval(() => {
      const snap = onboardingSnapshot();
      if (!snap) return;
      const now = performance.now();
      if (stepMet(step, snap)) {
        if (since < 0) since = now;
        if (now - since >= O.holdMs) setMet(true);
      } else since = -1;
      if (step === 'hand' && onlyLeftSeen(snap) && !hintDismissed.current) {
        if (leftSince < 0) leftSince = now;
        if (now - leftSince >= O.wrongHandMs) setSwapHint(true);
      } else leftSince = -1;
    }, 100);
    return () => clearInterval(id);
  }, [step, met]);

  // ✓ → the next step after a moment.
  useEffect(() => {
    if (!met) return;
    const t = setTimeout(() => {
      setStep((s) => STEPS[STEPS.indexOf(s) + 1] ?? 'done');
      setMet(false);
      setSwapHint(false);
    }, O.advanceMs);
    return () => clearTimeout(t);
  }, [met]);

  const copy = COPY[step];
  const index = STEPS.indexOf(step);
  const next = (): void => setStep(STEPS[index + 1] ?? 'done');

  return (
    <div className="gs-onboard">
      {(step === 'hand' || step === 'pinch' || step === 'spread') && (
        <div className={`gs-onboard__frame${met ? ' is-met' : ''}`} aria-hidden="true" />
      )}
      <section
        className="gs-panel gs-onboard__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gs-onboard-title"
      >
        <p className="gs-onboard__step">
          Step {index + 1} of {STEPS.length}
        </p>
        <h2 id="gs-onboard-title" className="gs-onboard__title">
          {copy.title}
        </h2>
        <p className="gs-onboard__text">{copy.text}</p>
        {copy.ok && (
          <p
            className={`gs-onboard__check${met ? ' is-met' : ''}`}
            role="status"
            aria-live="polite"
          >
            {met ? `✓ ${copy.ok}` : 'Waiting for your hand…'}
          </p>
        )}
        {swapHint && !met && (
          <div className="gs-onboard__hint" role="alert">
            <p>
              The app sees a <strong>left</strong> hand. If this is your right hand, your camera
              names hands the other way round.
            </p>
            <div className="gs-dialog__actions">
              <button
                type="button"
                className="gs-btn gs-btn--primary"
                onClick={() => {
                  update({ swapHands: !swapHands });
                  setSwapHint(false);
                }}
              >
                It’s my right hand — swap left / right
              </button>
              <button
                type="button"
                className="gs-btn"
                onClick={() => {
                  hintDismissed.current = true;
                  setSwapHint(false);
                }}
              >
                No, that was my left hand
              </button>
            </div>
          </div>
        )}
        <div className="gs-dialog__actions">
          {step === 'welcome' && !cameraOn && (
            <button type="button" className="gs-btn gs-btn--primary" onClick={startCamera}>
              Enable camera
            </button>
          )}
          {step === 'welcome' && cameraOn && (
            <button type="button" className="gs-btn gs-btn--primary" onClick={next}>
              Next
            </button>
          )}
          {step === 'done' ? (
            <>
              <button
                type="button"
                className="gs-btn gs-btn--primary"
                onClick={() => {
                  setActiveMode('voxel');
                  close();
                }}
              >
                Start the Voxel Builder
              </button>
              <button type="button" className="gs-btn" onClick={close}>
                Explore all experiences
              </button>
            </>
          ) : (
            <>
              {step !== 'welcome' && !met && (
                <button type="button" className="gs-btn" onClick={next}>
                  Skip this step
                </button>
              )}
              <button type="button" className="gs-btn gs-btn--ghost" onClick={close}>
                Skip the walkthrough
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
