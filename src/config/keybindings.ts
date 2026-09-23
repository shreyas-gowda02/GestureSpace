// Keyboard shortcuts (§21.7). Every gesture-triggered critical action has a key equivalent.

import { MODE_IDS, type ModeId } from '@/core/types/common';

export type KeyAction =
  | { type: 'mode'; mode: ModeId }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'reset' }
  | { type: 'help' }
  | { type: 'debug' }
  | { type: 'depthDown' }
  | { type: 'depthUp' }
  | { type: 'depthLock' }
  | { type: 'toggleErase' }
  | { type: 'filterPrev' }
  | { type: 'filterNext' }
  | { type: 'delete' }
  | { type: 'duplicate' }
  | { type: 'escape' };

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Human-readable shortcut list for the Help overlay. */
export const KEYBINDING_HELP: readonly { keys: string; action: string }[] = [
  { keys: '1–7', action: 'Switch experience' },
  { keys: 'Ctrl/Cmd+Z', action: 'Undo' },
  { keys: 'Ctrl/Cmd+Shift+Z', action: 'Redo' },
  { keys: 'C', action: 'Clear mode' },
  { keys: 'R', action: 'Reset transform / view' },
  { keys: 'H', action: 'Help' },
  { keys: '`', action: 'Debug panel' },
  { keys: 'Q / E', action: 'Depth − / +' },
  { keys: 'L', action: 'Depth lock' },
  { keys: 'X', action: 'Build / erase' },
  { keys: '← / →  or  [ / ]', action: 'Filter prev / next' },
  { keys: 'Delete', action: 'Delete selection' },
  { keys: 'D', action: 'Duplicate' },
  { keys: 'Esc', action: 'Close overlays / release' },
];

/** Pure mapping from a key event to an app action (unit-tested). */
export function resolveKeyAction(e: KeyInput): KeyAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod && key === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
  if (mod || e.altKey) return null;

  if (key >= '1' && key <= '7') {
    const mode = MODE_IDS[Number(key) - 1];
    return mode ? { type: 'mode', mode } : null;
  }

  switch (key) {
    case 'c':
      return { type: 'clear' };
    case 'r':
      return { type: 'reset' };
    case 'h':
      return { type: 'help' };
    case '`':
      return { type: 'debug' };
    case 'q':
      return { type: 'depthDown' };
    case 'e':
      return { type: 'depthUp' };
    case 'l':
      return { type: 'depthLock' };
    case 'x':
      return { type: 'toggleErase' };
    case 'ArrowLeft':
    case '[':
      return { type: 'filterPrev' };
    case 'ArrowRight':
    case ']':
      return { type: 'filterNext' };
    case 'Delete':
      return { type: 'delete' };
    case 'd':
      return { type: 'duplicate' };
    case 'Escape':
      return { type: 'escape' };
    default:
      return null;
  }
}
