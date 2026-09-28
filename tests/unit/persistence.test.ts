// Keeping things between visits (Phase 12, §22): settings in (fake) localStorage — versioned, each
// field checked — scene files, scene storage and the debounced autosave.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, TUNING } from '@/config/tuning';
import {
  Autosaver,
  loadSettings,
  makeSceneFile,
  onboardingDone,
  parseSceneFile,
  readScene,
  saveSettings,
  sceneFileName,
  sceneKey,
  setOnboardingDone,
  validateSettings,
  writeScene,
  type KeyValueStorage,
  type SceneStore,
} from '@/state/persistence';

const P = TUNING.persistence;

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function memoryScenes(): SceneStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, structuredClone(v)),
  };
}

describe('settings', () => {
  it('saves and loads every field; nothing saved → the defaults', () => {
    const storage = memoryStorage();
    expect(loadSettings(storage, false)).toEqual(DEFAULT_SETTINGS);
    const mine = {
      ...DEFAULT_SETTINGS,
      dominant: 'left' as const,
      mirror: false,
      smoothing: 0.3,
      inferenceHz: 15 as const,
      quality: 'low' as const,
      pinchSensitivity: 0.8,
      turnSensitivity: 1.5,
      scaleSensitivity: 0.75,
      cameraResolution: '1080p' as const,
      cameraDeviceId: 'abc123',
      swapHands: true,
      reduceMotion: true,
    };
    saveSettings(mine, storage);
    expect(loadSettings(storage, false)).toEqual(mine);
  });

  it('reduce motion starts from the system setting until the user sets it', () => {
    const storage = memoryStorage();
    expect(loadSettings(storage, true).reduceMotion).toBe(true);
    saveSettings({ ...DEFAULT_SETTINGS, reduceMotion: false }, storage);
    expect(loadSettings(storage, true).reduceMotion).toBe(false);
  });

  it('each broken or out-of-range field falls back to its default; the rest is kept', () => {
    const got = validateSettings({
      dominant: 'middle',
      mirror: 'yes',
      smoothing: 3,
      inferenceHz: 45,
      quality: 'ultra',
      pinchSensitivity: -1,
      turnSensitivity: 99,
      scaleSensitivity: NaN,
      cameraResolution: '4k',
      cameraDeviceId: 'x'.repeat(300),
      swapHands: 1,
      showSkeleton: false, // valid: kept
      unknown: 'ignored',
    });
    expect(got).toEqual({ ...DEFAULT_SETTINGS, showSkeleton: false });
  });

  it('another version, broken JSON or a non-object → the defaults', () => {
    const storage = memoryStorage();
    storage.setItem(P.settingsKey, JSON.stringify({ version: 99, settings: { dominant: 'left' } }));
    expect(loadSettings(storage, false)).toEqual(DEFAULT_SETTINGS);
    storage.setItem(P.settingsKey, '{not json');
    expect(loadSettings(storage, false)).toEqual(DEFAULT_SETTINGS);
    storage.setItem(P.settingsKey, '42');
    expect(loadSettings(storage, false)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null, false)).toEqual(DEFAULT_SETTINGS); // no storage at all
  });

  it('a storage that throws never breaks the app', () => {
    const angry: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSettings(angry, false)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, angry)).not.toThrow();
    expect(onboardingDone(angry)).toBe(false);
    expect(() => setOnboardingDone(true, angry)).not.toThrow();
  });

  it('remembers that the walkthrough was done (and can forget it)', () => {
    const storage = memoryStorage();
    expect(onboardingDone(storage)).toBe(false);
    setOnboardingDone(true, storage);
    expect(onboardingDone(storage)).toBe(true);
    setOnboardingDone(false, storage);
    expect(onboardingDone(storage)).toBe(false);
  });
});

