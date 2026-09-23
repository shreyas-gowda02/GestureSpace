import { MODE_LIST } from '@/modes/registry';
import { useAppStore } from '@/state/appStore';
import { ModeIcon } from './icons';

export function ModeDock() {
  const activeMode = useAppStore((s) => s.activeMode);
  const setActiveMode = useAppStore((s) => s.setActiveMode);

  return (
    <nav className="gs-panel gs-dock" aria-label="Experiences">
      {MODE_LIST.map((m) => {
        const active = m.id === activeMode;
        return (
          <button
            key={m.id}
            type="button"
            className={`gs-dock__item${active ? ' is-active' : ''}`}
            aria-pressed={active}
            aria-label={`${m.name} (key ${m.hotkey})`}
            title={`${m.name} — ${m.tagline}`}
            onClick={() => setActiveMode(m.id)}
          >
            <ModeIcon mode={m.id} />
            <span className="gs-dock__label">{m.shortName}</span>
            <kbd className="gs-dock__key">{m.hotkey}</kbd>
          </button>
        );
      })}
    </nav>
  );
}
