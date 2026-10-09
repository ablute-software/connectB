// Prompt 905 — explicit time zones for a call's opening and closing (spec §5.1: "com fuso horário
// explícito"). The editor shows the wall-clock time in the CHOSEN zone, the database stores the instant.
// No dependency: Intl does the zone arithmetic.

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; }
}

const FALLBACK_ZONES = [
  'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome',
  'Europe/Amsterdam', 'Atlantic/Azores', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Africa/Luanda', 'Africa/Maputo', 'Asia/Dubai', 'Asia/Singapore', 'UTC',
];

export function timeZoneOptions(): string[] {
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const all = sv ? sv('timeZone') : [];
    if (all.length > 0) return all.includes('UTC') ? all : [...all, 'UTC'];
  } catch { /* old runtime */ }
  return FALLBACK_ZONES;
}

type Parts = { y: number; mo: number; d: number; h: number; mi: number };

function partsInZone(ms: number, tz: string): Parts {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const get = (t: string) => Number(f.formatToParts(new Date(ms)).find((p) => p.type === t)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') };
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2026-11-01T09:00" read as wall-clock time in `tz` -> the UTC instant, as an ISO string. null if invalid. */
export function wallToUtcIso(wall: string, tz: string): string | null {
  const m = WALL.exec(wall);
  if (!m || !isValidTimeZone(tz)) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (Number.isNaN(asIfUtc)) return null;
  // Two passes settle the offset around DST changes.
  let guess = asIfUtc;
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(guess, tz);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += asIfUtc - shown;
  }
  const back = partsInZone(guess, tz);
  if (back.y !== y || back.mo !== mo || back.d !== d || back.h !== h || back.mi !== mi) return null; // a wall time that does not exist (DST gap)
  return new Date(guess).toISOString();
}

/** A UTC instant -> "YYYY-MM-DDTHH:mm" wall-clock time in `tz` (for a datetime-local input). */
export function utcToWall(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || !isValidTimeZone(tz)) return '';
  const p = partsInZone(ms, tz);
  const z = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${z(p.y, 4)}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** "09 Oct 2026, 15:00 (Europe/Lisbon)". */
export function formatInZone(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || !isValidTimeZone(tz)) return '—';
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(ms));
  return `${text} (${tz})`;
}

/** "09 Oct 2026" in `tz`. */
export function formatDayInZone(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || !isValidTimeZone(tz)) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(ms));
}
