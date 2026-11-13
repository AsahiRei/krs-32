import { Directory, File, Paths } from 'expo-file-system';

import type { GameSystem } from '@/lib/systems';

/** GBA formats, plus 'ards' for Action Replay DS codes, the only format the DS core reads. */
export type CheatType = 'raw' | 'encA' | 'encB' | 'auto' | 'ards';

export type Cheat = {
  id: string;
  name: string;
  type: CheatType;
  code: string;
  enabled: boolean;
};

type CheatTypeOption = { type: CheatType; label: string; tag: string };

export const CHEAT_TYPES: CheatTypeOption[] = [
  { type: 'raw', label: 'Raw address · value', tag: 'RAW' },
  { type: 'encA', label: 'Encrypted type A', tag: 'ENC·A' },
  { type: 'encB', label: 'Encrypted type B', tag: 'ENC·B' },
  { type: 'auto', label: 'Auto-detect', tag: 'AUTO' },
];

const DS_CHEAT_TYPES: CheatTypeOption[] = [{ type: 'ards', label: 'Action Replay DS', tag: 'AR DS' }];

/** The code formats a system's core understands; the first is the default for new cheats. */
export const cheatTypesFor = (system: GameSystem) =>
  system === 'nds' ? DS_CHEAT_TYPES : CHEAT_TYPES;

const ALL_CHEAT_TYPES = [...CHEAT_TYPES, ...DS_CHEAT_TYPES];

export type CodeIssue = {
  line: number;
  column: number | null;
  message: string;
};

const FULL_CODE_DIGITS = 16;
const SHORT_CODE_DIGITS = 12;
const ADDRESS_DIGITS = 8;
/** More lines than any real code needs; stops a bad paste from freezing the editor. */
export const MAX_CODE_LINES = 256;
// Characters ignored inside a code: whitespace, and the colon VBA-style raw codes put between
// address and value.
const SEPARATORS = /[\s:]/g;
const NOT_HEX_OR_SEPARATOR = /[^0-9a-fA-F\s:]/;
// The GBA memory map runs from work RAM (0x02) through cartridge save memory (0x0E).
const FIRST_MEMORY_REGION = 0x02;
const LAST_MEMORY_REGION = 0x0e;

function isGbaAddress(hex: string) {
  const region = parseInt(hex.slice(0, 2), 16);
  return region >= FIRST_MEMORY_REGION && region <= LAST_MEMORY_REGION;
}

const stateFolder = (saveId: string) => new Directory(Paths.document, 'states', saveId);
const cheatsFile = (saveId: string) => new File(stateFolder(saveId), 'cheats.json');

const CHEAT_TYPE_SET = new Set<string>(ALL_CHEAT_TYPES.map((option) => option.type));

function isCheat(value: unknown): value is Cheat {
  if (!value || typeof value !== 'object') return false;
  const cheat = value as Record<string, unknown>;
  return (
    typeof cheat.id === 'string' &&
    typeof cheat.name === 'string' &&
    typeof cheat.code === 'string' &&
    typeof cheat.enabled === 'boolean' &&
    typeof cheat.type === 'string' &&
    CHEAT_TYPE_SET.has(cheat.type)
  );
}

/**
 * Keeps an unreadable cheats file next to the original before it gets replaced, so a damaged
 * file never silently costs someone their codes.
 */
function backUpUnreadable(saveId: string, text: string) {
  try {
    const backup = new File(stateFolder(saveId), `cheats.unreadable-${Date.now()}.json`);
    backup.create();
    backup.write(text);
  } catch {
    // Best effort only.
  }
}

/** The saved cheats for a game. Entries that aren't valid cheats are skipped. */
export function loadCheats(saveId: string | undefined | null): Cheat[] {
  if (!saveId) return [];
  let text: string;
  try {
    const file = cheatsFile(saveId);
    if (!file.exists) return [];
    text = file.textSync();
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(isCheat);
  } catch {
    // Falls through to the backup below.
  }
  backUpUnreadable(saveId, text);
  return [];
}

