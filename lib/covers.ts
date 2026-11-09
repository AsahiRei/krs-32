import { Directory, File, Paths } from 'expo-file-system';

import { loadGameMeta, saveGameMeta } from '@/lib/library';

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
  const extension = picked.result.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'jpg';
  // A new name each time means the image cache can't show the previous cover.
  const fileName = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${extension}`;

  coversFolder().create({ idempotent: true, intermediates: true });
  const file = new File(coversFolder(), fileName);
  file.create();
  await file.write(bytes);

  const meta = loadGameMeta();
  const previous = meta[gameId]?.coverFile;
  await saveGameMeta({ ...meta, [gameId]: { ...meta[gameId], coverFile: fileName } });
  deleteCoverFile(previous);
  return true;
}

export async function removeCover(gameId: string) {
  const meta = loadGameMeta();
  const previous = meta[gameId]?.coverFile;
  await saveGameMeta({ ...meta, [gameId]: { ...meta[gameId], coverFile: undefined } });
  deleteCoverFile(previous);
}
