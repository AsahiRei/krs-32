/** The systems the player can run. Each has its own emulator core. */
export type GameSystem = 'gba' | 'nds';

type SystemInfo = {
  /** Short name for labels, such as on a game card. */
  label: string;
  /** ROM file extensions, lowercase and with the dot. */
  extensions: string[];
  /** TheGamesDB's platform id, for cover search. */
  theGamesDbPlatform: string;
};

export const SYSTEMS: Record<GameSystem, SystemInfo> = {
  gba: { label: 'GBA', extensions: ['.gba'], theGamesDbPlatform: '5' },
  nds: { label: 'DS', extensions: ['.nds'], theGamesDbPlatform: '8' },
};

const ALL_EXTENSIONS = Object.values(SYSTEMS).flatMap((system) => system.extensions);

/** The system a ROM file belongs to, going by its extension, or null if it isn't a ROM. */
export function systemForFile(fileName: string): GameSystem | null {
  const name = fileName.toLowerCase();
  for (const [system, info] of Object.entries(SYSTEMS) as [GameSystem, SystemInfo][]) {
    if (info.extensions.some((extension) => name.endsWith(extension))) return system;
  }
  return null;
}

/** "moss_knight (EU).gba" → "moss_knight (EU)". */
export function stripRomExtension(fileName: string) {
  const lower = fileName.toLowerCase();
  const extension = ALL_EXTENSIONS.find((candidate) => lower.endsWith(candidate));
  return extension ? fileName.slice(0, -extension.length) : fileName;
}

/** A readable list of the supported extensions, such as ".gba, .nds". */
export const ROM_EXTENSIONS_LABEL = ALL_EXTENSIONS.join(', ');
