import { loadGameMeta, saveGameMeta } from '@/lib/library';

/** How the DS's two screens are arranged. Keys match ScreenMode in KrsScreenLayout.kt. */
export type ScreenMode = 'stacked' | 'sideBySide' | 'focus' | 'single';

export type LayoutOrientation = 'portrait' | 'landscape';

export type ScreenLayout = {
  mode: ScreenMode;
  /**
   * Puts the touchscreen first: on top when stacked, on the left side by side, large in Focus,
   * and the one shown in Single.
   */
  swapped: boolean;
  /** Space between the screens, in dp. */
  gap: number;
};

export const MAX_SCREEN_GAP = 32;

export const DEFAULT_SCREEN_LAYOUTS: Record<LayoutOrientation, ScreenLayout> = {
  portrait: { mode: 'stacked', swapped: false, gap: 8 },
  landscape: { mode: 'stacked', swapped: false, gap: 8 },
};

export const SCREEN_MODES: { mode: ScreenMode; label: string; description: string }[] = [
  { mode: 'stacked', label: 'Stacked', description: 'One above the other, like the handheld.' },
  { mode: 'sideBySide', label: 'Side by side', description: 'Both screens in a row. Suits landscape.' },
  { mode: 'focus', label: 'Focus', description: 'One screen large, the other small.' },
  { mode: 'single', label: 'Single', description: 'One screen at a time. Swap to switch.' },
];

/** What "swapped" means in each mode, as [not swapped, swapped]. */
export const SWAP_LABELS: Record<ScreenMode, { title: string; options: [string, string] }> = {
  stacked: { title: 'Touchscreen', options: ['Bottom', 'Top'] },
  sideBySide: { title: 'Touchscreen', options: ['Right', 'Left'] },
  focus: { title: 'Large screen', options: ['Main', 'Touch'] },
  single: { title: 'Showing', options: ['Main', 'Touch'] },
};

export function loadScreenLayout(gameId: string, orientation: LayoutOrientation): ScreenLayout {
  return {
    ...DEFAULT_SCREEN_LAYOUTS[orientation],
    ...loadGameMeta()[gameId]?.screenLayouts?.[orientation],
  };
}

export async function saveScreenLayout(
  gameId: string,
  orientation: LayoutOrientation,
  layout: ScreenLayout
) {
  const meta = loadGameMeta();
  const current = meta[gameId];
  await saveGameMeta({
    ...meta,
    [gameId]: {
      ...current,
      screenLayouts: { ...current?.screenLayouts, [orientation]: layout },
    },
  });
}
