// Per-experience controls in the right-hand tool panel (§21.1). Each experience publishes what its
// panel shows through the store (≤ 10 Hz); buttons send ModeActions back to it via bootstrap.
// Every gesture action here also has a key (§21.10), shown next to it.

import { useRef, useState } from 'react';
import {
  exportScene,
  importScene,
  loadSavedScene,
  modeAction,
  resetView,
  saveScene,
} from '@/app/bootstrap';
import { TUNING } from '@/config/tuning';
import { FILTER_PRESETS } from '@/modes/filter/filters';
import { OBJECT_KINDS } from '@/modes/objectLab/objects';
import { PORTAL_WORLDS } from '@/modes/portal/portalContent';
import type {
  DrawTool,
  FilterSource,
  ModeId,
  ObjectLook,
  PanelContent,
  StringsStyle,
  TrailLength,
  VoxelMaterial,
  VoxelTool,
} from '@/core/types';
import { useAppStore } from '@/state/appStore';

const VOXEL_TOOLS: readonly { tool: VoxelTool; label: string }[] = [
  { tool: 'build', label: 'Build' },
  { tool: 'erase', label: 'Erase' },
  { tool: 'paint', label: 'Paint' },
];

const VOXEL_MATERIALS: readonly { material: VoxelMaterial; label: string }[] = [
  { material: 'solid', label: 'Solid' },
  { material: 'glass', label: 'Glass' },
  { material: 'emissive', label: 'Glow' },
];

/** Layers shown either side of the active one in the depth indicator. */
const DEPTH_WINDOW = [-3, -2, -1, 0, 1, 2, 3] as const;

const signed = (z: number): string => (z > 0 ? `+${z}` : z < 0 ? `−${-z}` : '0');

