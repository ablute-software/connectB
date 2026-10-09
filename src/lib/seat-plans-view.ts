// Prompt 904, Adenda 1 (v2) — what the four sub-tabs of /backoffice/seat-plans do with their lists, as PURE
// functions: search, sort, filter, which sub-tab a URL means, whether a firm is offered the creation form or the
// shortcut. The page only renders what these return, so the behaviour is tested without a browser.

export const SEAT_TABS = ['create', 'plans', 'history', 'ended'] as const;
export type SeatTab = (typeof SEAT_TABS)[number];
export const DEFAULT_SEAT_TAB: SeatTab = 'create';
export const SEAT_TAB_LABELS: Record<SeatTab, string> = {
  create: 'Create plan', plans: 'Firms with a custom plan', history: 'History', ended: 'Ended plans',
};

/** ?tab=… -> a sub-tab. Anything unknown (or missing) is the first one, so a stale link never shows a blank page. */
export function parseSeatTab(value: string | null | undefined): SeatTab {
  return (SEAT_TABS as readonly string[]).includes(value ?? '') ? (value as SeatTab) : DEFAULT_SEAT_TAB;
}

/** The URL of a sub-tab (and of the firm that is picked / open in it). The default sub-tab is the bare path. */
export function seatTabHref(pathname: string, tab: SeatTab, firm: string | null = null): string {
  const params = new URLSearchParams();
  if (tab !== DEFAULT_SEAT_TAB) params.set('tab', tab);
  if (firm) params.set('firm', firm);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** The first sub-tab for a picked firm: the creation form, or — if a plan is already active — the shortcut. */
export function createTabView(hasActivePlan: boolean): 'form' | 'shortcut' {
  return hasActivePlan ? 'shortcut' : 'form';
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const time = (iso: string | null | undefined) => { const t = Date.parse(iso ?? ''); return Number.isNaN(t) ? 0 : t; };

// --- Sub-tab 2: firms with an active plan ------------------------------------------------------------------

export interface PlanRow {
  entityId: string; name: string; planName: string; seats: number; used: number; reserved: number; free: number;
  adminEmail: string | null; activatedVia: string; tier: string; createdAt: string; updatedAt: string;
}
export type PlanSort = 'created' | 'changed' | 'name';
export const PLAN_SORT_LABELS: Record<PlanSort, string> = { created: 'Plan created (newest first)', changed: 'Last changed (newest first)', name: 'Firm name (A–Z)' };

export function searchPlans<T extends { name: string }>(rows: T[], q: string): T[] {
  const needle = norm(q);
  return needle ? rows.filter((r) => norm(r.name).includes(needle)) : rows;
}

export function sortPlans(rows: PlanRow[], by: PlanSort = 'created'): PlanRow[] {
  const copy = [...rows];
  if (by === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const key = by === 'changed' ? 'updatedAt' : 'createdAt';
  return copy.sort((a, b) => time(b[key]) - time(a[key]) || a.name.localeCompare(b.name));
}

// --- Sub-tab 4: ended plans --------------------------------------------------------------------------------

export interface EndedMember { userId: string | null; email: string | null; name: string | null; role: string | null; since: string | null }
export interface EndedRow {
  id: string; entityId: string; name: string; planName: string; seats: number; adminEmail: string | null; activatedVia: string;
  planCreatedAt: string; endedAt: string; endedByEmail: string | null; members: EndedMember[]; reconstructed: boolean;
}
export type EndedSort = 'ended' | 'name';
export const ENDED_SORT_LABELS: Record<EndedSort, string> = { ended: 'Ended (newest first)', name: 'Firm name (A–Z)' };

export function sortEnded(rows: EndedRow[], by: EndedSort = 'ended'): EndedRow[] {
  const copy = [...rows];
  if (by === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || time(b.endedAt) - time(a.endedAt));
  return copy.sort((a, b) => time(b.endedAt) - time(a.endedAt) || a.name.localeCompare(b.name));
}

export const ACTIVATED_VIA_LABELS: Record<string, string> = { backoffice: 'Assigned by the back-office', promo_code: 'Activated with a code' };

// --- Sub-tab 3: the history of every firm -------------------------------------------------------------------

export interface HistoryRow {
  id: number; createdAt: string; entityId: string; firm: string; event: string;
  /** Who did it (the back-office admin or the firm's administrator), when known. */
  actorEmail: string | null;
  /** The person it is about, when there is one. */
  personEmail: string | null;
  detail: Record<string, unknown>;
}

export const EVENT_LABELS: Record<string, string> = {
  seat_granted: 'Seat granted', seat_released: 'Seat released', plan_set: 'Plan set', plan_ended: 'Plan ended',
  admin_changed: 'Administrator changed', invite_created: 'Seat reserved', invite_cancelled: 'Reservation cancelled',
  claim_approved: 'Claim approved', claim_declined: 'Claim declined', code_created: 'Code created',
  code_redeemed: 'Code used', code_revoked: 'Code revoked', code_deleted: 'Code deleted',
};
export const EVENT_TYPES = Object.keys(EVENT_LABELS);
export const eventLabel = (event: string) => EVENT_LABELS[event] ?? event.replace(/_/g, ' ');

export interface HistoryFilter {
  entityId?: string | null; event?: string | null;
  /** YYYY-MM-DD, inclusive, UTC. */
  from?: string | null; to?: string | null;
  /** Firm name or an email. */
  q?: string | null;
}

const dayStart = (d: string) => Date.parse(`${d}T00:00:00.000Z`);
const dayEnd = (d: string) => Date.parse(`${d}T23:59:59.999Z`);

export function filterHistory(rows: HistoryRow[], f: HistoryFilter): HistoryRow[] {
  const q = norm(f.q);
  const from = f.from ? dayStart(f.from) : null;
  const to = f.to ? dayEnd(f.to) : null;
  return rows
    .filter((r) => {
      if (f.entityId && r.entityId !== f.entityId) return false;
      if (f.event && r.event !== f.event) return false;
      const t = time(r.createdAt);
      if (from !== null && !Number.isNaN(from) && t < from) return false;
      if (to !== null && !Number.isNaN(to) && t > to) return false;
      if (q) {
        const hay = [r.firm, r.actorEmail, r.personEmail, typeof r.detail.email === 'string' ? r.detail.email : ''].map(norm).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id - a.id);
}

/** One line of "what happened", from the event's own detail. */
export function describeEvent(r: Pick<HistoryRow, 'event' | 'detail' | 'personEmail'>): string {
  const d = r.detail;
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null);
  const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : null);
  const parts: string[] = [];
  switch (r.event) {
    case 'plan_set': {
      const seats = num('seats'); const prev = num('previousSeats');
      if (seats !== null) parts.push(prev !== null && prev !== seats ? `${prev} → ${seats} seats` : `${seats} seats`);
      if (str('planName')) parts.push(str('planName')!);
      if (str('adminEmail')) parts.push(`administrator ${str('adminEmail')}`);
      break;
    }
    case 'plan_ended': { const seats = num('seats'); const m = num('members'); if (seats !== null) parts.push(`${seats} seats`); if (m !== null) parts.push(`${m} member${m === 1 ? '' : 's'} at the time`); break; }
    case 'code_created': if (str('codeHint')) parts.push(`code …${str('codeHint')}`); if (num('seats') !== null) parts.push(`${num('seats')} seats`); break;
    case 'code_deleted': case 'code_redeemed': if (str('codeHint') ?? str('code_hint')) parts.push(`code …${str('codeHint') ?? str('code_hint')}`); if (str('wasState')) parts.push(`was ${str('wasState')}`); break;
    case 'admin_changed': if (str('email')) parts.push(str('email')!); break;
    default: if (str('email') && str('email') !== r.personEmail) parts.push(str('email')!);
  }
  if (str('via') === 'backoffice_add') parts.push('added directly by the back-office');
  else if (str('via') === 'backoffice') parts.push('by the back-office');
  if (str('reason')) parts.push(str('reason')!);
  return parts.join(' · ');
}

// --- Codes bound to a firm (point 3) -----------------------------------------------------------------------

export type SeatCodeState = 'active' | 'used' | 'revoked' | 'expired';
interface CodeLike { status: 'active' | 'redeemed' | 'revoked'; expiresAt: string }

export function seatCodeState(c: CodeLike, now: Date = new Date()): SeatCodeState {
  if (c.status === 'redeemed') return 'used';
  if (c.status === 'revoked') return 'revoked';
  return new Date(c.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active';
}

/** By default only the codes that can still be used; "Show used, revoked and expired" shows the rest. */
export function filterSeatCodes<T extends CodeLike>(codes: T[], showAll: boolean, now: Date = new Date()): T[] {
  return showAll ? codes : codes.filter((c) => seatCodeState(c, now) === 'active');
}

/** A code that was never used may be deleted; a used one is the proof of how the firm got its seats. */
export const canDeleteSeatCode = (c: Pick<CodeLike, 'status'>): boolean => c.status !== 'redeemed';
