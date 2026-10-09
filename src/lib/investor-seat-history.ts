// Prompt 904, Adenda 1 (v2) — the history of every firm in one list (sub-tab 3). Server side: it reads
// investor_seat_events with the filters the database can do (firm, event type, dates), names the firms and the
// people, and applies the free-text search (a firm name or an email) with the same pure function the page and
// the tests use. Newest first. A cap keeps the answer small: 300 rows, with `truncated` saying so.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { filterHistory, type HistoryFilter, type HistoryRow } from './seat-plans-view';

type Row = Record<string, unknown>;
const FETCH_CAP = 1000;
export const HISTORY_PAGE = 300;

export async function loadSeatHistory(
  admin: SupabaseClient, f: HistoryFilter,
): Promise<{ rows: HistoryRow[]; truncated: boolean }> {
  let q = admin.from('investor_seat_events')
    .select('id, catalog_entity_id, user_id, actor_user_id, event, detail, created_at')
    .order('id', { ascending: false }).limit(FETCH_CAP);
  if (f.entityId) q = q.eq('catalog_entity_id', f.entityId);
  if (f.event) q = q.eq('event', f.event);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) q = q.gte('created_at', `${f.from}T00:00:00.000Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) q = q.lte('created_at', `${f.to}T23:59:59.999Z`);
  const { data } = await q;
  const events = (data ?? []) as Row[];

  const entityIds = [...new Set(events.map((e) => e.catalog_entity_id as string))];
  const { data: ents } = entityIds.length ? await admin.from('catalog_entities').select('id, name').in('id', entityIds) : { data: [] };
  const nameBy = new Map(((ents ?? []) as Row[]).map((e) => [e.id as string, e.name as string]));

  const userIds = [...new Set(events.flatMap((e) => [e.user_id, e.actor_user_id]).filter((x): x is string => typeof x === 'string'))];
  const emailBy = new Map<string, string | null>();
  await Promise.all(userIds.map(async (id) => {
    const { data: u } = await admin.auth.admin.getUserById(id);
    emailBy.set(id, u?.user?.email?.toLowerCase() ?? null);
  }));

  const rows = events.map((e): HistoryRow => ({
    id: e.id as number, createdAt: e.created_at as string, entityId: e.catalog_entity_id as string,
    firm: nameBy.get(e.catalog_entity_id as string) ?? 'Unknown firm', event: e.event as string,
    actorEmail: e.actor_user_id ? emailBy.get(e.actor_user_id as string) ?? null : null,
    personEmail: e.user_id ? emailBy.get(e.user_id as string) ?? null : null,
    detail: (e.detail as Record<string, unknown> | null) ?? {},
  }));
  const filtered = filterHistory(rows, f);
  return { rows: filtered.slice(0, HISTORY_PAGE), truncated: filtered.length > HISTORY_PAGE || events.length >= FETCH_CAP };
}
