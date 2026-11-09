import { File, Paths } from 'expo-file-system';

import KrsEmulator from '@/modules/krs-emulator';

export const SLOT_COUNT = 8;
export const AUTO_STATE = 'auto';
export const UNDO_STATE = 'undo';
export const PREVIEW_THUMBNAIL = 'preview';
export const DEFAULT_QUICK_SLOT = 1;

export type StateSlot = {
  name: string;
  savedAt: number | null;
  thumbnailUri: string | null;
};

export const slotStateName = (slot: number) => `slot${slot}`;

const saveIds = new Map<string, string>();

/** Remembers a save ID the emulator already worked out, so the ROM needn't be hashed again. */
export function rememberRomSaveId(uri: string, saveId: string) {
  saveIds.set(uri, saveId);
}

export async function getRomSaveId(uri: string) {
  const known = saveIds.get(uri);
  if (known) return known;
  const saveId = await KrsEmulator.getSaveId(uri);
  saveIds.set(uri, saveId);
  return saveId;
}

// Matches the folder used by KrsEmulatorModule.
const stateFile = (saveId: string, name: string, extension: string) =>
  new File(Paths.document, 'states', saveId, `${name}.${extension}`);

// The version forces the image cache to pick up a thumbnail replaced at the same path.
export function readThumbnailUri(saveId: string, name: string) {
  const file = stateFile(saveId, name, 'png');
  return file.exists ? `${file.uri}?v=${file.modificationTime}` : null;
}

export function readSlot(saveId: string, name: string): StateSlot {
  const file = stateFile(saveId, name, 'state');
  if (!file.exists) return { name, savedAt: null, thumbnailUri: null };
  return {
    name,
    savedAt: file.modificationTime ?? null,
    thumbnailUri: readThumbnailUri(saveId, name),
  };
}

export const readPreviewUri = (saveId: string) => readThumbnailUri(saveId, PREVIEW_THUMBNAIL);

export function readSlots(saveId: string) {
  return Array.from({ length: SLOT_COUNT }, (_, index) =>
    readSlot(saveId, slotStateName(index + 1))
  );
}

export function countUsedSlots(saveId: string) {
  return readSlots(saveId).filter((slot) => slot.savedAt !== null).length;
}

export function deleteSlot(saveId: string, name: string) {
  for (const extension of ['state', 'png']) {
    const file = stateFile(saveId, name, extension);
    if (file.exists) file.delete();
  }
}

let loadedLabel: string | null = null;

/** Tells the Player, once it's back on screen, what was loaded from Save states. */
export function markStateLoaded(label: string) {
  loadedLabel = label;
}

export function takeLoadedLabel() {
  const label = loadedLabel;
  loadedLabel = null;
  return label;
}

export function formatSavedAt(timestamp: number, now = new Date()) {
  const date = new Date(timestamp);
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${pad(date.getDate())} ${clock}`;
}