function VoxelTools() {
  const ui = useAppStore((s) => s.modeUi.voxel);
  if (!ui) return null;
  const half = TUNING.voxel.worldBounds / 2;

  return (
    <>
      <h3 className="gs-toolpanel__sub">
        Tool <kbd>X</kbd>
      </h3>
      <div className="gs-segmented" role="group" aria-label="Voxel tool">
        {VOXEL_TOOLS.map(({ tool, label }) => (
          <button
            key={tool}
            type="button"
            className="gs-btn"
            aria-pressed={ui.tool === tool}
            onClick={() => modeAction({ type: 'voxelTool', tool })}
          >
            {label}
          </button>
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Colour</h3>
      <div className="gs-swatches" role="group" aria-label="Voxel colour">
        {TUNING.voxel.palette.map(({ name, hex }) => (
          <button
            key={hex}
            type="button"
            className="gs-swatch"
            style={{ background: hex }}
            aria-label={name}
            title={name}
            aria-pressed={ui.color === hex}
            onClick={() => modeAction({ type: 'voxelColor', color: hex })}
          />
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Material</h3>
      <div className="gs-segmented" role="group" aria-label="Voxel material">
        {VOXEL_MATERIALS.map(({ material, label }) => (
          <button
            key={material}
            type="button"
            className="gs-btn"
            aria-pressed={ui.material === material}
            onClick={() => modeAction({ type: 'voxelMaterial', material })}
          >
            {label}
          </button>
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">
        Depth layer <kbd>Q</kbd> <kbd>E</kbd>
      </h3>
      <div className="gs-depth">
        <button
          type="button"
          className="gs-btn gs-depth__step"
          aria-label="Depth layer down (Q)"
          disabled={ui.layer <= -half}
          onClick={() => modeAction({ type: 'depthDown' })}
        >
          −Z
        </button>
        <ol className="gs-depth__scale" aria-label={`Active depth layer ${signed(ui.layer)}`}>
          {DEPTH_WINDOW.map((k) => {
            const z = ui.layer + k;
            const inRange = z >= -half && z < half;
            return (
              <li key={k} className={k === 0 ? 'is-active' : undefined} aria-hidden={k !== 0}>
                {inRange ? signed(z) : ''}
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className="gs-btn gs-depth__step"
          aria-label="Depth layer up (E)"
          disabled={ui.layer >= half - 1}
          onClick={() => modeAction({ type: 'depthUp' })}
        >
          +Z
        </button>
      </div>
      <button
        type="button"
        className="gs-btn gs-depthlock"
        aria-pressed={ui.depthLock}
        onClick={() => modeAction({ type: 'depthLock' })}
      >
        {ui.depthLock ? 'Depth Lock on' : 'Depth Lock off (experimental)'} <kbd>L</kbd>
      </button>
      <p className="gs-muted gs-toolpanel__count">
        {ui.count} {ui.count === 1 ? 'voxel' : 'voxels'}
      </p>
    </>
  );
}

const DRAW_TOOLS: readonly { tool: DrawTool; label: string }[] = [
  { tool: 'pen', label: 'Pen' },
  { tool: 'eraser', label: 'Eraser' },
];

function DrawTools() {
  const ui = useAppStore((s) => s.modeUi.draw);
  if (!ui) return null;

  return (
    <>
      <h3 className="gs-toolpanel__sub">
        Tool <kbd>X</kbd>
      </h3>
      <div className="gs-segmented" role="group" aria-label="Draw tool">
        {DRAW_TOOLS.map(({ tool, label }) => (
          <button
            key={tool}
            type="button"
            className="gs-btn"
            aria-pressed={ui.tool === tool}
            onClick={() => modeAction({ type: 'drawTool', tool })}
          >
            {label}
          </button>
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Colour</h3>
      <div className="gs-swatches" role="group" aria-label="Pen colour">
        {TUNING.draw.palette.map(({ name, hex }) => (
          <button
            key={hex}
            type="button"
            className="gs-swatch"
            style={{ background: hex }}
            aria-label={name}
            title={name}
            aria-pressed={ui.color === hex}
            onClick={() => modeAction({ type: 'drawColor', color: hex })}
          />
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Width</h3>
      <div className="gs-segmented" role="group" aria-label="Pen width">
        {TUNING.draw.widths.map(({ name }, i) => (
          <button
            key={name}
            type="button"
            className="gs-btn"
            aria-pressed={ui.width === i}
            onClick={() => modeAction({ type: 'drawWidth', width: i })}
          >
            {name}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="gs-btn gs-depthlock"
        aria-pressed={ui.glow}
        onClick={() => modeAction({ type: 'drawGlow' })}
      >
        {ui.glow ? 'Glow on' : 'Glow off'}
      </button>
      <p className="gs-muted gs-toolpanel__count">
        {ui.count} {ui.count === 1 ? 'stroke' : 'strokes'}
      </p>
    </>
  );
}

const PANEL_LIVE: readonly { content: Exclude<PanelContent, 'file'>; label: string }[] = [
  { content: 'animated', label: 'Animated' },
  { content: 'camera', label: 'Live camera' },
];

function PanelTools() {
  const ui = useAppStore((s) => s.modeUi.panel);
  const cameraOn = useAppStore((s) => s.cameraStatus === 'running');
  const fileRef = useRef<HTMLInputElement>(null);
  if (!ui) return null;

  const openFile = (file: File | undefined): void => {
    if (!file || !file.type.startsWith('image/')) return;
    modeAction({ type: 'panelFile', url: URL.createObjectURL(file), name: file.name });
  };

  return (
    <>
      <h3 className="gs-toolpanel__sub">Pictures</h3>
      <div className="gs-segmented" role="group" aria-label="Sample pictures">
        {TUNING.panel.samples.map(({ id, name }) => (
          <button
            key={id}
            type="button"
            className="gs-btn"
            aria-pressed={ui.content === id}
            onClick={() => modeAction({ type: 'panelContent', content: id })}
          >
            {name}
          </button>
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Live</h3>
      <div className="gs-segmented" role="group" aria-label="Live content">
        {PANEL_LIVE.map(({ content, label }) => (
          <button
            key={content}
            type="button"
            className="gs-btn"
            aria-pressed={ui.content === content}
            disabled={content === 'camera' && !cameraOn}
            onClick={() => modeAction({ type: 'panelContent', content })}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="gs-btn gs-depthlock"
        aria-pressed={ui.content === 'snapshot'}
        disabled={!cameraOn}
        title={cameraOn ? 'Freeze the camera picture onto the panel' : 'Start the camera first'}
        onClick={() => modeAction({ type: 'panelContent', content: 'snapshot' })}
      >
        {ui.content === 'snapshot' ? 'Take another snapshot' : 'Take a camera snapshot'}
      </button>

      <button
        type="button"
        className="gs-btn gs-depthlock"
        aria-pressed={ui.content === 'file'}
        onClick={() => fileRef.current?.click()}
      >
        {ui.fileName ? `Your picture: ${ui.fileName}` : 'Open your own picture…'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        aria-label="Open your own picture"
        onChange={(e) => {
          openFile(e.target.files?.[0]);
          e.target.value = ''; // the same file can be picked again
        }}
      />

      <button type="button" className="gs-btn gs-depthlock" onClick={() => resetView()}>
        Reset panel <kbd>R</kbd>
      </button>
      <p className="gs-muted gs-toolpanel__count">
        {ui.held ? 'Held with both hands' : 'Pinch it with both hands to grab it'}
      </p>
    </>
  );
}

const STRING_STYLES: readonly { style: StringsStyle; label: string }[] = [
  { style: 'skeleton', label: 'Skeleton' },
  { style: 'web', label: 'Web' },
  { style: 'mesh', label: 'Full mesh' },
];

const TRAILS: readonly { trails: TrailLength; label: string }[] = [
  { trails: 'off', label: 'Off' },
  { trails: 'short', label: 'Short' },
  { trails: 'long', label: 'Long' },
];

function StringsTools() {
  const ui = useAppStore((s) => s.modeUi.strings);
  if (!ui) return null;

  return (
    <>
      <h3 className="gs-toolpanel__sub">Threads</h3>
      <div className="gs-segmented" role="group" aria-label="Threads">
        {STRING_STYLES.map(({ style, label }) => (
          <button
            key={style}
            type="button"
            className="gs-btn"
            aria-pressed={ui.style === style}
            onClick={() => modeAction({ type: 'stringsStyle', style })}
          >
            {label}
          </button>
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Fingertip trails</h3>
      <div className="gs-segmented" role="group" aria-label="Fingertip trails">
        {TRAILS.map(({ trails, label }) => (
          <button
            key={trails}
            type="button"
            className="gs-btn"
            aria-pressed={ui.trails === trails}
            onClick={() => modeAction({ type: 'stringsTrails', trails })}
          >
            {label}
          </button>
        ))}
      </div>

      <button type="button" className="gs-btn gs-depthlock" onClick={() => resetView()}>
        Settle the threads <kbd>R</kbd>
      </button>
    </>
  );
}

const FILTER_SOURCES: readonly { source: Exclude<FilterSource, 'file'>; label: string }[] = [
  { source: 'lens', label: 'Live' },
  { source: 'frozen', label: 'Frozen' },
  { source: 'picture', label: 'Picture' },
];

function FilterTools() {
  const ui = useAppStore((s) => s.modeUi.filter);
  const cameraOn = useAppStore((s) => s.cameraStatus === 'running');
  const fileRef = useRef<HTMLInputElement>(null);
  if (!ui) return null;

  return (
    <>
      <h3 className="gs-toolpanel__sub">
        Filter <kbd>←</kbd> <kbd>→</kbd>
      </h3>
      <div className="gs-segmented" role="group" aria-label="Previous or next filter">
        <button type="button" className="gs-btn" onClick={() => modeAction({ type: 'filterPrev' })}>
          ← Previous
        </button>
        <button type="button" className="gs-btn" onClick={() => modeAction({ type: 'filterNext' })}>
          Next →
        </button>
      </div>
      <div className="gs-choices" role="group" aria-label="Filters">
        {FILTER_PRESETS.map(({ id, name }) => (
          <button
            key={id}
            type="button"
            className="gs-btn"
            aria-pressed={ui.preset === id}
            onClick={() => modeAction({ type: 'filterPreset', preset: id })}
          >
            {name}
          </button>
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">The lens shows</h3>
      <div className="gs-segmented" role="group" aria-label="Lens source">
        {FILTER_SOURCES.map(({ source, label }) => (
          <button
            key={source}
            type="button"
            className="gs-btn"
            aria-pressed={ui.source === source}
            disabled={source === 'frozen' && !cameraOn}
            title={
              source === 'frozen'
                ? 'Freeze the camera picture (press again for a new one)'
                : undefined
            }
            onClick={() => modeAction({ type: 'filterSource', source })}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="gs-btn gs-depthlock"
        aria-pressed={ui.source === 'file'}
        onClick={() => fileRef.current?.click()}
      >
        {ui.fileName ? `Your picture: ${ui.fileName}` : 'Filter your own picture…'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        aria-label="Filter your own picture"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file?.type.startsWith('image/')) {
            modeAction({ type: 'filterFile', url: URL.createObjectURL(file), name: file.name });
          }
          e.target.value = '';
        }}
      />

      <button type="button" className="gs-btn gs-depthlock" onClick={() => resetView()}>
        Reset lens <kbd>R</kbd>
      </button>
      <p className="gs-muted gs-toolpanel__count">
        {ui.held ? 'Held with both hands' : 'Pinch it with both hands to grab it'}
      </p>
    </>
  );
}

function PortalTools() {
  const ui = useAppStore((s) => s.modeUi.portal);
  if (!ui) return null;

  return (
    <>
      <h3 className="gs-toolpanel__sub">
        World <kbd>←</kbd> <kbd>→</kbd>
      </h3>
      <div className="gs-choices" role="group" aria-label="Portal world">
        {PORTAL_WORLDS.map(({ id, name }) => (
          <button
            key={id}
            type="button"
            className="gs-btn"
            aria-pressed={ui.world === id}
            onClick={() => modeAction({ type: 'portalWorld', world: id })}
          >
            {name}
          </button>
        ))}
      </div>
      <button type="button" className="gs-btn gs-depthlock" onClick={() => resetView()}>
        Reset portal <kbd>R</kbd>
      </button>
      <p className="gs-muted gs-toolpanel__count">
        {!ui.open
          ? 'Shut — pinch both ends of the glowing line to open it'
          : ui.held
            ? 'Held with both hands'
            : 'Open — pinch it with both hands to move it'}
      </p>
    </>
  );
}

const OBJECT_LOOKS: readonly { look: ObjectLook; label: string }[] = [
  { look: 'solid', label: 'Solid' },
  { look: 'glow', label: 'Glow' },
  { look: 'glass', label: 'Glass' },
];

function ObjectLabTools() {
  const ui = useAppStore((s) => s.modeUi.objectLab);
  if (!ui) return null;
  const some = ui.selected > 0;

  return (
    <>
      <h3 className="gs-toolpanel__sub">Add a shape</h3>
      <div className="gs-choices" role="group" aria-label="Add a shape">
        {OBJECT_KINDS.map(({ kind, name }) => (
          <button
            key={kind}
            type="button"
            className="gs-btn"
            onClick={() => modeAction({ type: 'objectSpawn', kind })}
          >
            {name}
          </button>
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Colour</h3>
      <div className="gs-swatches" role="group" aria-label="Shape colour">
        {TUNING.voxel.palette.map(({ name, hex }) => (
          <button
            key={hex}
            type="button"
            className="gs-swatch"
            style={{ background: hex }}
            aria-label={name}
            title={some ? `${name} (also recolours the selection)` : name}
            aria-pressed={ui.color === hex}
            onClick={() => modeAction({ type: 'objectColor', color: hex })}
          />
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Look</h3>
      <div className="gs-segmented" role="group" aria-label="Shape look">
        {OBJECT_LOOKS.map(({ look, label }) => (
          <button
            key={look}
            type="button"
            className="gs-btn"
            aria-pressed={ui.look === look}
            onClick={() => modeAction({ type: 'objectLook', look })}
          >
            {label}
          </button>
        ))}
      </div>

      <h3 className="gs-toolpanel__sub">Selection</h3>
      <button
        type="button"
        className="gs-btn gs-depthlock"
        aria-pressed={ui.multi}
        onClick={() => modeAction({ type: 'objectMulti' })}
      >
        {ui.multi ? 'Add to selection: on' : 'Add to selection: off'}
      </button>
      <div className="gs-segmented" role="group" aria-label="Copy or delete the selection">
        <button
          type="button"
          className="gs-btn"
          disabled={!some}
          onClick={() => modeAction({ type: 'duplicate' })}
        >
          Copy <kbd>D</kbd>
        </button>
        <button
          type="button"
          className="gs-btn"
          disabled={!some}
          onClick={() => modeAction({ type: 'delete' })}
        >
          Delete <kbd>Del</kbd>
        </button>
      </div>
      <div className="gs-segmented" role="group" aria-label="Group or ungroup the selection">
        <button
          type="button"
          className="gs-btn"
          disabled={!ui.canGroup}
          onClick={() => modeAction({ type: 'objectGroup' })}
        >
          Group <kbd>G</kbd>
        </button>
        <button
          type="button"
          className="gs-btn"
          disabled={!ui.canUngroup}
          onClick={() => modeAction({ type: 'objectUngroup' })}
        >
          Ungroup
        </button>
      </div>
      <button type="button" className="gs-btn gs-depthlock" onClick={() => resetView()}>
        {some ? 'Reset turn & size' : 'Reset all turns & sizes'} <kbd>R</kbd>
      </button>
      <p className="gs-muted gs-toolpanel__count">
        {ui.count} {ui.count === 1 ? 'object' : 'objects'} · {ui.selected} selected
      </p>
    </>
  );
}

/** Biggest scene file Import reads (a 5,000-voxel structure is ≈ 0.2 MB). */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * "Your work" (§22): every experience autosaves in this browser; Save / Load keep one extra copy,
 * Export / Import move a scene as a JSON file. Load and Import are undoable.
 */
export function SceneTools() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('Saved automatically in this browser.');

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setNote('That file is too big to be a GestureSpace scene.');
      return;
    }
    const error = importScene(await file.text());
    setNote(error ?? `Imported ${file.name} — Ctrl+Z undoes it.`);
  };

  return (
    <>
      <h3 className="gs-toolpanel__sub">Your work</h3>
      <div className="gs-segmented" role="group" aria-label="Save or load">
        <button
          type="button"
          className="gs-btn"
          onClick={() =>
            void saveScene().then((ok) =>
              setNote(ok ? 'Saved. Load brings this back.' : 'Could not save in this browser.'),
            )
          }
        >
          Save
        </button>
        <button
          type="button"
          className="gs-btn"
          onClick={() =>
            void loadSavedScene().then((r) =>
              setNote(
                r === 'loaded'
                  ? 'Loaded your saved copy — Ctrl+Z undoes it.'
                  : r === 'none'
                    ? 'Nothing saved here yet: press Save first.'
                    : 'The saved copy could not be read.',
              ),
            )
          }
        >
          Load
        </button>
      </div>
      <div className="gs-segmented" role="group" aria-label="Export or import a file">
        <button
          type="button"
          className="gs-btn"
          onClick={() => setNote(exportScene() ? 'Downloaded a scene file.' : 'Nothing to export.')}
        >
          Export…
        </button>
        <button type="button" className="gs-btn" onClick={() => fileRef.current?.click()}>
          Import…
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Import a scene file"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <p className="gs-muted gs-toolpanel__note" role="status" aria-live="polite">
        {note}
      </p>
    </>
  );
}

/** The active experience's controls. */
export function ModeTools({ mode }: { mode: ModeId }) {
  switch (mode) {
    case 'voxel':
      return <VoxelTools />;
    case 'panel':
      return <PanelTools />;
    case 'strings':
      return <StringsTools />;
    case 'filter':
      return <FilterTools />;
    case 'portal':
      return <PortalTools />;
    case 'draw':
      return <DrawTools />;
    case 'objectLab':
      return <ObjectLabTools />;
  }
}
