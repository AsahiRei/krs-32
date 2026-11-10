const API_URL = 'https://api.thegamesdb.net/v1.1/Games/ByGameName';
// TheGamesDB's platform id for Game Boy Advance.
const GBA_PLATFORM_ID = '5';
// Below this, the best result is more likely a different game than the right one.
const MIN_MATCH_SCORE = 0.6;

const apiKey = process.env.EXPO_PUBLIC_TGDB_API_KEY;

export const hasCoverSearch = !!apiKey;

type GameImage = { side?: string; filename: string };

type SearchResponse = {
  code: number;
  status: string;
  data?: { games: { id: number; game_title: string }[] };
  include?: {
    boxart?: {
      base_url: Record<string, string>;
      data: Record<string, GameImage[]>;
    };
  };
};

export class CoverSearchError extends Error {}

/**
 * Finds the front box art for the GBA game whose name best matches the title, or null if no
 * result is close enough. Throws CoverSearchError if the API refuses the request.
 */
export async function findBoxartUrl(title: string, signal?: AbortSignal): Promise<string | null> {
  if (!apiKey) throw new CoverSearchError('Cover search isn’t set up in this build.');

  const query = new URLSearchParams({
    apikey: apiKey,
    name: searchableTitle(title),
    'filter[platform]': GBA_PLATFORM_ID,
    include: 'boxart',
  });
  const response = await fetch(`${API_URL}?${query}`, { signal });
  const body: SearchResponse = await response.json().catch(() => ({ code: response.status, status: '' }));
  if (body.code !== 200) {
    throw new CoverSearchError(
      body.code === 403 ? 'Cover search limit reached. Try again later.' : 'Cover search failed.'
    );
  }

  const games = body.data?.games ?? [];
  const boxart = body.include?.boxart;
  if (!boxart) return null;

  const wanted = normalize(title);
  let best: { score: number; image: GameImage } | null = null;
  for (const game of games) {
    const images = boxart.data[String(game.id)] ?? [];
    const image = images.find((candidate) => candidate.side === 'front') ?? images[0];
    if (!image) continue;
    const score = similarity(wanted, normalize(game.game_title));
    if (!best || score > best.score) best = { score, image };
  }
  if (!best || best.score < MIN_MATCH_SCORE) return null;

  const baseUrl = boxart.base_url.medium ?? boxart.base_url.original;
  return baseUrl + best.image.filename;
}

/** "Legend of Zelda, The - The Minish Cap" → "The Legend of Zelda - The Minish Cap". */
function searchableTitle(title: string) {
  return title.replace(/^(.+?), (The|A|An)\b/i, '$2 $1');
}

function normalize(title: string) {
  return searchableTitle(title)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Share of words the two titles have in common (Dice coefficient), 1 for identical titles. */
function similarity(a: string, b: string) {
  if (a === b) return 1;
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  let shared = 0;
  wordsA.forEach((word) => {
    if (wordsB.has(word)) shared++;
  });
  return (2 * shared) / (wordsA.size + wordsB.size);
}