export async function saveCheats(saveId: string, cheats: Cheat[]) {
  if (!saveId) throw new Error('No game to save cheats for.');
  stateFolder(saveId).create({ idempotent: true, intermediates: true });
  const file = cheatsFile(saveId);
  if (!file.exists) file.create();
  await file.write(JSON.stringify(cheats));
}

export const newCheatId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const codeLines = (code: string) => code.split('\n').filter((line) => line.trim());

export const cheatTag = (type: CheatType) =>
  ALL_CHEAT_TYPES.find((option) => option.type === type)?.tag ?? '';

function acceptedLengths(type: CheatType) {
  // Raw codes may be a 32-bit write (8-digit value) or a 16-bit write (4-digit value). Action
  // Replay DS lines are always two 8-digit words.
  return type === 'auto' || type === 'raw'
    ? [FULL_CODE_DIGITS, SHORT_CODE_DIGITS]
    : [FULL_CODE_DIGITS];
}

/** Cleans pasted text: Windows/Mac line endings and tabs become plain newlines and spaces. */
export function normalizeCodeInput(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
}

/**
 * The first problem in the entered code, or null. While the last line is still being typed it
 * can be too short without that counting as a problem yet.
 */
export function findCodeIssue(
  text: string,
  type: CheatType,
  allowIncompleteLastLine: boolean
): CodeIssue | null {
  const lines = text.split('\n');
  let lastFilled = -1;
  let filled = 0;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim()) {
      lastFilled = index;
      filled++;
    }
  }
  if (filled > MAX_CODE_LINES) {
    return {
      line: lastFilled,
      column: null,
      message: `A cheat can have at most ${MAX_CODE_LINES} lines. Split it into several cheats.`,
    };
  }

  const accepted = acceptedLengths(type);
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    if (!text.trim()) continue;

    const column = text.search(NOT_HEX_OR_SEPARATOR);
    if (column >= 0) {
      return { line, column, message: `“${text[column]}” isn’t a hex digit. Use only 0–9 and A–F.` };
    }

    const hex = text.replace(SEPARATORS, '');
    const digits = hex.length;
    const stillTyping =
      allowIncompleteLastLine && line === lastFilled && digits < Math.max(...accepted);
    if (!accepted.includes(digits) && !stillTyping) {
      return {
        line,
        column: null,
        message: `Expected ${accepted.join(' or ')} hex digits, found ${digits}.`,
      };
    }

    if (type === 'raw' && digits >= ADDRESS_DIGITS && !isGbaAddress(hex)) {
      return {
        line,
        column: null,
        message: `${hex.slice(0, ADDRESS_DIGITS).toUpperCase()} isn’t a GBA memory address. This looks like an encrypted code, so set Code type to Auto-detect.`,
      };
    }
  }
  return null;
}

/** Tidies entered code into uppercase groups of four, one code per line. */
export function formatCode(text: string) {
  return codeLines(text)
    .map((line) =>
      line
        .replace(SEPARATORS, '')
        .toUpperCase()
        .replace(/(.{4})(?=.)/g, '$1 ')
    )
    .join('\n');
}

/** Turns one saved code line into the form the emulator core reads. */
function toCoreLine(line: string, type: CheatType) {
  const digits = line.replace(SEPARATORS, '').toUpperCase();
  const address = digits.slice(0, 8);
  const value = digits.slice(8);
  // mGBA treats address:value as a plain memory write, and detects encrypted formats itself.
  // melonDS reads Action Replay DS lines as two words separated by a space.
  return type === 'raw' ? `${address}:${value}` : `${address} ${value}`;
}

const CORE_LINE = /^[0-9A-F]{8}[: ][0-9A-F]{4}(?:[0-9A-F]{4})?$/;

/**
 * One entry per enabled cheat, its lines joined with "+". The core keeps each entry in its own
 * set, so one cheat's encryption state can't garble another's codes.
 */
export function activeCheatCodes(cheats: Cheat[]) {
  return cheats
    .filter((cheat) => cheat.enabled)
    .map((cheat) =>
      codeLines(cheat.code)
        .map((line) => toCoreLine(line, cheat.type))
        // The core silently drops anything it can't parse, so only well-formed lines are sent.
        .filter((line) => CORE_LINE.test(line))
        .join('+')
    )
    .filter((code) => code.length > 0);
}
