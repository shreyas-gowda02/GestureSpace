// Global keyboard handler. Maps keys → actions via config/keybindings.ts.
// Mode-specific actions (depth, filters, …) are forwarded to the ModeController in Phase 4.

import { useEffect } from 'react';
import { resolveKeyAction } from '@/config/keybindings';
import { useAppStore } from '@/state/appStore';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT'
  );
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat || isTypingTarget(e.target)) return;
      const action = resolveKeyAction(e);
      if (!action) return;
      const store = useAppStore.getState();
      switch (action.type) {
        case 'mode':
          store.setActiveMode(action.mode);
          break;
        case 'help':
          store.toggleHelp();
          break;
        case 'debug':
          store.toggleDebug();
          break;
        case 'escape':
          store.closeOverlays();
          break;
        default:
          return; // not handled yet — let the browser keep the event
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
