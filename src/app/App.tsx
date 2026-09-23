import { useEffect } from 'react';
import { acquireCore, releaseCore } from './bootstrap';
import { AppShell } from './AppShell';
import { useKeyboardShortcuts } from '@/ui/useKeyboardShortcuts';

export function App() {
  useEffect(() => {
    acquireCore();
    return releaseCore;
  }, []);

  useKeyboardShortcuts();

  return <AppShell />;
}
