import { Directory, File, Paths } from 'expo-file-system';

import { listRomFiles } from '@/lib/setup';
import KrsEmulator from '@/modules/krs-emulator';

export type GameMeta = {
  favorite?: boolean;
  lastPlayedAt?: number;
  playSeconds?: number;
  lastAutoSaveAt?: number;
  quickSlot?: number;
  /** A user-chosen cover, stored in the app's covers folder. */
  coverFile?: string;
};

export type GameMetaMap = Record<string, GameMeta>;

export type Rom = {
  id: string;
  title: string;
  fileName: string;
  uri: string;
  sizeBytes: number;
  addedAt: number;
};

export type Game = Rom & GameMeta;

export type SortMode = 'lastPlayed' | 'name' | 'playTime' | 'added' | 'size';

export const SORT_OPTIONS: { mode: SortMode; label: string; summary: string }[] = [
  { mode: 'lastPlayed', label: 'Last played', summary: 'last played ↓' },
  { mode: 'name', label: 'Title A–Z', summary: 'title ↑' },
  { mode: 'playTime', label: 'Play time', summary: 'play time ↓' },
  { mode: 'added', label: 'Recently added', summary: 'added ↓' },
  { mode: 'size', label: 'File size', summary: 'size ↓' },
];

// Every mode except 'name' puts the highest value first and breaks ties by title.
const SORT_VALUE: Record<Exclude<SortMode, 'name'>, (game: Game) => number> = {
  lastPlayed: (game) => game.lastPlayedAt ?? 0,
  playTime: (game) => game.playSeconds ?? 0,
  added: (game) => game.addedAt,
  size: (game) => game.sizeBytes,
};

export type ScanProgress = {
  found: Rom[];
  /** 0 until the folder has been listed. */
  total: number;
  path: string | null;
};

export const EMPTY_SCAN: ScanProgress = { found: [], total: 0, path: null };

const SCAN_REPORT_MS = 50;
const BYTES_PER_MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

const metaFile = () => new File(Paths.document, 'library.json');

export function loadGameMeta(): GameMetaMap {
  try {
    const file = metaFile();
    return file.exists ? JSON.parse(file.textSync()) : {};
  } catch {
    return {};
  }
}

const metaListeners = new Set<(meta: GameMetaMap) => void>();

/** Calls the listener after every save. Returns a function that stops listening. */
export function subscribeGameMeta(listener: (meta: GameMetaMap) => void) {
  metaListeners.add(listener);
  return () => {
    metaListeners.delete(listener);
  };
}

export async function saveGameMeta(meta: GameMetaMap) {
  const file = metaFile();
  if (!file.exists) file.create();
  await file.write(JSON.stringify(meta));
  metaListeners.forEach((listener) => listener(meta));
}

export type PlayRequest = {
  game: Game;
  /** The save state to continue from, or null to boot the game. */
  startState: string | null;
};

let playRequest: PlayRequest | null = null;

/**
 * Hands a game to the Player. It isn't sent as a route parameter because the router decodes the
 * %2F in folder-picked file URIs, which turns them into the URI of the folder.
 */
export function requestPlay(request: PlayRequest) {
  playRequest = request;
}

export function getPlayRequest() {
  return playRequest;
}

/** Remembers when the game's auto-save was written, which is what offers Continue. */
export async function recordAutoSave(id: string) {
  const meta = loadGameMeta();
  await saveGameMeta({ ...meta, [id]: { ...meta[id], lastAutoSaveAt: Date.now() } });
}

export async function setQuickSlot(id: string, quickSlot: number) {
  const meta = loadGameMeta();
  await saveGameMeta({ ...meta, [id]: { ...meta[id], quickSlot } });
}

/** Marks the game as just played and adds to its total play time. */
export async function recordPlay(id: string, seconds: number) {
  const meta = loadGameMeta();
  const current = meta[id];
  await saveGameMeta({
    ...meta,
    [id]: {
      ...current,
      lastPlayedAt: Date.now(),
      playSeconds: (current?.playSeconds ?? 0) + seconds,
    },
  });
}

/**
 * Reads each ROM's details, reporting progress and yielding so the screen stays responsive.
 * Throws if the folder can no longer be read.
 */
export async function scanRoms(
  folderUri: string,
  signal: AbortSignal,
  onProgress: (progress: ScanProgress) => void
): Promise<Rom[]> {
  const files = listRomFiles(new Directory(folderUri));
  const found: Rom[] = [];
  let lastReport = 0;

  for (const { file, path } of files) {
    if (signal.aborted) break;
    found.push({
      id: path,
      title: romTitle(file.name),
      fileName: file.name,
      uri: file.uri,
      sizeBytes: file.size ?? 0,
      addedAt: file.modificationTime ?? 0,
    });

    if (Date.now() - lastReport >= SCAN_REPORT_MS) {
      onProgress({ found: [...found], total: files.length, path });
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastReport = Date.now();
    }
  }
  return found;
}

/** Deletes the ROM file and, if asked, its in-game save. */
export async function deleteRom(game: Game, alsoDeleteSave: boolean) {
  // Saves are named after the ROM's contents, so the name must be worked out before it's gone.
  const saveId = alsoDeleteSave ? await KrsEmulator.getSaveId(game.uri) : null;
  new File(game.uri).delete();
  if (saveId) {
    // Matches the folder and file name used by KrsEmulatorModule.
    const save = new File(Paths.document, 'saves', `${saveId}.sav`);
    if (save.exists) save.delete();
    const states = new Directory(Paths.document, 'states', saveId);
    if (states.exists) states.delete();
  }
}

/** Turns a file name like "moss_knight (EU).gba" into "Moss Knight". */
function romTitle(fileName: string) {
  const base = fileName.replace(/\.gba$/i, '');
  const title = base
    .replace(/[([].*?[)\]]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return base;
  // Leave deliberate capitalization alone; only all-lowercase names need fixing.
  return title === title.toLowerCase() ? title.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : title;
}

export function sortGames(games: Game[], mode: SortMode) {
  return [...games].sort((a, b) => {
    if (mode !== 'name') {
      const difference = SORT_VALUE[mode](b) - SORT_VALUE[mode](a);
      if (difference !== 0) return difference;
    }
    return a.title.localeCompare(b.title);
  });
}

export function coverInitials(title: string) {
  const words = title.split(/[\s_-]+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function formatLastPlayed(timestamp: number | undefined, now = Date.now()) {
  if (!timestamp) return 'Not played';
  const days = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Today 17:28", or "Not played" with no time. */
export function formatLastPlayedAt(timestamp: number | undefined) {
  return timestamp
    ? `${formatLastPlayed(timestamp)} ${formatClock(timestamp)}`
    : formatLastPlayed(timestamp);
}

export function formatFileSize(bytes: number) {
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}

export function formatPlayedAgo(timestamp: number, now = Date.now()) {
  const minutes = Math.max(1, Math.floor((now - timestamp) / 60000));
  if (minutes < 60) return `Played ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Played ${hours} h ago`;
  return `Played ${Math.floor(hours / 24)} d ago`;
}

export function formatPlayTime(seconds = 0) {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatClock(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
