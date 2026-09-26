// Prompt 741 §B.1 — recordInvestorSignal/recordInvestorSignalForEntity,
// split OUT of investor-signal-events.ts into their own server-only file.
//
// investor-signal-events.ts is imported by PipelinePanel.tsx (a CLIENT
// component, for its client-safe PASS_REASON_CHIPS/SignalLevel/etc.).
// resolveInvestorCatalogEntityId (portal-access.ts) transitively imports
// org-closed.ts and pipeline-test-flag-capability.ts, both marked
// `import 'server-only'` — pulling that chain into investor-signal-events.ts
// broke the client build ("You're importing a component that needs
// server-only"). These two functions are only ever called from API routes
// (they take a service-role admin client), so they belong in their own
// file, same split this codebase already uses for data-room.ts vs.
// data-room-server.ts.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findOrOpenEpisode, isFirmTestOrInternal, writeSignalEvent, type SignalLevel } from './investor-signal-events';
import { resolveInvestorCatalogEntityId } from './portal-access';

// The resolve-firm → find/open-episode → test-flag → write dance that
// every one of Part B's five call sites would otherwise duplicate. Same
// best-effort posture as the existing card_opened write in
// /api/portal/startup/[orgId]: never throws, never blocks or fails the
// real action that triggered it. investorCatalogEntityId is resolved from
// userId here because four of the five call sites' actor IS the investor;
// the fifth (founder/interest-level-requests, deciding on the INVESTOR's
// episode) already has the investor's id in hand and must not resolve
// userId as an investor — it calls recordInvestorSignalForEntity directly.
export interface RecordInvestorSignalInput {
  userId: string;
  orgId: string;
  level: SignalLevel;
  kind: string;
  snapshot?: Record<string, unknown> | null;
  dedupKey?: string | null;
}

export async function recordInvestorSignal(admin: SupabaseClient, input: RecordInvestorSignalInput): Promise<{ id: string | null; deduped: boolean }> {
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, input.userId);
  if (!investorCatalogEntityId) return { id: null, deduped: false };
  return recordInvestorSignalForEntity(admin, { ...input, investorCatalogEntityId, actorUserId: input.userId });
}

export interface RecordInvestorSignalForEntityInput {
  investorCatalogEntityId: string;
  orgId: string;
  actorUserId?: string | null;
  level: SignalLevel;
  kind: string;
  snapshot?: Record<string, unknown> | null;
  dedupKey?: string | null;
}

export async function recordInvestorSignalForEntity(admin: SupabaseClient, input: RecordInvestorSignalForEntityInput): Promise<{ id: string | null; deduped: boolean }> {
  try {
    const episodeId = await findOrOpenEpisode(admin, input.investorCatalogEntityId, input.orgId);
    const isTestOrInternal = await isFirmTestOrInternal(admin, input.investorCatalogEntityId);
    return await writeSignalEvent(admin, {
      episodeId, actorUserId: input.actorUserId ?? null, level: input.level, kind: input.kind,
      snapshot: input.snapshot ?? null, dedupKey: input.dedupKey ?? null, isTestOrInternal,
    });
  } catch (e) {
    console.error(`recordInvestorSignal failed (${input.kind}):`, e);
    return { id: null, deduped: false };
  }
}
