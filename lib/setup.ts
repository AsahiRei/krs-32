import { Directory, File, Paths } from 'expo-file-system';

import type { ControllerMapping } from '@/lib/controllerMapping';
import type { ControlLayout } from '@/lib/controlLayout';
import { systemForFile } from '@/lib/systems';
import type { VideoSettings } from '@/lib/video';

const BIOS_SIZE_BYTES = 16 * 1024;

export type GameOrientation = 'landscape' | 'portrait' | 'auto';

export type AppSettings = {
  setupComplete: boolean;
  romFolderUri: string | null;
  fastForwardSpeed: number;
  gameOrientation: GameOrientation;
  controlLayout: ControlLayout | null;
  controllerMapping: ControllerMapping | null;
  video: VideoSettings;
  /** DS games hide their touch controls while a controller is connected. */
  autoHideControls: boolean;
};

export type RomFolder = {
  uri: string;
  name: string;
  gameCount: number;
};

const DEFAULT_SETTINGS: AppSettings = {
  setupComplete: false,
  romFolderUri: null,
  fastForwardSpeed: 2,
  gameOrientation: 'landscape',
  controlLayout: null,
  controllerMapping: null,
  video: { filter: 'original', strength: 0.4, aspect: 'native', scaling: 'fit' },
  autoHideControls: true,
};

const settingsFile = () => new File(Paths.document, 'settings.json');

export const BIOS_FILE_NAME = 'gba_bios.bin';

// The emulator looks for gba_bios.bin in this folder, so the path must match KrsEmulatorModule.
const biosFile = () => new File(Paths.document, 'system', 'gba_bios.bin');

export function loadSettings(): AppSettings {
  try {
    const file = settingsFile();
    return file.exists ? { ...DEFAULT_SETTINGS, ...JSON.parse(file.textSync()) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(changes: Partial<AppSettings>) {
  const next = { ...loadSettings(), ...changes };
  const file = settingsFile();
  if (!file.exists) file.create();
  await file.write(JSON.stringify(next));
}

export type RomFile = {
  file: File;
  /** Path relative to the ROM folder, so same-named files in subfolders stay distinct. */
  path: string;
};

export function listRomFiles(directory: Directory, parentPath = ''): RomFile[] {
  return directory.list().flatMap((entry) => {
    const path = `${parentPath}${entry.name}`;
    if (entry instanceof Directory) return listRomFiles(entry, `${path}/`);
    return systemForFile(entry.name) ? [{ file: entry, path }] : [];
  });
}

/** A short path for a ROM, starting at its picked folder, such as /ROMs/handheld/game.gba. */
export function formatRomPath(folderUri: string, romPath: string) {
  return `/${formatFolderPath(folderUri).split('/').pop()}/${romPath}`;
}

/** A readable path for a picked folder, such as /storage/emulated/0/ROMs. */
export function formatFolderPath(uri: string) {
  // Android tree URIs end in a volume and path, such as tree/primary%3AGames%2FGBA.
  const treeId = uri.match(/\/tree\/([^/]+)/)?.[1];
  if (!treeId) return decodeURIComponent(uri.replace(/^file:\/\//, ''));
  const [volume, ...path] = decodeURIComponent(treeId).split(':');
  const root = volume === 'primary' ? '/storage/emulated/0' : `/storage/${volume}`;
  return `${root}/${path.join(':')}`.replace(/\/$/, '');
}

function describeFolder(directory: Directory): RomFolder {
  // Android names picked folders by their document ID, such as "primary:Games/GBA".
  const name = directory.name.split(/[:/]/).pop() || directory.name;
  return { uri: directory.uri, name, gameCount: listRomFiles(directory).length };
}

/** The saved ROM folder, or null if none is saved or access to it has been lost. */
export function loadRomFolder(uri: string | null): RomFolder | null {
  if (!uri) return null;
  try {
    return describeFolder(new Directory(uri));
  } catch {
    return null;
  }
}

/** Opens the system folder picker. Rejects if the user cancels. */
export async function chooseRomFolder(): Promise<RomFolder> {
  const folder = describeFolder(await Directory.pickDirectoryAsync());
  await saveSettings({ romFolderUri: folder.uri });
  return folder;
}

export function isBiosImported() {
  try {
    return biosFile().exists;
  } catch {
    return false;
  }
}

/** Opens the file picker and stores the BIOS. Returns false if the user cancels. */
export async function importBios(): Promise<boolean> {
  const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });
  if (picked.canceled) return false;

  const bytes = await picked.result.bytes();
  if (bytes.length !== BIOS_SIZE_BYTES) {
    throw new Error('That file is not a GBA BIOS. It should be exactly 16 KB.');
  }

  const destination = biosFile();
  destination.parentDirectory.create({ idempotent: true, intermediates: true });
  destination.create({ overwrite: true });
  await destination.write(bytes);
  return true;
}

// --- DS BIOS and firmware -------------------------------------------------------------------------

export type DsSystemFile = 'bios7.bin' | 'bios9.bin' | 'firmware.bin';

export const DS_SYSTEM_FILES: DsSystemFile[] = ['bios7.bin', 'bios9.bin', 'firmware.bin'];

const DS_BIOS7_BYTES = 16 * 1024;
const DS_BIOS9_BYTES = 4 * 1024;
// DS, DS Lite and DSi firmware dumps.
const DS_FIRMWARE_BYTES = [128 * 1024, 256 * 1024, 512 * 1024];

// melonDS reads these names from the same folder as the GBA BIOS (see KrsEmulatorModule).
const dsSystemFile = (name: DsSystemFile) => new File(Paths.document, 'system', name);

/** Which of the DS's BIOS and firmware files have been imported. */
export function dsSystemFilesFound(): DsSystemFile[] {
  return DS_SYSTEM_FILES.filter((name) => {
    try {
      return dsSystemFile(name).exists;
    } catch {
      return false;
    }
  });
}

/** Works out which DS file a dump is from its size, or null if it isn't one. */
function dsSystemFileFor(fileName: string, size: number): DsSystemFile | null {
  if (size === DS_BIOS9_BYTES) return 'bios9.bin';
  // A GBA BIOS is the same size as the ARM7 BIOS, so its name is the only way to tell them apart.
  if (size === DS_BIOS7_BYTES) return /gba/i.test(fileName) ? null : 'bios7.bin';
  if (DS_FIRMWARE_BYTES.includes(size)) return 'firmware.bin';
  return null;
}

/**
 * Opens the file picker for one or more DS BIOS and firmware dumps and stores the ones it
 * recognizes. Returns the files stored, or null if the user cancels. Throws if none are usable.
 */
export async function importDsSystemFiles(): Promise<DsSystemFile[] | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['*/*'], multipleFiles: true });
  if (picked.canceled) return null;

  const stored: DsSystemFile[] = [];
  const rejected: string[] = [];
  for (const file of picked.result) {
    const bytes = await file.bytes();
    const target = dsSystemFileFor(file.name, bytes.length);
    if (!target) {
      rejected.push(file.name);
      continue;
    }
    const destination = dsSystemFile(target);
    destination.parentDirectory.create({ idempotent: true, intermediates: true });
    destination.create({ overwrite: true });
    await destination.write(bytes);
    stored.push(target);
  }
  if (stored.length === 0) {
    if (rejected.length === 0) return null;
    throw new Error(
      `${rejected.join(', ')} ${rejected.length === 1 ? "isn't" : "aren't"} a DS BIOS or firmware dump. Expected bios7.bin (16 KB), bios9.bin (4 KB) or firmware.bin (128–512 KB).`
    );
  }
  return stored;
}
