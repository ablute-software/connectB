// Prompt 927 (F) — two calls of one organisation never have the same name. The comparison ignores case, accents and extra spaces ("INNOV-ID", "innov-id" and "  Innov-ID " are the same name); another organisation
// may use the same name. Active, archived and recently deleted calls count (a deleted call can be restored within its 30 days, and restoring one would clash); a call already purged does not. This module is pure:
// the server loads the organisation's calls and asks it; the suggestions come from here (no AI) and are always names that are free.

export const DEFAULT_CALL_NAME = 'Untitled call';

export interface NamedCall { id: string; name: string; /** Set when the call is in "Deleted calls": it only counts until its purge date. */ deletedAt?: string | null; purgeAfter?: string | null }

/** The name as it is compared: no case, no accents, one space between words. */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The calls whose name still counts: every one that exists, except a deleted one past its purge date (gone for good, whatever the clean-up has or has not run). */
export function countingCalls(calls: NamedCall[], now: Date = new Date()): NamedCall[] {
  return calls.filter((c) => !(c.deletedAt && c.purgeAfter && new Date(c.purgeAfter).getTime() <= now.getTime()));
}

/** The call that already has this name (another one than `exceptId`), or null. */
export function findNameClash(calls: NamedCall[], name: string, exceptId?: string | null, now: Date = new Date()): NamedCall | null {
  const key = nameKey(name);
  if (!key) return null;
  return countingCalls(calls, now).find((c) => c.id !== exceptId && nameKey(c.name) === key) ?? null;
}

const ORDINAL = (n: number): string => {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

/** Up to three names that are free, made from this one: with the year ("INNOV-ID 2026"), with the edition ("INNOV-ID — 2nd edition") and with a number ("INNOV-ID 2"). */
export function suggestNames(calls: NamedCall[], name: string, now: Date = new Date(), howMany = 3): string[] {
  const base = name.trim().replace(/\s+/g, ' ').slice(0, 150);
  const taken = new Set(countingCalls(calls, now).map((c) => nameKey(c.name)));
  const out: string[] = [];
  const offer = (candidate: string) => { const k = nameKey(candidate); if (k && !taken.has(k) && !out.some((o) => nameKey(o) === k)) out.push(candidate); };
  // a name that already ends in a year or an edition is moved on, not given a second one
  const year = now.getFullYear();
  const endsWithYear = /\b(20\d{2})$/.exec(base);
  const plain = endsWithYear ? base.slice(0, endsWithYear.index).trim() : base;
  offer(`${plain || base} ${endsWithYear ? Number(endsWithYear[1]) + 1 : year}`);
  for (let n = 2; n <= 9 && out.length < 2; n++) offer(`${plain || base} — ${ORDINAL(n)} edition`);
  for (let n = 2; n <= 99 && out.length < howMany; n++) offer(`${plain || base} ${n}`);
  for (let n = 2; n <= 9 && out.length < howMany; n++) offer(`${plain || base} — ${ORDINAL(n)} edition`);
  return out.slice(0, howMany);
}

/** The name of a new call that was given none: "Untitled call", then "Untitled call 2", "Untitled call 3"… — the first one that is free. */
export function freeDefaultName(calls: NamedCall[], now: Date = new Date()): string {
  const taken = new Set(countingCalls(calls, now).map((c) => nameKey(c.name)));
  if (!taken.has(nameKey(DEFAULT_CALL_NAME))) return DEFAULT_CALL_NAME;
  for (let n = 2; n < 1000; n++) if (!taken.has(nameKey(`${DEFAULT_CALL_NAME} ${n}`))) return `${DEFAULT_CALL_NAME} ${n}`;
  return `${DEFAULT_CALL_NAME} ${Date.now()}`;
}

/** The name of a copy: "X (copy)", then "X (copy 2)"… — the first that is free, so a duplicate never needs to be renamed straight away. Kept within 200 characters. */
export function freeCopyName(calls: NamedCall[], sourceName: string, now: Date = new Date()): string {
  const taken = new Set(countingCalls(calls, now).map((c) => nameKey(c.name)));
  const base = sourceName.trim().replace(/\s+/g, ' ');
  const make = (suffix: string) => `${base.slice(0, 200 - suffix.length - 1).trim()} ${suffix}`;
  for (let n = 1; n < 1000; n++) {
    const candidate = make(n === 1 ? '(copy)' : `(copy ${n})`);
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return make(`(copy ${Date.now()})`);
}

/** The message the entity reads, and what the editor needs to offer a way out (the call that has the name, the free names). */
export interface NameClash { code: 'duplicate_name'; error: string; existing: { id: string; name: string; deleted: boolean }; suggestions: string[] }

export function nameClashBody(calls: NamedCall[], name: string, exceptId?: string | null, now: Date = new Date()): NameClash | null {
  const clash = findNameClash(calls, name, exceptId, now);
  if (!clash) return null;
  return {
    code: 'duplicate_name',
    error: `There is already a call named «${clash.name}» in your organisation${clash.deletedAt ? ' (in Deleted calls)' : ''}.`,
    existing: { id: clash.id, name: clash.name, deleted: !!clash.deletedAt },
    suggestions: suggestNames(calls, clash.name, now),            // built from the name as the existing call spells it
  };
}
