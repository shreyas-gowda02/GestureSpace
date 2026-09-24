// Per-mode undo/redo (§22). Every scene mutation in an editing mode is a Command.
// Created in Phase 4 because ModeContext carries it; modes start pushing commands in Phase 5.

import { TUNING } from '@/config/tuning';
import type { Command } from '@/core/types';

type Listener = (history: CommandHistory) => void;

export class CommandHistory {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private readonly cap: number;
  private readonly listeners = new Set<Listener>();

  constructor(cap: number = TUNING.history.cap) {
    this.cap = cap;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  /** Apply a command and record it. */
  execute(cmd: Command): void {
    cmd.do();
    this.push(cmd);
  }

  /** Record a command whose effect is already applied (e.g. built up live during a stroke). */
  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.cap) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.emit();
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.do();
    this.undoStack.push(cmd);
    this.emit();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this);
  }
}
