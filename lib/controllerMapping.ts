import { loadSettings, saveSettings } from '@/lib/setup';
import KrsEmulator from '@/modules/krs-emulator';

export type MappingAction =
  | 'A'
  | 'B'
  | 'L'
  | 'R'
  | 'START'
  | 'SELECT'
  | 'FAST_FORWARD'
  | 'MENU'
  | 'QUICK_SAVE'
  | 'QUICK_LOAD';

/** The keys that must be held together for each action; empty means not set. */
export type ControllerMapping = Record<MappingAction, string[]>;

export const DEFAULT_CONTROLLER_MAPPING: ControllerMapping = {
  A: ['BUTTON_A'],
  B: ['BUTTON_B'],
  L: ['BUTTON_L1'],
  R: ['BUTTON_R1'],
  START: ['BUTTON_START'],
  SELECT: ['BUTTON_SELECT'],
  FAST_FORWARD: ['BUTTON_R2'],
  MENU: ['BUTTON_MODE'],
  QUICK_SAVE: ['BUTTON_SELECT', 'BUTTON_R1'],
  QUICK_LOAD: [],
};

export const BUTTON_ROWS: { action: MappingAction; label: string }[] = [
  { action: 'A', label: 'A' },
  { action: 'B', label: 'B' },
  { action: 'L', label: 'L' },
  { action: 'R', label: 'R' },
  { action: 'START', label: 'Start' },
  { action: 'SELECT', label: 'Select' },
];

export const SHORTCUT_ROWS: { action: MappingAction; label: string }[] = [
  { action: 'FAST_FORWARD', label: 'Fast-forward (hold)' },
  { action: 'MENU', label: 'Open menu' },
  { action: 'QUICK_SAVE', label: 'Quick save' },
  { action: 'QUICK_LOAD', label: 'Quick load' },
];

export const loadControllerMapping = () =>
  loadSettings().controllerMapping ?? DEFAULT_CONTROLLER_MAPPING;

export async function saveControllerMapping(mapping: ControllerMapping) {
  KrsEmulator.setControllerMapping(JSON.stringify(mapping));
  await saveSettings({ controllerMapping: mapping });
}

/** Binds keys to an action, clearing any other action that used exactly those keys. */
export function assignKeys(mapping: ControllerMapping, action: MappingAction, keys: string[]) {
  const wanted = [...keys].sort().join('+');
  const next = { ...mapping };
  for (const other of Object.keys(next) as MappingAction[]) {
    if ([...next[other]].sort().join('+') === wanted) next[other] = [];
  }
  next[action] = keys;
  return next;
}

export function formatKeys(keys: string[]) {
  return keys.map((key) => (keys.length > 1 ? key.replace('BUTTON_', '') : key)).join(' + ');
}
