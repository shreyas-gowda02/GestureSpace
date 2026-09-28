// Keyboard shortcuts (§21.7). Every gesture-triggered critical action has a key equivalent.

import { MODE_IDS, type ModeId } from '@/core/types';

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
  | { type: 'group' }
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
  { keys: 'C', action: 'Clear the current experience' },
  { keys: 'R', action: 'Reset (view, position, or turn & size)' },
  { keys: 'H or ?', action: 'Help (this window)' },
  { keys: '`', action: 'Debug panel' },
  { keys: 'Q / E', action: 'Depth − / + (Voxel layer · Object Lab farther / nearer)' },
  { keys: 'L', action: 'Depth Lock (Voxel)' },
  { keys: 'X', action: 'Build / erase (Voxel) · pen / eraser (Draw)' },
  { keys: '← / →  or  [ / ]', action: 'Previous / next filter or portal world' },
  { keys: 'Delete / Backspace', action: 'Delete the selection (Object Lab)' },
  { keys: 'D', action: 'Copy the selection (Object Lab)' },
  { keys: 'G', action: 'Group / ungroup the selection (Object Lab)' },
  { keys: 'Esc', action: 'Close windows · let go · deselect' },
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
    case '?':
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
    case 'Backspace':
      return { type: 'delete' };
    case 'd':
      return { type: 'duplicate' };
    case 'g':
      return { type: 'group' };
    case 'Escape':
      return { type: 'escape' };
    default:
      return null;
  }
}