describe('scene files', () => {
  it('round trip: made, sent through JSON, read back', () => {
    const file = makeSceneFile('voxel', { v: 1, cells: [0, 0, 0, 1, 0] }, new Date(0));
    expect(parseSceneFile(JSON.parse(JSON.stringify(file)))).toEqual({
      mode: 'voxel',
      data: { v: 1, cells: [0, 0, 0, 1, 0] },
    });
    expect(sceneFileName('objectLab', new Date(Date.UTC(2026, 8, 28, 14, 5)))).toBe(
      'gesturespace-objectLab-202609281405.json',
    );
  });

  it('says clearly what is wrong with a bad file', () => {
    const ok = makeSceneFile('draw', { v: 1, strokes: [] });
    const bad = (patch: Record<string, unknown>): string | undefined => {
      const r = parseSceneFile({ ...ok, ...patch });
      return 'error' in r ? r.error : undefined;
    };
    expect(parseSceneFile('hello')).toEqual({ error: 'This is not a GestureSpace file.' });
    expect(bad({ app: 'Other' })).toMatch(/not a GestureSpace scene/);
    expect(bad({ kind: 'fixture' })).toMatch(/not a GestureSpace scene/);
    expect(bad({ version: 7 })).toMatch(/version 7/);
    expect(bad({ mode: 'tetris' })).toMatch(/unknown experience/);
    expect(bad({ data: undefined })).toMatch(/empty/);
  });

  it('stored scenes: read back per experience and slot; another experience’s file is ignored', async () => {
    const store = memoryScenes();
    expect(await writeScene(store, 'saved', 'panel', { v: 1 })).toBe(true);
    expect(await readScene(store, 'saved', 'panel')).toEqual({ v: 1 });
    expect(await readScene(store, 'autosave', 'panel')).toBeNull();
    store.data.set(sceneKey('saved', 'portal'), makeSceneFile('panel', { v: 1 }));
    expect(await readScene(store, 'saved', 'portal')).toBeNull();
    expect(await readScene(null, 'saved', 'panel')).toBeNull();
    expect(await writeScene(null, 'saved', 'panel', {})).toBe(false);
  });
});

describe('Autosaver', () => {
  afterEach(() => void vi.useRealTimers());

  it('saves one second after the last change; nothing before the old autosave was read', async () => {
    vi.useFakeTimers();
    const store = memoryScenes();
    let content = 1;
    const saver = new Autosaver(store, () => ({ v: 1, content }));
    const key = sceneKey('autosave', 'voxel');

    saver.touch('voxel'); // not restored yet: ignored (it would overwrite the old autosave)
    await vi.advanceTimersByTimeAsync(P.autosaveDebounceMs * 2);
    expect(store.data.has(key)).toBe(false);

    expect(await saver.restore('voxel')).toBeNull();
    saver.touch('voxel');
    await vi.advanceTimersByTimeAsync(P.autosaveDebounceMs * 0.6);
    content = 2;
    saver.touch('voxel'); // pushes the save back
    await vi.advanceTimersByTimeAsync(P.autosaveDebounceMs * 0.6);
    expect(store.data.has(key)).toBe(false);
    await vi.advanceTimersByTimeAsync(P.autosaveDebounceMs * 0.5);
    expect(await readScene(store, 'autosave', 'voxel')).toEqual({ v: 1, content: 2 });
    expect(await saver.restore('voxel')).toEqual({ v: 1, content: 2 });
    saver.dispose();
  });

  it('a change made while the old autosave is still being read is saved after the read', async () => {
    vi.useFakeTimers();
    const store = memoryScenes();
    let release: () => void = () => {};
    const slowStore: SceneStore = {
      get: (k) =>
        new Promise((resolve) => {
          release = () => resolve(store.data.get(k)); // a slow first IndexedDB read
        }),
      set: store.set,
    };
    const saver = new Autosaver(slowStore, () => ({ v: 1, items: 3 }));
    const restoring = saver.restore('objectLab');
    saver.touch('objectLab'); // the user makes three shapes meanwhile
    await vi.advanceTimersByTimeAsync(P.autosaveDebounceMs * 2);
    expect(store.data.size).toBe(0); // nothing written over the unread autosave…
    release();
    await restoring;
    await vi.advanceTimersByTimeAsync(P.autosaveDebounceMs);
    expect(await readScene(store, 'autosave', 'objectLab')).toEqual({ v: 1, items: 3 }); // …not lost
    saver.dispose();
  });

  it('flush saves what is waiting at once; an experience with nothing to keep saves nothing', async () => {
    const store = memoryScenes();
    const saver = new Autosaver(store, (id) => (id === 'draw' ? { v: 1, strokes: [] } : undefined));
    await saver.restore('draw');
    await saver.restore('strings');
    saver.touch('draw');
    saver.touch('strings');
    await saver.flush();
    expect(store.data.has(sceneKey('autosave', 'draw'))).toBe(true);
    expect(store.data.has(sceneKey('autosave', 'strings'))).toBe(false);
    saver.dispose();
  });
});
