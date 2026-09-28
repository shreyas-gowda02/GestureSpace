// Keeping things between visits (§22):
//  • Settings → localStorage, versioned. Anything unknown, broken or out of range falls back to its
//    default; a different version resets them (there is no older version to migrate yet).
//  • Scenes → IndexedDB (idb-keyval): each experience's autosave (1 s after the last change) and one
//    "Save" slot; JSON files to export / import. Experiences leave camera frames out of their scene
//    data, so none are ever stored.
// Storage can be missing or refuse (private windows, full disk): every call here then quietly does
// nothing and the app carries on with defaults.

import { get, set } from 'idb-keyval';
import { DEFAULT_SETTINGS, TUNING } from '@/config/tuning';
import { MODE_IDS, type ModeId, type Settings } from '@/core/types';
import { createLogger } from '@/utils/logger';

const P = TUNING.persistence;
const log = createLogger('persistence');

/** The part of the Web Storage API used here (a Map-backed fake in tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // e.g. storage blocked by the browser
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

// --- settings --------------------------------------------------------------------------------

const oneOf = <T>(v: unknown, options: readonly T[]): v is T => options.includes(v as T);
const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

const RESOLUTIONS = Object.keys(TUNING.camera.resolutions) as Settings['cameraResolution'][];

/** Settings from untrusted JSON: each valid field is kept, anything else takes `base`'s value. */
export function validateSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const S = TUNING.settings.sensitivity;
  if (oneOf(r.dominant, ['left', 'right'] as const)) out.dominant = r.dominant;
  if (isBool(r.mirror)) out.mirror = r.mirror;
  if (inRange(r.smoothing, 0, 1)) out.smoothing = r.smoothing;
  if (isBool(r.showSkeleton)) out.showSkeleton = r.showSkeleton;
  if (oneOf(r.inferenceHz, [15, 30, 60] as const)) out.inferenceHz = r.inferenceHz;
  if (oneOf(r.quality, ['low', 'medium', 'high'] as const)) out.quality = r.quality;
  if (isBool(r.depthLockDefault)) out.depthLockDefault = r.depthLockDefault;
  if (inRange(r.pinchSensitivity, 0, 1)) out.pinchSensitivity = r.pinchSensitivity;
  if (inRange(r.turnSensitivity, S.min, S.max)) out.turnSensitivity = r.turnSensitivity;
  if (inRange(r.scaleSensitivity, S.min, S.max)) out.scaleSensitivity = r.scaleSensitivity;
  if (oneOf(r.cameraResolution, RESOLUTIONS)) out.cameraResolution = r.cameraResolution;
  if (typeof r.cameraDeviceId === 'string' && r.cameraDeviceId.length <= 256) {
    out.cameraDeviceId = r.cameraDeviceId;
  }
  if (isBool(r.swapHands)) out.swapHands = r.swapHands;
  if (isBool(r.reduceMotion)) out.reduceMotion = r.reduceMotion;
  return out;
}

/** The saved settings, or the defaults (reduce motion follows the system until it is set). */
export function loadSettings(
  storage: KeyValueStorage | null = browserStorage(),
  systemReduceMotion: boolean = prefersReducedMotion(),
): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS, reduceMotion: systemReduceMotion };
  try {
    const text = storage?.getItem(P.settingsKey);
    if (!text) return base;
    const saved: unknown = JSON.parse(text);
    if (typeof saved !== 'object' || saved === null) return base;
    const env = saved as { version?: unknown; settings?: unknown };
    if (env.version !== P.settingsVersion) return base;
    return validateSettings(env.settings, base);
  } catch {
    return base;
  }
}

export function saveSettings(
  settings: Settings,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(P.settingsKey, JSON.stringify({ version: P.settingsVersion, settings }));
  } catch (err) {
    log.warn('settings not saved', err);
  }
}

export function clearSettings(storage: KeyValueStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(P.settingsKey);
  } catch {
    // nothing to do
  }
}

/** Has the first-run walkthrough been finished or skipped? */
export function onboardingDone(storage: KeyValueStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(P.onboardingKey) === '1';
  } catch {
    return false;
  }
}

export function setOnboardingDone(
  done: boolean,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  try {
    if (done) storage?.setItem(P.onboardingKey, '1');
    else storage?.removeItem(P.onboardingKey);
  } catch {
    // the walkthrough just shows again next time
  }
}

// --- scene files -------------------------------------------------------------------------------

/** One experience's content, as stored and exported. */
export interface SceneFile {
  app: 'GestureSpace';
  kind: 'scene';
  version: number;
  mode: ModeId;
  savedAt: string;
  data: unknown;
}

export function makeSceneFile(mode: ModeId, data: unknown, now: Date = new Date()): SceneFile {
  return {
    app: 'GestureSpace',
    kind: 'scene',
    version: P.sceneVersion,
    mode,
    savedAt: now.toISOString(),
    data,
  };
}

