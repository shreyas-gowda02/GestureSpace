// Vision Web Worker: runs the ONE MediaPipe HandLandmarker off the main thread so a slow inference
// can never stall rendering (see vision/workerTracker.ts for the protocol). Created exactly once
// by Core; loads MediaPipe's ES-module WASM build (module workers have no importScripts()).

import { HandTracker } from '@/vision/HandTracker';
import { packResult, type FromWorker, type ToWorker } from '@/vision/workerTracker';

const tracker = new HandTracker({ moduleWasm: true });

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer });
}

tracker.onChange((t) =>
  post({
    type: 'status',
    status: t.status,
    delegate: t.delegate,
    error: t.error,
    loadMs: t.loadMs,
  }),
);

self.addEventListener('message', (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'load':
      void tracker.load();
      break;
    case 'detect': {
      const { frame, ts, gen, buffer } = msg;
      let ms = 0;
      try {
        if (tracker.ready) {
          const t0 = performance.now();
          const result = tracker.detect(frame, ts);
          ms = performance.now() - t0;
          packResult(result, buffer);
        } else {
          buffer[0] = 0;
        }
      } catch (err) {
        buffer[0] = 0;
        console.error('[gs:vision-worker] detect failed', err);
      } finally {
        frame.close();
      }
      post({ type: 'result', ts, gen, ms, buffer }, [buffer.buffer]);
      break;
    }
    case 'dispose':
      tracker.dispose();
      self.close();
      break;
  }
});
