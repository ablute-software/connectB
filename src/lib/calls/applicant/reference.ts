// Prompt 907 (I2) — the identifier an application shows (spec §5.1: "cada uma tem identificador"). Short, readable aloud, no
// ambiguous characters (no 0/O, 1/I/L). Generated on the server; the database refuses a duplicate.
import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newReference(): string {
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `APP-${pick()}-${pick()}`;
}
