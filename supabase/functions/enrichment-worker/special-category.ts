// Prompt 634 §3.1 / §3.3 — the net between the model and the catalogue.
//
// The first web-path run ever (Prompt 630's controls) wrote, as the opening
// sentence of an identified person's profile in a shared commercial
// catalogue: "Born with diabetes, which he described as motivation to prove
// himself." That is Article 9 data — special category — and the catalogue's
// entire lawful basis (legitimate interest, Article 6(1)(f)) is not one of
// the Article 9(2) conditions. The same call listed "youngest partners ever"
// among the person's kill_words and then used it in the hook.
//
// This module is a NET, not a judge. It will err both ways and that is
// accepted; what is not accepted is its absence. Pure functions, no Deno
// APIs, so src/lib/special-category-guard.test.ts can import THIS file and
// test the code that is actually deployed rather than a copy of it.
//
// THE HARD PART IS THE FALSE POSITIVE. "Diabetes" in the bio of a digital-
// health investor is their market, not their medical history. So a term
// alone never rejects: it rejects only when a PERSONAL MARKER ("born with",
// "diagnosed", "his own", "struggled"…) sits within a short window of it.
// "invests in diabetes care" passes; "born with diabetes" does not.

const SPECIAL_CATEGORY_TERMS: RegExp[] = [
  // health / condition
  /diabet|cancer|illness|disabilit|diagnos|chronic|autis|\badhd\b|depress|anxiet|therap|addict|\brecovery\b|\bsober\b|surviv/i,
  // origin / belief
  /religio|muslim|jewish|christian|hindu|catholic|ethnic|\brace\b|immigrant|refugee/i,
  // politics / union
  /political|party member|union member|activist/i,
  // orientation
  /\bgay\b|lesbian|bisexual|transgender|sexual orientation/i,
];

// Prompt 634 §3.1's marker list, plus the two phrasings that most often
// carry the same meaning in profile prose ("lives with", "survivor of").
const PERSONAL_MARKERS = /born with|suffer(s|ed|ing)?|diagnosed|his own|her own|their own|personal(ly)?|struggl(e|ed|es|ing)|battl(e|ed|es|ing)|lives? with|living with|survivor of|overc(a|o)me/i;

/** Characters on either side of a term inside which a personal marker turns it into a rejection. */
export const PERSONAL_MARKER_WINDOW = 40;

export interface SpecialCategoryHit {
  term: string;
  marker: string;
  /** The stretch of text that tripped the net — for the audit row, never for the catalogue. */
  snippet: string;
}

/**
 * Returns the first special-category term that appears within
 * PERSONAL_MARKER_WINDOW characters of a personal marker, or null when the
 * text is clean OR the terms present read as professional domain.
 */
export function findSpecialCategoryMention(text: string | null | undefined): SpecialCategoryHit | null {
  if (!text) return null;
  for (const pattern of SPECIAL_CATEGORY_TERMS) {
    const global = new RegExp(pattern.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = global.exec(text)) !== null) {
      const start = Math.max(0, m.index - PERSONAL_MARKER_WINDOW);
      const end = Math.min(text.length, m.index + m[0].length + PERSONAL_MARKER_WINDOW);
      const window = text.slice(start, end);
      const marker = PERSONAL_MARKERS.exec(window);
      if (marker) return { term: m[0], marker: marker[0], snippet: window.trim() };
      if (m[0].length === 0) global.lastIndex += 1;
    }
  }
  return null;
}

export interface GuardedFields {
  kept: Record<string, string | null>;
  rejected: { field: string; term: string; marker: string; snippet: string }[];
}

/**
 * Prompt 634 §3.1 — reject the FIELD, never the job. A background that names
 * a condition is dropped; a clean hook, intro_path and watch_outs survive.
 */
export function stripSpecialCategoryFields(fields: Record<string, string | null | undefined>): GuardedFields {
  const kept: Record<string, string | null> = {};
  const rejected: GuardedFields['rejected'] = [];
  for (const [field, value] of Object.entries(fields)) {
    const hit = findSpecialCategoryMention(value);
    if (hit) {
      kept[field] = null;
      rejected.push({ field, ...hit });
    } else {
      kept[field] = value ?? null;
    }
  }
  return { kept, rejected };
}

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Prompt 634 §3.3 — a hook must not contain one of the same response's own
 * kill words. Not a literal substring test: the Bürk case was kill word
 * "youngest partners ever" against hook "…youngest VC partners ever", which
 * a literal check would have let through. A kill word is "contained" when
 * every one of its words appears in the hook, in order, with at most two
 * other words between consecutive ones.
 */
export function hookContainsKillWord(hook: string | null | undefined, killWords: string[] | null | undefined): string | null {
  if (!hook || !killWords?.length) return null;
  const h = tokens(hook);
  for (const kw of killWords) {
    const k = tokens(kw);
    if (k.length === 0) continue;
    let pos = 0;
    let matched = 0;
    let lastIndex = -1;
    for (let i = 0; i < h.length && matched < k.length; i++) {
      if (h[i] === k[matched]) {
        if (lastIndex >= 0 && i - lastIndex - 1 > 2) { matched = 0; lastIndex = -1; pos = 0; if (h[i] === k[0]) { matched = 1; lastIndex = i; } continue; }
        matched += 1;
        lastIndex = i;
      }
      pos = i;
    }
    if (matched === k.length) return kw;
  }
  return null;
}
