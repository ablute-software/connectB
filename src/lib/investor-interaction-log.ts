// P133 (item 10) — investor-side interaction log. Builds one unified
// timeline per startup out of FOUR sources: manual entries (this table),
// the org-level interest/pass decision (investor_relationship_decisions),
// archive/reopen history (investor_archive_entries), and a MatchDeal
// conversation link-out when an active match exists (matchdeal_matches).
// Extracted so the CSV export can reuse the exact same computation the
// drawer itself uses — no separate query path.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface InteractionLink { label: string; url: string }
export interface TimelineEntry {
  id: string;
  kind: 'manual' | 'interested' | 'passed' | 'archived' | 'reopened' | 'matchdeal_link';
  automatic: boolean;
  at: string;
  channel: string | null;
  content: string;
  links: InteractionLink[];
}

const MAX_LINKS = 20;

// Freeform links, not uploads (v1 scope) — validated here rather than
// trusted from the client: only http(s) URLs, capped count, trimmed labels.
export function sanitizeLinks(raw: unknown): InteractionLink[] {
  if (!Array.isArray(raw)) return [];
  const out: InteractionLink[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LINKS) break;
    if (!item || typeof item !== 'object') continue;
    const url = typeof (item as { url?: unknown }).url === 'string' ? (item as { url: string }).url.trim() : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const rawLabel = typeof (item as { label?: unknown }).label === 'string' ? (item as { label: string }).label.trim() : '';
    out.push({ label: rawLabel || url, url });
  }
  return out;
}

export async function getInteractionTimeline(
  admin: SupabaseClient,
  opts: { investorCatalogEntityId: string; email: string; orgId: string },
): Promise<TimelineEntry[]> {
  const { investorCatalogEntityId, email, orgId } = opts;
  const entries: TimelineEntry[] = [];

  const { data: manual } = await admin.from('investor_interaction_log')
    .select('id, channel, content, links, occurred_at')
    .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('startup_org_id', orgId);
  for (const m of manual ?? []) {
    entries.push({
      id: m.id as string, kind: 'manual', automatic: false, at: m.occurred_at as string,
      channel: m.channel as string, content: m.content as string, links: sanitizeLinks(m.links),
    });
  }

  const { data: decision } = await admin.from('investor_relationship_decisions')
    .select('decision, reason_detail, decided_at').eq('org_id', orgId).eq('investor_catalog_entity_id', investorCatalogEntityId).maybeSingle();
  if (decision) {
    const label = decision.decision === 'passed' ? 'Passed' : 'Interest expressed';
    entries.push({
      id: `decision-${orgId}`, kind: decision.decision === 'passed' ? 'passed' : 'interested', automatic: true,
      at: decision.decided_at as string, channel: null,
      content: decision.reason_detail ? `${label} — ${decision.reason_detail}` : label, links: [],
    });
  }

  const { data: archiveRows } = await admin.from('investor_archive_entries')
    .select('id, archived_at, reopened_at, reason_detail').eq('org_id', orgId).eq('investor_email', email);
  for (const row of archiveRows ?? []) {
    const reason = row.reason_detail as string | null;
    entries.push({
      id: `archive-${row.id}`, kind: 'archived', automatic: true, at: row.archived_at as string, channel: null,
      content: reason ? `Archived — ${reason}` : 'Archived', links: [],
    });
    if (row.reopened_at) {
      entries.push({
        id: `reopen-${row.id}`, kind: 'reopened', automatic: true, at: row.reopened_at as string, channel: null,
        content: 'Reopened from Archive', links: [],
      });
    }
  }

  // Link-out only, no embedded chat (v1 scope — see the mini-prompt's own
  // note that embedding is a v2 decision). /pair has no per-match deep link
  // today (its tab state is local, not URL-driven — confirmed by reading
  // MatchDealShell.tsx), so this points at the app's one MatchDeal entry
  // point; the investor selects the Messages tab themselves once there.
  const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  if (startupProfile) {
    const { data: match } = await admin.from('matchdeal_matches').select('id, created_at')
      .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('startup_profile_id', startupProfile.id).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (match) {
      entries.push({
        id: `matchdeal-${match.id}`, kind: 'matchdeal_link', automatic: true, at: match.created_at as string,
        channel: null, content: 'Conversation on MatchDeal', links: [{ label: 'Open MatchDeal', url: '/pair' }],
      });
    }
  }

  return entries.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export async function createManualInteractionEntry(
  admin: SupabaseClient,
  opts: { investorCatalogEntityId: string; orgId: string; userId: string; channel: string; content: string; links: unknown; occurredAt?: string | null },
) {
  const content = opts.content.trim();
  if (!content) return { error: { message: 'Content is required.' } };
  const { error } = await admin.from('investor_interaction_log').insert({
    investor_catalog_entity_id: opts.investorCatalogEntityId, startup_org_id: opts.orgId, created_by: opts.userId,
    channel: opts.channel, content, links: sanitizeLinks(opts.links),
    ...(opts.occurredAt ? { occurred_at: opts.occurredAt } : {}),
  });
  return { error };
}
