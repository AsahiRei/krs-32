import { loadSettings, saveSettings } from '@/lib/setup';
import type { ControlDefault, OrientationDefaults } from '@/modules/krs-emulator';

export type Orientation = 'portrait' | 'landscape';

export type PlacedControl = { x: number; y: number; size: number };

export type OrientationLayout = {
  opacity: number;
  /** Only the controls that have moved from their default place. */
  controls: Record<string, PlacedControl>;
};

export type ControlLayout = Record<Orientation, OrientationLayout>;

export const GRID_DP = 8;
const MIN_SIZE_FACTOR = 0.6;
const MAX_SIZE_FACTOR = 1.8;

// Landscape controls float over the picture, so they start see-through.
export const EMPTY_LAYOUT: ControlLayout = {
  portrait: { opacity: 1, controls: {} },
  landscape: { opacity: 0.7, controls: {} },
};

export const loadControlLayout = () => loadSettings().controlLayout ?? EMPTY_LAYOUT;

export const saveControlLayout = (controlLayout: ControlLayout) => saveSettings({ controlLayout });

export function placedControl(control: ControlDefault, layout: OrientationLayout): PlacedControl {
  return (
    layout.controls[control.id] ?? { x: control.x, y: control.y, size: control.size }
  );
}

export const sizeLimits = (control: ControlDefault) => ({
  min: Math.round(control.size * MIN_SIZE_FACTOR),
  max: Math.round(control.size * MAX_SIZE_FACTOR),
});

/** Height of a control at the given width. */
export const controlHeight = (control: ControlDefault, size: number) => size / control.aspect;

const snap = (value: number, grid: boolean) =>
  grid ? Math.round(value / GRID_DP) * GRID_DP : Math.round(value);

/** Applies snapping and keeps the whole control inside the editable area. */
export function fitControl(
  control: ControlDefault,
  defaults: OrientationDefaults,
  next: PlacedControl,
  useGrid: boolean
): PlacedControl {
  const limits = sizeLimits(control);
  const size = Math.min(limits.max, Math.max(limits.min, snap(next.size, useGrid)));
  const halfWidth = size / 2;
  const halfHeight = controlHeight(control, size) / 2;
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));
  return {
    size,
    x: clamp(snap(next.x, useGrid), halfWidth, defaults.width - halfWidth),
    y: clamp(snap(next.y, useGrid), defaults.top + halfHeight, defaults.height - halfHeight),
  };
}
