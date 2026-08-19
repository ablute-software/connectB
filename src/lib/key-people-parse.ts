// Prompt 262/263 — entities.key_people is free text, one person per item,
// "Name (Role)" or "Name — Role" as seen in real data (migration 0032's own
// comment on the column: never parsed/converted, until now). Items are
// separated by ';' or '|', whichever the real text uses — not a format this
// codebase invented, so this parser stays permissive rather than picking one
// separator and rejecting the other.
export interface ParsedKeyPerson {
  fullName: string;
  role: string | null;
}

export function parseKeyPeopleText(raw: string): ParsedKeyPerson[] {
  return raw
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      // "Name (Role)" — role in trailing parentheses.
      const paren = item.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (paren) return { fullName: paren[1].trim(), role: paren[2].trim() || null };
      // "Name — Role" / "Name - Role" — em-dash, en-dash, or hyphen.
      const dash = item.match(/^(.+?)\s+[—–-]\s+(.+)$/);
      if (dash) return { fullName: dash[1].trim(), role: dash[2].trim() || null };
      return { fullName: item, role: null };
    })
    .filter((p) => p.fullName.length > 0);
}
