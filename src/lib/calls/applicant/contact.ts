// Prompt 907 (I5) — the "Contact email for applicants" of a call: optional, and a plain address. Pure.
export type ParsedContact = { ok: true; email: string | null } | { ok: false; error: string };

const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseContactEmail(v: unknown): ParsedContact {
  if (v === null || v === undefined) return { ok: true, email: null };
  if (typeof v !== 'string') return { ok: false, error: 'Enter an email address.' };
  const e = v.trim();
  if (e === '') return { ok: true, email: null };
  if (e.length > 254 || !SHAPE.test(e)) return { ok: false, error: 'Enter a valid email address, or leave it empty.' };
  return { ok: true, email: e.toLowerCase() };
}