/** Check an (untrusted) scene file; the experience then checks `data` itself. */
export function parseSceneFile(raw: unknown): { mode: ModeId; data: unknown } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'This is not a GestureSpace file.' };
  const f = raw as Partial<Record<keyof SceneFile, unknown>>;
  if (f.app !== 'GestureSpace' || f.kind !== 'scene') {
    return { error: 'This is not a GestureSpace scene file.' };
  }
  if (f.version !== P.sceneVersion) {
    return {
      error: `This scene file is version ${String(f.version)}; this app reads version ${P.sceneVersion}.`,
    };
  }
  if (!oneOf(f.mode, MODE_IDS)) return { error: 'This scene file is for an unknown experience.' };
  if (f.data === undefined) return { error: 'This scene file is empty.' };
  return { mode: f.mode, data: f.data };
}

export function sceneFileName(mode: ModeId, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `gesturespace-${mode}-${stamp}.json`;
}

/** Offer a scene file as a download (browser only). */
export function downloadSceneFile(file: SceneFile, now: Date = new Date()): void {
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sceneFileName(file.mode, now);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- scene storage -----------------------------------------------------------------------------

/** Where scenes are kept: IndexedDB in the browser, a Map in tests. */
export interface SceneStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export function browserSceneStore(): SceneStore | null {
  if (typeof indexedDB === 'undefined') return null;
  return { get: (key) => get(key), set: (key, value) => set(key, value) };
}

export const sceneKey = (slot: 'autosave' | 'saved', mode: ModeId): string =>
  `${P.scenePrefix}${slot}:${mode}`;

/** A stored scene's data for `mode`, or null (none, unreadable, another experience's). */
export async function readScene(
  store: SceneStore | null,
  slot: 'autosave' | 'saved',
  mode: ModeId,
): Promise<unknown> {
  if (!store) return null;
  try {
    const raw = await store.get(sceneKey(slot, mode));
    if (raw === undefined || raw === null) return null;
    const parsed = parseSceneFile(raw);
    return 'error' in parsed || parsed.mode !== mode ? null : parsed.data;
  } catch (err) {
    log.warn(`scene not read (${slot}:${mode})`, err);
    return null;
  }
}

export async function writeScene(
  store: SceneStore | null,
  slot: 'autosave' | 'saved',
  mode: ModeId,
  data: unknown,
): Promise<boolean> {
  if (!store) return false;
  try {
    await store.set(sceneKey(slot, mode), makeSceneFile(mode, data));
    return true;
  } catch (err) {
    log.warn(`scene not saved (${slot}:${mode})`, err);
    return false;
  }
}

/**
 * Autosave: `touch(mode)` after a change saves that experience's scene `delayMs` later (another
 * change pushes it back); `flush()` saves at once (switching away, leaving the page). A change made
 * before the experience's earlier autosave has been read back (`restore`) is saved only after that
 * read, so a slow read is never overwritten unread — and the change isn't lost either.
 */
export class Autosaver {
  private readonly store: SceneStore | null;
  private readonly read: (mode: ModeId) => unknown;
  private readonly delayMs: number;
  private readonly timers = new Map<ModeId, ReturnType<typeof setTimeout>>();
  private readonly ready = new Set<ModeId>();
  /** Changed before its old autosave was read back: saved once it has been. */
  private readonly waiting = new Set<ModeId>();

  /** `read(mode)` = the experience's scene data now (undefined = nothing to save). */
  constructor(
    store: SceneStore | null,
    read: (mode: ModeId) => unknown,
    delayMs: number = P.autosaveDebounceMs,
  ) {
    this.store = store;
    this.read = read;
    this.delayMs = delayMs;
  }

  /** The experience's last autosave (null if none); after this, its changes are saved. */
  async restore(mode: ModeId): Promise<unknown> {
    try {
      return await readScene(this.store, 'autosave', mode);
    } finally {
      this.ready.add(mode);
      if (this.waiting.delete(mode)) this.touch(mode);
    }
  }

  touch(mode: ModeId): void {
    if (!this.store) return;
    if (!this.ready.has(mode)) {
      this.waiting.add(mode); // saved once the old autosave has been read (never over it unread)
      return;
    }
    const t = this.timers.get(mode);
    if (t !== undefined) clearTimeout(t);
    this.timers.set(
      mode,
      setTimeout(() => void this.save(mode), this.delayMs),
    );
  }

  /** Save now whatever is waiting (one experience, or all of them). */
  async flush(mode?: ModeId): Promise<void> {
    const modes = mode ? [mode] : [...this.timers.keys()];
    await Promise.all(modes.filter((m) => this.timers.has(m)).map((m) => this.save(m)));
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private async save(mode: ModeId): Promise<void> {
    const t = this.timers.get(mode);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(mode);
    const data = this.read(mode);
    if (data !== undefined) await writeScene(this.store, 'autosave', mode, data);
  }
}
