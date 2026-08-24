import 'server-only';
// Prompt 348 — DB side of "Watching closely". Every write here is the one
// place each mutation happens — routes call these, never touch
// investor_watches/investor_watch_thresholds/investor_watch_alerts/
// watch_updates directly, so the double-opt-in state machine can't drift
// between callers.
import type { SupabaseClient } from '@supabase/supabase-js';
import { captureSnapshot, type SnapshotData } from './startup-snapshot';

export type WatchStatus = 'requested' | 'active' | 'declined' | 'revoked';
export interface WatchRow {
  id: string; org_id: string; investor_catalog_entity_id: string; status: WatchStatus;
  requested_at: string; decided_at: string | null; baseline_snapshot_id: string | null; last_seen_at: string | null;
}

// Investor-initiated. A prior declined/revoked watch is reopened (same row,
// unique(org_id, investor_catalog_entity_id)) rather than forking history —
// re-requesting after a decline is a normal "ask again later", not a new
// relationship.
export async function requestWatch(admin: SupabaseClient, orgId: string, investorCatalogEntityId: string): Promise<{ ok: true; watch: WatchRow } | { ok: false; error: string }> {
  const { data: existing } = await admin.from('investor_watches').select('*')
    .eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  if (existing && existing.status === 'active') return { ok: false, error: 'Already watching this startup.' };
  if (existing && existing.status === 'requested') return { ok: true, watch: existing as WatchRow };

  if (existing) {
    const { data, error } = await admin.from('investor_watches')
      .update({ status: 'requested', requested_at: new Date().toISOString(), decided_at: null, decided_by: null })
      .eq('id', existing.id).select('*').single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, watch: data as WatchRow };
  }
  const { data, error } = await admin.from('investor_watches')
    .insert({ org_id: orgId, investor_catalog_entity_id: investorCatalogEntityId }).select('*').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, watch: data as WatchRow };
}

// Founder-initiated. Activating captures the baseline snapshot — "what this
// investor sees, right now" — the exact same startup_profile_snapshots
// machinery the Archive's own "then vs now" already uses (startup-snapshot.ts).
export async function respondToWatch(
  admin: SupabaseClient, watchId: string, orgId: string, decision: 'active' | 'declined', decidedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: watch } = await admin.from('investor_watches').select('id, org_id, status')
    .eq('id', watchId).eq('org_id', orgId).eq('status', 'requested').maybeSingle();
  if (!watch) return { ok: false, error: 'No pending watch request found.' };

  const now = new Date().toISOString();
  if (decision === 'declined') {
    const { error } = await admin.from('investor_watches').update({ status: 'declined', decided_at: now, decided_by: decidedBy }).eq('id', watchId);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { id: snapshotId } = await captureSnapshot(admin, orgId, 'manual');
  const { error } = await admin.from('investor_watches')
    .update({ status: 'active', decided_at: now, decided_by: decidedBy, baseline_snapshot_id: snapshotId, last_seen_at: now })
    .eq('id', watchId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function revokeWatch(admin: SupabaseClient, watchId: string, orgId: string, decidedBy: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: watch } = await admin.from('investor_watches').select('id').eq('id', watchId).eq('org_id', orgId).eq('status', 'active').maybeSingle();
  if (!watch) return { ok: false, error: 'No active watch found.' };
  const { error } = await admin.from('investor_watches')
    .update({ status: 'revoked', decided_at: new Date().toISOString(), decided_by: decidedBy }).eq('id', watchId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface FounderWatcherRow { watchId: string; investorName: string; status: WatchStatus; requestedAt: string; decidedAt: string | null }

// Founder transparency ("quem me acompanha") — name and status only, NEVER
// the investor's own notes/ratings/orderings (none of which live on this
// table, or anywhere this query touches, by construction).
export async function getWatchersForOrg(admin: SupabaseClient, orgId: string): Promise<FounderWatcherRow[]> {
  const { data } = await admin.from('investor_watches')
    .select('id, status, requested_at, decided_at, catalog_entities(name)')
    .eq('org_id', orgId).in('status', ['requested', 'active']).order('requested_at', { ascending: false });
  return ((data ?? []) as unknown as { id: string; status: WatchStatus; requested_at: string; decided_at: string | null; catalog_entities: { name: string } | null }[])
    .map((r) => ({ watchId: r.id, investorName: r.catalog_entities?.name ?? 'An investor', status: r.status, requestedAt: r.requested_at, decidedAt: r.decided_at }));
}

export async function getActiveWatchesForInvestor(admin: SupabaseClient, investorCatalogEntityId: string): Promise<WatchRow[]> {
  const { data } = await admin.from('investor_watches').select('*')
    .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('status', 'active');
  return (data ?? []) as WatchRow[];
}

export async function findWatch(admin: SupabaseClient, orgId: string, investorCatalogEntityId: string): Promise<WatchRow | null> {
  const { data } = await admin.from('investor_watches').select('*')
    .eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  return (data as WatchRow | null) ?? null;
}

export async function getSnapshotData(admin: SupabaseClient, snapshotId: string): Promise<SnapshotData | null> {
  const { data } = await admin.from('startup_profile_snapshots').select('data').eq('id', snapshotId).maybeSingle();
  return (data?.data as SnapshotData | undefined) ?? null;
}

export async function markWatchSeen(admin: SupabaseClient, watchId: string): Promise<void> {
  await admin.from('investor_watches').update({ last_seen_at: new Date().toISOString() }).eq('id', watchId);
}
