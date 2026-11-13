import { Directory, File, Paths } from 'expo-file-system';

import { loadGameMeta, saveGameMeta } from '@/lib/library';
import { systemForFile } from '@/lib/systems';
import { CoverSearchError, findBoxartUrl, hasCoverSearch } from '@/lib/thegamesdb';

export { hasCoverSearch };

const MAX_COVER_BYTES = 20 * 1024 * 1024;

const coversFolder = () => new Directory(Paths.document, 'covers');

export const coverUri = (fileName: string) => new File(coversFolder(), fileName).uri;

export function deleteCoverFile(fileName: string | undefined) {
  if (!fileName) return;
  const file = new File(coversFolder(), fileName);
  if (file.exists) file.delete();
}

/**
 * Lets the user pick an image and stores a private copy, so the cover stays if the original is
 * moved or deleted. Returns false if the picker was cancelled.
 */
export async function chooseCover(gameId: string): Promise<boolean> {
  const picked = await File.pickFileAsync({ mimeTypes: ['image/*'] });
  if (picked.canceled) return false;
  if ((picked.result.size ?? 0) > MAX_COVER_BYTES) {
    throw new Error('That image is too large. Choose one under 20 MB.');
  }

  const bytes = await picked.result.bytes();
  const fileName = newCoverFileName(picked.result.name);
  coversFolder().create({ idempotent: true, intermediates: true });
  const file = new File(coversFolder(), fileName);
  file.create();
  await file.write(bytes);

  await setCoverFile(gameId, fileName);
  return true;
}

// A new name each time means the image cache can't show the previous cover.
function newCoverFileName(sourceName: string) {
  const extension = sourceName.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'jpg';
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${extension}`;
}

async function setCoverFile(gameId: string, fileName: string) {
  const meta = loadGameMeta();
  const previous = meta[gameId]?.coverFile;
  await saveGameMeta({
    ...meta,
    [gameId]: { ...meta[gameId], coverFile: fileName, coverSearched: true },
  });
  deleteCoverFile(previous);
}

async function markCoverSearched(gameId: string) {
  const meta = loadGameMeta();
  await saveGameMeta({ ...meta, [gameId]: { ...meta[gameId], coverSearched: true } });
}

/**
 * Looks the game up on TheGamesDB and saves its box art as the cover. Returns false if no
 * matching game was found. Throws if the search or download fails.
 */
export async function downloadCover(
  game: { id: string; title: string },
  signal?: AbortSignal
): Promise<boolean> {
  const coverBefore = loadGameMeta()[game.id]?.coverFile;
  // A game's id is its path in the ROM folder, so it ends in the ROM's extension.
  const url = await findBoxartUrl(game.title, systemForFile(game.id) ?? 'gba', signal);
  if (!url) {
    await markCoverSearched(game.id);
    return false;
  }

  coversFolder().create({ idempotent: true, intermediates: true });
  const file = new File(coversFolder(), newCoverFileName(url));
  await File.downloadFileAsync(url, file);
  // Don't replace a cover the user chose while the download was running.
  if (signal?.aborted || loadGameMeta()[game.id]?.coverFile !== coverBefore) {
    file.delete();
    return false;
  }
  await setCoverFile(game.id, file.name);
  return true;
}

let fetchingMissingCovers = false;

/**
 * Downloads covers for games that have none and haven't been searched before. Runs one request at
 * a time to go easy on the API allowance, and stops early if the API refuses requests.
 */
export async function fetchMissingCovers(games: { id: string; title: string }[], signal: AbortSignal) {
  if (!hasCoverSearch || fetchingMissingCovers) return;
  fetchingMissingCovers = true;
  try {
    for (const game of games) {
      if (signal.aborted) return;
      const meta = loadGameMeta()[game.id];
      if (meta?.coverFile || meta?.coverSearched) continue;
      try {
        await downloadCover(game, signal);
      } catch (error) {
        if (error instanceof CoverSearchError) return;
        // A network error or a bad image only affects this game; try it again next scan.
      }
    }
  } finally {
    fetchingMissingCovers = false;
  }
}

export async function removeCover(gameId: string) {
  const meta = loadGameMeta();
  const previous = meta[gameId]?.coverFile;
  await saveGameMeta({ ...meta, [gameId]: { ...meta[gameId], coverFile: undefined } });
  deleteCoverFile(previous);
}
