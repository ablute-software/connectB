// Prompt 908 — what the back-office "Calls" page shows and does with its list, as pure functions: one row per
// call, search, status filter, sort. Read-only by design; applications appear only as NUMBERS (never their content).
import type { CallStatus, PromoterKind } from './types';

export interface PersonRef { name: string | null; email: string | null }

export interface BackofficeCallRow {
  id: string;
  name: string;
  status: CallStatus;
  organisation: { kind: PromoterKind; id: string; name: string; isTest: boolean };
  /** Who created the call. */
  admin: PersonRef;
  applications: { submitted: number; inProgress: number };
  linkToken: string | null;
  timezone: string;
  createdAt: string;
  opensAt: string | null;
  closesAt: string | null;
  // Shown when the row is expanded.
  phases: { name: string; startsOn: string | null; endsOn: string | null }[];
  fieldsPerPage: { page: number; fields: number }[];
  validatedBy: PersonRef | null;
  validatedAt: string | null;
  publishedAt: string | null;
}

export type CallSort = 'created' | 'organisation' | 'name';
export const CALL_SORT_LABELS: Record<CallSort, string> = {
  created: 'Created (newest first)', organisation: 'Organisation (A–Z)', name: 'Call name (A–Z)',
};
export const KIND_LABELS: Record<PromoterKind, string> = { catalog_entity: 'Investor firm', incubator: 'Incubator' };

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const time = (iso: string | null | undefined) => { const t = Date.parse(iso ?? ''); return Number.isNaN(t) ? 0 : t; };

export interface CallFilter { q?: string | null; status?: CallStatus | '' | null }

/** Search by organisation or call name; filter by status. */
export function filterCallRows(rows: BackofficeCallRow[], f: CallFilter): BackofficeCallRow[] {
  const q = norm(f.q);
  return rows.filter((r) => {
    if (f.status && r.status !== f.status) return false;
    if (q && !norm(r.organisation.name).includes(q) && !norm(r.name).includes(q)) return false;
    return true;
  });
}

/** Newest created first by default. */
export function sortCallRows(rows: BackofficeCallRow[], by: CallSort = 'created'): BackofficeCallRow[] {
  const copy = [...rows];
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  if (by === 'organisation') return copy.sort((a, b) => cmp(a.organisation.name, b.organisation.name) || time(b.createdAt) - time(a.createdAt));
  if (by === 'name') return copy.sort((a, b) => cmp(a.name, b.name) || time(b.createdAt) - time(a.createdAt));
  return copy.sort((a, b) => time(b.createdAt) - time(a.createdAt) || cmp(a.name, b.name));
}

/** "Ana Silva (ana@x.com)", the email alone, or a dash. */
export function personLabel(p: PersonRef | null | undefined): string {
  if (!p || (!p.name && !p.email)) return '—';
  return p.name && p.email ? `${p.name} (${p.email})` : (p.name ?? p.email)!;
}
