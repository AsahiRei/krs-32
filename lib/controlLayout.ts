import { loadSettings, saveSettings } from '@/lib/setup';
import type { ControlDefault, OrientationDefaults } from '@/modules/krs-emulator';

export type Orientation = 'portrait' | 'landscape';

export type PlacedControl = { x: number; y: number; size: number };

export type GbaButton = 'A' | 'B' | 'L' | 'R';
export type ExtraAction = 'QUICK_LOAD' | 'QUICK_SAVE' | 'FAST_FORWARD' | 'SCREENSHOT';

/** What an added button does: holds GBA buttons, or fires a one-shot action. */
export type ExtraBinding = {
  label: string;
  buttons: GbaButton[];
  turbo: boolean;
  action?: ExtraAction;
};

export type ExtraPreset = { title: string; bindings: ExtraBinding[] };

const hold = (buttons: GbaButton[], turbo = false): ExtraBinding => ({
  label: buttons.join('+'),
  buttons,
  turbo,
});

const shortcut = (label: string, action: ExtraAction): ExtraBinding => ({
  label,
  buttons: [],
  turbo: false,
  action,
});

/** The choices offered by Add control. One preset can add more than one button. */
export const EXTRA_PRESETS: ExtraPreset[] = [
  { title: 'A/B turbo', bindings: [hold(['B'], true), hold(['A'], true)] },
  { title: 'Button A', bindings: [hold(['A'])] },
  { title: 'Button B', bindings: [hold(['B'])] },
  { title: 'A+B', bindings: [hold(['A', 'B'])] },
  { title: 'L+R', bindings: [hold(['L', 'R'])] },
  { title: 'L+A', bindings: [hold(['L', 'A'])] },
  { title: 'L+B', bindings: [hold(['L', 'B'])] },
  { title: 'R+A', bindings: [hold(['R', 'A'])] },
  { title: 'R+B', bindings: [hold(['R', 'B'])] },
  { title: 'Quick load', bindings: [shortcut('Quick load', 'QUICK_LOAD')] },
  { title: 'Quick save', bindings: [shortcut('Quick save', 'QUICK_SAVE')] },
  { title: 'Fast forward', bindings: [shortcut('Fast forward', 'FAST_FORWARD')] },
  { title: 'Screenshot', bindings: [shortcut('Screenshot', 'SCREENSHOT')] },
];

/** A button the player added. Once moved, its place is kept in `controls` like any other. */
export type ExtraControl = ControlDefault & ExtraBinding;

export type OrientationLayout = {
  opacity: number;
  /** Only the controls that have moved from their default place. */
  controls: Record<string, PlacedControl>;
  /** Absent from layouts saved before buttons could be added. */
  extras?: ExtraControl[];
};

export type ControlLayout = Record<Orientation, OrientationLayout>;

export const GRID_DP = 8;
// KrsControlsView tracks these as bits of one Int and ignores any past this count.
export const MAX_EXTRA_CONTROLS = 16;
const MIN_SIZE_FACTOR = 0.6;
const MAX_SIZE_FACTOR = 1.8;
const ROUND_EXTRA_SIZE = 72;
const PILL_EXTRA_SIZE = 104;
const PILL_EXTRA_ASPECT = 2;
const ROUND_LABEL_MAX = 3;
const STAGGER_DP = 24;
const STAGGER_STEPS = 4;

const SHORTCUT_ASPECT = 1.5;

const startingExtra = (
  id: string,
  binding: ExtraBinding,
  x: number,
  y: number,
  aspect = 1
): ExtraControl => ({
  ...binding,
  id,
  kind: aspect === 1 ? 'round' : 'pill',
  x,
  y,
  size: ROUND_EXTRA_SIZE,
  aspect,
});

// Landscape controls float over the picture, so they start see-through.
export const EMPTY_LAYOUT: ControlLayout = {
  portrait: { opacity: 1, controls: {} },
  landscape: {
    opacity: 0.7,
    controls: {},
    extras: [
      startingExtra('default-turbo-b', hold(['B'], true), 704, 280),
      startingExtra('default-turbo-a', hold(['A'], true), 832, 280),
      startingExtra(
        'default-quick-load',
        shortcut('Quick load', 'QUICK_LOAD'),
        44,
        112,
        SHORTCUT_ASPECT
      ),
      startingExtra(
        'default-quick-save',
        shortcut('Quick save', 'QUICK_SAVE'),
        872,
        128,
        SHORTCUT_ASPECT
      ),
    ],
  },
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

export const extraControls = (layout: OrientationLayout) => layout.extras ?? [];

export const isTurbo = (control: ControlDefault | ExtraControl) =>
  'turbo' in control && control.turbo;

/** The name to show or announce; a turbo button's own label is only its letter. */
export const controlName = (control: ControlDefault | ExtraControl) =>
  isTurbo(control) ? `Turbo ${control.label}` : control.label;

/** New buttons centered across the editable area at `y`, offset so repeats don't stack exactly. */
export function createExtraControls(
  bindings: ExtraBinding[],
  defaults: OrientationDefaults,
  existingCount: number,
  y: number
): ExtraControl[] {
  return bindings
    .slice(0, MAX_EXTRA_CONTROLS - existingCount)
    .map((binding, column) => createExtraControl(binding, defaults, existingCount, column, y));
}

function createExtraControl(
  binding: ExtraBinding,
  defaults: OrientationDefaults,
  existingCount: number,
  column: number,
  y: number
): ExtraControl {
  const round = binding.label.length <= ROUND_LABEL_MAX;
  const size = round ? ROUND_EXTRA_SIZE : PILL_EXTRA_SIZE;
  const draft: ExtraControl = {
    ...binding,
    // One preset creates several buttons within the same millisecond.
    id: `extra-${Date.now().toString(36)}-${existingCount + column}`,
    kind: round ? 'round' : 'pill',
    x: 0,
    y: 0,
    size,
    aspect: round ? 1 : PILL_EXTRA_ASPECT,
  };
  const offset = (existingCount % STAGGER_STEPS) * STAGGER_DP;
  const place = fitControl(
    draft,
    defaults,
    {
      x: defaults.width / 2 + offset + column * (size + GRID_DP),
      y: y + offset,
      size,
    },
    true
  );
  return { ...draft, ...place };
}

export function withoutExtra(layout: OrientationLayout, id: string): OrientationLayout {
  return {
    ...layout,
    controls: Object.fromEntries(Object.entries(layout.controls).filter(([key]) => key !== id)),
    extras: extraControls(layout).filter((extra) => extra.id !== id),
  };
}

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
