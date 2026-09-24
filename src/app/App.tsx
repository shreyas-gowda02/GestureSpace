import { useEffect } from 'react';
import { handleKeyAction } from '@/app/bootstrap';
import { resolveKeyAction } from '@/config/keybindings';
import { useAppStore } from '@/state/appStore';
import { AppShell } from '@/ui/AppShell';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.isContentEditable ||
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT'
  );
}

/**
 * Global keyboard handler: key → action via config/keybindings.ts. The shell handles mode / help /
 * debug / escape; everything else goes to the core (undo, clear…) and the active experience.
 */
function useKeyboardShortcuts(): void {
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
          handleKeyAction(action); // also drops anything held
          break;
        default:
          // Undo/redo/clear/reset + mode-specific keys go to the core / active experience.
          if (!handleKeyAction(action)) return; // unused — let the browser keep the event
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export function App() {
  useKeyboardShortcuts();

  return <AppShell />;
}
