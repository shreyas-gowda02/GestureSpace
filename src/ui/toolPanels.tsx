// Per-experience controls in the right-hand tool panel (§21.1). Each experience publishes what its
// panel shows through the store (≤ 10 Hz); buttons send ModeActions back to it via bootstrap.
// Every gesture action here also has a key (§21.10), shown next to it.

import { modeAction } from '@/app/bootstrap';
import { TUNING } from '@/config/tuning';
import type { DrawTool, ModeId, VoxelMaterial, VoxelTool } from '@/core/types';
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

/** The active experience's controls (nothing for experiences still shown as placeholders). */
export function ModeTools({ mode }: { mode: ModeId }) {
  switch (mode) {
    case 'voxel':
      return <VoxelTools />;
    case 'draw':
      return <DrawTools />;
    default:
      return null;
  }
}
