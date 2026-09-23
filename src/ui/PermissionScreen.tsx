// Camera UI states (§21.3): pre-permission, requesting, denied/error (incl. no camera, camera in
// use, insecure context, unsupported browser, disconnected) and stopped. Hidden while running.

import { startCamera } from '@/app/bootstrap';
import type { CameraErrorKind } from '@/core/camera';
import { useAppStore } from '@/state/appStore';

const ERROR_COPY: Record<CameraErrorKind, { title: string; help: string; retry: boolean }> = {
  denied: {
    title: 'Camera access was blocked',
    help: 'Click the camera icon in the address bar, choose “Allow”, then press Retry.',
    retry: true,
  },
  notFound: {
    title: 'No camera found',
    help: 'Connect a webcam (or enable it in your OS privacy settings) and press Retry.',
    retry: true,
  },
  inUse: {
    title: 'Your camera is busy',
    help: 'Another app (Zoom, Teams, OBS, another tab…) is using it. Close that app and press Retry.',
    retry: true,
  },
  insecure: {
    title: 'A secure connection is required',
    help: 'Browsers only allow the camera on https:// or http://localhost. Open the app that way.',
    retry: false,
  },
  unsupported: {
    title: 'This browser can’t run GestureSpace',
    help: 'Use a recent Chrome or Edge on desktop — it needs camera access, WebGL2 and WebAssembly.',
    retry: false,
  },
  ended: {
    title: 'The camera disconnected',
    help: 'It was unplugged, access was revoked, or another app took it. Reconnect and press Retry.',
    retry: true,
  },
  unknown: {
    title: 'The camera couldn’t start',
    help: 'Something unexpected went wrong. Press Retry, or reload the page.',
    retry: true,
  },
};

function PrivacyNote() {
  return (
    <ul className="gs-perm__privacy">
      <li>Video is processed locally in your browser — nothing is uploaded or recorded.</li>
      <li>A red “● Camera on” indicator shows whenever the camera is active.</li>
      <li>Stop it any time with “Stop cam”.</li>
    </ul>
  );
}

export function PermissionScreen() {
  const status = useAppStore((s) => s.cameraStatus);
  const error = useAppStore((s) => s.cameraError);

  if (status === 'running' || status === 'loading') return null;

  let body;
  if (status === 'requesting') {
    body = (
      <>
        <div className="gs-spinner" aria-hidden="true" />
        <h1 className="gs-perm__title">Waiting for camera permission…</h1>
        <p className="gs-perm__text">Choose “Allow” in your browser’s prompt.</p>
      </>
    );
  } else if (status === 'error' && error) {
    const copy = ERROR_COPY[error.kind];
    body = (
      <>
        <div className="gs-perm__icon is-error" aria-hidden="true">
          !
        </div>
        <h1 className="gs-perm__title">{copy.title}</h1>
        <p className="gs-perm__text">{copy.help}</p>
        {copy.retry && (
          <button type="button" className="gs-btn gs-btn--primary" onClick={startCamera}>
            Retry
          </button>
        )}
        <details className="gs-perm__details">
          <summary>Technical details</summary>
          <code>
            {error.kind}: {error.message}
          </code>
        </details>
      </>
    );
  } else if (status === 'stopped') {
    body = (
      <>
        <div className="gs-perm__icon" aria-hidden="true" />
        <h1 className="gs-perm__title">Camera stopped</h1>
        <p className="gs-perm__text">Everything is paused. Your creations are kept.</p>
        <button type="button" className="gs-btn gs-btn--primary" onClick={startCamera}>
          Start camera
        </button>
      </>
    );
  } else {
    body = (
      <>
        <div className="gs-perm__icon" aria-hidden="true" />
        <h1 className="gs-perm__title">Your hands are the controller</h1>
        <p className="gs-perm__text">
          GestureSpace uses your webcam to track your hands so you can build, draw and shape things
          in the air.
        </p>
        <button type="button" className="gs-btn gs-btn--primary" onClick={startCamera} autoFocus>
          Enable camera
        </button>
        <PrivacyNote />
      </>
    );
  }

  return (
    <div className="gs-perm" role="dialog" aria-modal="false" aria-label="Camera">
      <div className="gs-panel gs-perm__card">{body}</div>
    </div>
  );
}
