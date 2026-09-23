import { describe, expect, it } from 'vitest';
import { resolveKeyAction, type KeyInput } from '@/config/keybindings';
import { TUNING } from '@/config/tuning';
import { MODE_IDS } from '@/core/types';
import { MODE_LIST, MODE_META } from '@/modes/registry';

const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('tuning', () => {
  it('uses hysteresis (start threshold below end threshold)', () => {
    const g = TUNING.gestures;
    expect(g.pinch.start).toBeLessThan(g.pinch.end);
    expect(g.grab.start).toBeLessThan(g.grab.end);
    expect(g.thumbPinky.start).toBeLessThan(g.thumbPinky.end);
  });

  it('depth weights sum to 1', () => {
    expect(TUNING.depth.W_PALM + TUNING.depth.W_MPZ).toBeCloseTo(1);
  });
});

describe('mode registry', () => {
  it('exposes all seven experiences with unique hotkeys 1–7', () => {
    expect(MODE_LIST).toHaveLength(7);
    expect(MODE_LIST.map((m) => m.id)).toEqual([...MODE_IDS]);
    expect(MODE_LIST.map((m) => m.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    for (const id of MODE_IDS) expect(MODE_META[id].help.length).toBeGreaterThan(0);
  });
});

describe('keybindings', () => {
  it('maps number keys to modes', () => {
    expect(resolveKeyAction(key('1'))).toEqual({ type: 'mode', mode: 'voxel' });
    expect(resolveKeyAction(key('7'))).toEqual({ type: 'mode', mode: 'objectLab' });
    expect(resolveKeyAction(key('8'))).toBeNull();
  });

  it('maps undo/redo with Ctrl or Cmd', () => {
    expect(resolveKeyAction(key('z', { ctrlKey: true }))).toEqual({ type: 'undo' });
    expect(resolveKeyAction(key('Z', { metaKey: true, shiftKey: true }))).toEqual({
      type: 'redo',
    });
  });

  it('ignores plain keys when a modifier is held', () => {
    expect(resolveKeyAction(key('c', { ctrlKey: true }))).toBeNull();
  });

  it('maps filter and depth keys', () => {
    expect(resolveKeyAction(key('ArrowRight'))).toEqual({ type: 'filterNext' });
    expect(resolveKeyAction(key('['))).toEqual({ type: 'filterPrev' });
    expect(resolveKeyAction(key('E'))).toEqual({ type: 'depthUp' });
    expect(resolveKeyAction(key('q'))).toEqual({ type: 'depthDown' });
  });
});
