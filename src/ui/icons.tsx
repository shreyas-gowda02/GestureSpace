// Inline stroke icons for the mode dock (no icon dependency).

import type { ModeId } from '@/core/types/common';

const PATHS: Record<ModeId, string> = {
  voxel: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zm0 0v9m0 0l8-4.5M12 12L4 7.5',
  panel: 'M3 8.5l18-3v13l-18-3v-7zM3 8.5v7M21 5.5v13',
  draw: 'M4 18c3-6 5-9 8-9s2 5 5 5 3-3 3-3M17 4l3 3-8 8H9v-3l8-8z',
  strings: 'M5 6l7 4 7-4M5 6l2 12M19 6l-2 12M12 10v10M7 18l5 2 5-2M5 6h0M19 6h0',
  filter: 'M3 7h18v10H3zM9 7v10M15 7v10',
  portal:
    'M12 3c4.5 0 7 4 7 9s-2.5 9-7 9-7-4-7-9 2.5-9 7-9zm0 4c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5z',
  objectLab: 'M12 3l7 4v8l-7 4-7-4V7l7-4zM5 7l7 4 7-4M12 11v8M17 18.5a3 3 0 100-.1',
};

export function ModeIcon({ mode, size = 22 }: { mode: ModeId; size?: number }) {
  return (
    <svg
      className="gs-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[mode]} />
    </svg>
  );
}
