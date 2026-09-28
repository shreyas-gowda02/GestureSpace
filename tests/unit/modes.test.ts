import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Command, InteractionFrame, ModeId } from '@/core/types';
import { MODE_IDS } from '@/core/types';
import { ModeController } from '@/modes/ModeController';
import { MODE_FACTORIES } from '@/modes/registry';
import { CommandHistory } from '@/modes/shared/history';
import type { ModeContext, SpatialMode } from '@/modes/types';
import { baseContext } from '../fixtures/modeHarness';

describe('CommandHistory', () => {
  const counter = () => {
    const state = { n: 0 };
    const inc: Command = { label: 'inc', do: () => void state.n++, undo: () => void state.n-- };
    return { state, inc };
  };

  it('executes, undoes and redoes; a new command clears redo', () => {
    const h = new CommandHistory();
    const { state, inc } = counter();
    h.execute(inc);
    h.execute(inc);
    expect(state.n).toBe(2);
    expect(h.undo()).toBe(true);
    expect(state.n).toBe(1);
    expect(h.canRedo).toBe(true);
    h.redo();
    expect(state.n).toBe(2);
    h.undo();
    h.execute(inc);
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe('inc');
  });

  it('caps its size and notifies listeners', () => {
    const h = new CommandHistory(3);
    const { state, inc } = counter();
    let events = 0;
    h.onChange(() => events++);
    for (let i = 0; i < 5; i++) h.execute(inc);
    let undos = 0;
    while (h.undo()) undos++;
    expect(undos).toBe(3);
    expect(state.n).toBe(2);
    expect(events).toBe(8);
    expect(h.undo()).toBe(false);
  });
});

/** Records its lifecycle calls. */
class SpyMode implements SpatialMode {
  readonly calls: string[] = [];
  history: CommandHistory | null = null;
  readonly id: ModeId;
  constructor(id: ModeId) {
    this.id = id;
  }
  enter(ctx: ModeContext): void {
    this.history = ctx.history;
    this.calls.push('enter');
  }
  update(): void {
    this.calls.push('update');
  }
  reset(): void {
    this.calls.push('reset');
  }
  exit(): void {
    this.calls.push('exit');
  }
  dispose(): void {
    this.calls.push('dispose');
  }
}

function spyController() {
  const spies = new Map<ModeId, SpyMode>();
  const factories = Object.fromEntries(
    MODE_IDS.map((id) => [
      id,
      () => {
        const m = new SpyMode(id);
        spies.set(id, m);
        return m;
      },
    ]),
  ) as unknown as Record<ModeId, () => SpatialMode>;
  const base = baseContext();
  return { mc: new ModeController(base, factories), spies, base };
}

describe('ModeController', () => {
  it('exits the old mode (releasing every capture) before entering the new one', () => {
    const { mc, spies, base } = spyController();
    const released: string[] = [];
    mc.switchTo('voxel');
    base.capture.capture('right', 'thing', 0, (r) => released.push(r));
    base.cursors.addTarget(new THREE.Object3D());
    mc.switchTo('draw');
    expect(released).toEqual(['modeSwitch']);
    expect(base.cursors.targetCount).toBe(0);
    expect(spies.get('voxel')?.calls).toEqual(['enter', 'exit']);
    expect(spies.get('draw')?.calls).toEqual(['enter']);
    expect(mc.activeId).toBe('draw');
  });

  it('creates each mode once and preserves it (and its history) across switches', () => {
    const { mc, spies } = spyController();
    mc.switchTo('voxel');
    const voxelHistory = spies.get('voxel')?.history;
    mc.switchTo('panel');
    mc.switchTo('voxel');
    expect(mc.createdCount).toBe(2);
    expect(spies.get('voxel')?.calls).toEqual(['enter', 'exit', 'enter']);
    expect(spies.get('voxel')?.history).toBe(voxelHistory);
    expect(spies.get('panel')?.history).not.toBe(voxelHistory);
    mc.switchTo('voxel'); // no-op
    expect(spies.get('voxel')?.calls.length).toBe(3);
  });

  it('an open UI overlay consumes gestures and drops captures', () => {
    const { mc, spies, base } = spyController();
    mc.switchTo('voxel');
    const frame = {} as InteractionFrame;
    mc.update(frame);
    base.capture.capture('left', 'x', 0);
    mc.setUiCaptured(true);
    mc.update(frame);
    expect(base.capture.count).toBe(0);
    expect(spies.get('voxel')?.calls).toEqual(['enter', 'update']);
    mc.setUiCaptured(false);
    mc.update(frame);
    expect(spies.get('voxel')?.calls).toEqual(['enter', 'update', 'update']);
  });

  it('routes undo / clear to the active mode and disposes every mode', () => {
    const { mc, spies } = spyController();
    const seen: boolean[] = [];
    mc.onHistoryChange((h) => seen.push(h.canUndo));
    mc.switchTo('voxel');
    const state = { n: 0 };
    spies
      .get('voxel')
      ?.history?.execute({ label: 'x', do: () => void state.n++, undo: () => void state.n-- });
    expect(mc.undo()).toBe(true);
    expect(state.n).toBe(0);
    mc.clear();
    expect(spies.get('voxel')?.calls).toContain('reset');
    mc.switchTo('panel');
    mc.dispose();
    expect(spies.get('voxel')?.calls.at(-1)).toBe('dispose');
    expect(spies.get('panel')?.calls.slice(-2)).toEqual(['exit', 'dispose']);
    expect(seen).toContain(true);
  });
});

describe('registry', () => {
  it('has a factory for every experience', () => {
    for (const id of MODE_IDS) expect(MODE_FACTORIES[id]().id).toBe(id);
  });
});
