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

// Prompt 264 — bulk promotion can't eyeball each of 248 entities like the
// single-entity "Add as contact" button could; this is the "did this
// actually parse cleanly" check that decides needs-review vs safe-to-apply.
// Conservative on purpose (whole entity flagged, not just the one bad
// item): a partially-applied entity (2 of 3 names right, 1 garbled) is
// worse than one that waits for a human, per the prompt's own "nunca
// escrever um nome errado ou um cargo cortado a meio."
export function keyPeopleParseNeedsReview(parsed: ParsedKeyPerson[]): boolean {
  if (parsed.length === 0) return true;
  return parsed.some((p) => p.role === null || p.fullName.length < 2 || p.fullName.length > 60);
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
