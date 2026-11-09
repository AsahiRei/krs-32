import { Directory, File, Paths } from 'expo-file-system';

export type CheatType = 'raw' | 'encA' | 'encB' | 'auto';

export type Cheat = {
  id: string;
  name: string;
  type: CheatType;
  code: string;
  enabled: boolean;
};

export const CHEAT_TYPES: { type: CheatType; label: string; tag: string }[] = [
  { type: 'raw', label: 'Raw address · value', tag: 'RAW' },
  { type: 'encA', label: 'Encrypted type A', tag: 'ENC·A' },
  { type: 'encB', label: 'Encrypted type B', tag: 'ENC·B' },
  { type: 'auto', label: 'Auto-detect', tag: 'AUTO' },
];

export type CodeIssue = {
  line: number;
  column: number | null;
  message: string;
};

const FULL_CODE_DIGITS = 16;
const SHORT_CODE_DIGITS = 12;
const ADDRESS_DIGITS = 8;
// The GBA memory map runs from work RAM (0x02) through cartridge save memory (0x0E).
const FIRST_MEMORY_REGION = 0x02;
const LAST_MEMORY_REGION = 0x0e;

function isGbaAddress(hex: string) {
  const region = parseInt(hex.slice(0, 2), 16);
  return region >= FIRST_MEMORY_REGION && region <= LAST_MEMORY_REGION;
}

const stateFolder = (saveId: string) => new Directory(Paths.document, 'states', saveId);
const cheatsFile = (saveId: string) => new File(stateFolder(saveId), 'cheats.json');

export function loadCheats(saveId: string): Cheat[] {
  try {
    const file = cheatsFile(saveId);
    return file.exists ? JSON.parse(file.textSync()) : [];
  } catch {
    return [];
  }
}

export async function saveCheats(saveId: string, cheats: Cheat[]) {
  stateFolder(saveId).create({ idempotent: true, intermediates: true });
  const file = cheatsFile(saveId);
  if (!file.exists) file.create();
  await file.write(JSON.stringify(cheats));
}

export const newCheatId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const codeLines = (code: string) => code.split('\n').filter((line) => line.trim());

export const cheatTag = (type: CheatType) =>
  CHEAT_TYPES.find((option) => option.type === type)?.tag ?? '';

function acceptedLengths(type: CheatType) {
  return type === 'auto' ? [FULL_CODE_DIGITS, SHORT_CODE_DIGITS] : [FULL_CODE_DIGITS];
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
  lines.forEach((line, index) => {
    if (line.trim()) lastFilled = index;
  });

  for (let line = 0; line < lines.length; line++) {
    const column = lines[line].search(/[^0-9a-fA-F\s]/);
    if (column >= 0) {
      const digit = lines[line][column];
      return { line, column, message: `“${digit}” isn’t a hex digit. Use only 0–9 and A–F.` };
    }

    const digits = lines[line].replace(/\s/g, '').length;
    const accepted = acceptedLengths(type);
    const stillTyping = allowIncompleteLastLine && line === lastFilled && digits < accepted[0];
    if (digits > 0 && !accepted.includes(digits) && !stillTyping) {
      return {
        line,
        column: null,
        message: `Expected ${accepted.join(' or ')} hex digits, found ${digits}.`,
      };
    }

    const hex = lines[line].replace(/\s/g, '');
    if (type === 'raw' && hex.length >= ADDRESS_DIGITS && !isGbaAddress(hex)) {
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
        .replace(/\s/g, '')
        .toUpperCase()
        .replace(/(.{4})(?=.)/g, '$1 ')
    )
    .join('\n');
}

/** Turns one saved code line into the form the emulator core reads. */
function toCoreLine(line: string, type: CheatType) {
  const digits = line.replace(/\s/g, '');
  const address = digits.slice(0, 8);
  const value = digits.slice(8);
  // The core treats address:value as a plain memory write, and detects encrypted formats itself.
  return type === 'raw' ? `${address}:${value}` : `${address} ${value}`;
}

export function activeCheatLines(cheats: Cheat[]) {
  return cheats
    .filter((cheat) => cheat.enabled)
    .flatMap((cheat) => codeLines(cheat.code).map((line) => toCoreLine(line, cheat.type)));
}
