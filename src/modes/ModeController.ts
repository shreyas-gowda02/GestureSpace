// Routes the InteractionFrame to the active experience and enforces the mode-switch contract
// (§21.11): camera/tracker untouched; the current mode exit()s with every capture released before
// the next enter()s; per-mode state (and undo history) is preserved across switches.
// Also precedence rule 1: while a UI overlay is open, the scene receives no gestures.

import type { KeyAction } from '@/config/keybindings';
import type { InteractionFrame, ModeId } from '@/core/types';
import { CommandHistory } from './shared/history';
import type { ModeContext, ModeFactory, SpatialMode } from './types';

export type BaseContext = Omit<ModeContext, 'history'>;

type HistoryListener = (history: CommandHistory) => void;

export class ModeController {
  private readonly base: BaseContext;
  private readonly factories: Readonly<Record<ModeId, ModeFactory>>;
  private readonly modes = new Map<ModeId, SpatialMode>();
  private readonly histories = new Map<ModeId, CommandHistory>();
  private active: SpatialMode | null = null;
  private uiCaptured = false;
  private readonly historyListeners = new Set<HistoryListener>();
  private unsubscribeHistory: (() => void) | null = null;

  constructor(base: BaseContext, factories: Readonly<Record<ModeId, ModeFactory>>) {
    this.base = base;
    this.factories = factories;
  }

  get activeId(): ModeId | null {
    return this.active?.id ?? null;
  }

  get activeMode(): SpatialMode | null {
    return this.active;
  }

  /** Number of modes created so far (debug / leak check). */
  get createdCount(): number {
    return this.modes.size;
  }

  get history(): CommandHistory | null {
    return this.active ? this.historyFor(this.active.id) : null;
  }

  switchTo(id: ModeId): void {
    if (this.active?.id === id) return;
    // Rule 4: no capture survives a mode switch.
    this.base.capture.releaseAll('modeSwitch');
    this.base.cursors.clearTargets();
    this.active?.exit();
    this.base.emitStatus('');

    let mode = this.modes.get(id);
    if (!mode) {
      mode = this.factories[id]();
      this.modes.set(id, mode);
    }
    this.active = mode;
    const history = this.historyFor(id);
    mode.enter({ ...this.base, history });

    this.unsubscribeHistory?.();
    this.unsubscribeHistory = history.onChange((h) => this.emitHistory(h));
    this.emitHistory(history);
  }

  update(frame: InteractionFrame): void {
    if (!this.active || this.uiCaptured) return;
    this.active.update(frame);
  }

  render(): void {
    this.active?.render?.();
  }

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    this.active?.drawOverlay?.(ctx);
  }

  /** Rule 1: an open UI overlay consumes gestures (and drops anything held). */
  setUiCaptured(captured: boolean): void {
    if (captured === this.uiCaptured) return;
    this.uiCaptured = captured;
    if (captured) this.base.capture.releaseAll('ui');
  }

  undo(): boolean {
    return this.history?.undo() ?? false;
  }

  redo(): boolean {
    return this.history?.redo() ?? false;
  }

  clear(): void {
    this.base.capture.releaseAll('cancelled');
    this.active?.reset();
  }

  resetView(): void {
    this.active?.resetView?.();
  }

  handleKey(action: KeyAction): boolean {
    return this.active?.onKey?.(action) ?? false;
  }

  onHistoryChange(listener: HistoryListener): () => void {
    this.historyListeners.add(listener);
    return () => this.historyListeners.delete(listener);
  }

  dispose(): void {
    this.base.capture.releaseAll('modeSwitch');
    this.active?.exit();
    this.active = null;
    this.unsubscribeHistory?.();
    for (const mode of this.modes.values()) mode.dispose();
    this.modes.clear();
    this.histories.clear();
    this.historyListeners.clear();
  }

  private historyFor(id: ModeId): CommandHistory {
    let h = this.histories.get(id);
    if (!h) {
      h = new CommandHistory();
      this.histories.set(id, h);
    }
    return h;
  }

  private emitHistory(h: CommandHistory): void {
    for (const l of this.historyListeners) l(h);
  }
}
