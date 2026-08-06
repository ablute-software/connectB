// P133 (item 10) — investor-side interaction log. Builds one unified
// timeline per startup out of FOUR sources: manual entries (this table),
// the org-level interest/pass decision (investor_relationship_decisions),
// archive/reopen history (investor_archive_entries), and a MatchDeal
// conversation link-out when an active match exists (matchdeal_matches).
// Extracted so the CSV export can reuse the exact same computation the
// drawer itself uses — no separate query path.
import type { SupabaseClient } from '@supabase/supabase-js';
import { findActiveMatchDealMatch } from './matchdeal-active-match';
import { interactionLogPersonDocumentAvailable } from './investor-interaction-log-capability';

export interface InteractionLink { label: string; url: string }
export interface TimelineEntry {
  id: string;
  kind: 'manual' | 'interested' | 'passed' | 'archived' | 'reopened' | 'matchdeal_link';
  automatic: boolean;
  at: string;
  channel: string | null;
  content: string;
  links: InteractionLink[];
  // P134-D (§4) — who the manual entry was with (a company_people row at
  // the startup, or free text when that person isn't registered anywhere
  // yet) and an optional attached data-room document. Always null on
  // automatic entries.
  personName: string | null;
  document: { id: string; name: string } | null;
}

export interface StartupPersonOption { id: string; fullName: string; title: string | null; isFounder: boolean; linkedinUrl: string | null }

// Shared by the interaction-log form's person picker AND the dossier's
// Overview tab (P134-D §4) — company_people has no cross-org RLS read
// path (confirmed in MatchDealDeck.tsx's own comment), so this is only
// ever called with a service-role client, never exposed as a client-side
// query. Deliberately does NOT select email — the Overview tab renders
// this same list, and emails are gated behind the disclosure ladder (§5,
// pending Nuno's own product decision) everywhere this is used until then.
export async function getStartupPeople(admin: SupabaseClient, orgId: string): Promise<StartupPersonOption[]> {
  const { data } = await admin.from('company_people').select('id, full_name, title, is_founder, linkedin_url')
    .eq('org_id', orgId).order('sort_order', { ascending: true });
  return (data ?? []).map((p) => ({
    id: p.id as string, fullName: p.full_name as string, title: p.title as string | null,
    isFounder: p.is_founder as boolean, linkedinUrl: p.linkedin_url as string | null,
  }));
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

  // P134-D §4 — person_id/person_name_other/document_id only exist once
  // migration 0130 has landed; two literal select strings (not one
  // runtime-conditional string) so supabase-js's column-name inference
  // still works in both branches, same pattern as round-valuation-basis.
  const personDocAvailable = await interactionLogPersonDocumentAvailable();
  const manualQuery = personDocAvailable
    ? admin.from('investor_interaction_log')
        .select('id, channel, content, links, occurred_at, person_id, person_name_other, document_id')
        .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('startup_org_id', orgId)
    : admin.from('investor_interaction_log')
        .select('id, channel, content, links, occurred_at')
        .eq('investor_catalog_entity_id', investorCatalogEntityId).eq('startup_org_id', orgId);
  const { data: manualRaw } = await manualQuery;
  const manual = (manualRaw ?? []) as {
    id: string; channel: string; content: string; links: unknown; occurred_at: string;
    person_id?: string | null; person_name_other?: string | null; document_id?: string | null;
  }[];

  // Resolve person/document display names once for the whole batch rather
  // than per-row — the interaction log for one startup is never large.
  const personIds = [...new Set(manual.map((m) => m.person_id ?? null).filter((v): v is string => !!v))];
  const { data: people } = personIds.length
    ? await admin.from('company_people').select('id, full_name').in('id', personIds) : { data: [] as { id: string; full_name: string }[] };
  const personNameById = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));

  const documentIds = [...new Set(manual.map((m) => m.document_id ?? null).filter((v): v is string => !!v))];
  const { data: docs } = documentIds.length
    ? await admin.from('documents').select('id, name').in('id', documentIds) : { data: [] as { id: string; name: string }[] };
  const docById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));

  for (const m of manual) {
    const personId = m.person_id ?? null;
    const personNameOther = m.person_name_other ?? null;
    const documentId = m.document_id ?? null;
    entries.push({
      id: m.id as string, kind: 'manual', automatic: false, at: m.occurred_at as string,
      channel: m.channel as string, content: m.content as string, links: sanitizeLinks(m.links),
      personName: personId ? (personNameById.get(personId) ?? null) : (personNameOther?.trim() || null),
      document: documentId && docById.has(documentId) ? { id: documentId, name: docById.get(documentId)! } : null,
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
      personName: null, document: null,
    });
  }

  const { data: archiveRows } = await admin.from('investor_archive_entries')
    .select('id, archived_at, reopened_at, reason_detail').eq('org_id', orgId).eq('investor_email', email);
  for (const row of archiveRows ?? []) {
    const reason = row.reason_detail as string | null;
    entries.push({
      id: `archive-${row.id}`, kind: 'archived', automatic: true, at: row.archived_at as string, channel: null,
      content: reason ? `Archived — ${reason}` : 'Archived', links: [], personName: null, document: null,
    });
    if (row.reopened_at) {
      entries.push({
        id: `reopen-${row.id}`, kind: 'reopened', automatic: true, at: row.reopened_at as string, channel: null,
        content: 'Reopened from Archive', links: [], personName: null, document: null,
      });
    }
  }

  // Link-out only, no embedded chat (v1 scope — see the mini-prompt's own
  // note that embedding is a v2 decision). /pair has no per-match deep link
  // today (its tab state is local, not URL-driven — confirmed by reading
  // MatchDealShell.tsx), so this points at the app's one MatchDeal entry
  // point; the investor selects the Messages tab themselves once there.
  // Addenda 2026-08-05 §3 — only when a match qualifies as "feito" (see
  // matchdeal-active-match.ts's own header for the exact status/cooldown
  // definition, shared with the founder-initiate gate in deal-messages.ts).
  const { data: startupProfile } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
  if (startupProfile) {
    const match = await findActiveMatchDealMatch(admin, startupProfile.id as string, investorCatalogEntityId);
    if (match) {
      entries.push({
        id: `matchdeal-${match.id}`, kind: 'matchdeal_link', automatic: true, at: match.createdAt,
        channel: null, content: 'Conversation on MatchDeal', links: [{ label: 'Open MatchDeal', url: '/pair' }],
        personName: null, document: null,
      });
    }
  }

  return entries.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export async function createManualInteractionEntry(
  admin: SupabaseClient,
  opts: {
    investorCatalogEntityId: string; orgId: string; userId: string; channel: string; content: string; links: unknown;
    occurredAt?: string | null; personId?: string | null; personNameOther?: string | null; documentId?: string | null;
  },
) {
  const content = opts.content.trim();
  if (!content) return { error: { message: 'Content is required.' } };
  const personDocAvailable = await interactionLogPersonDocumentAvailable();
  const { error } = await admin.from('investor_interaction_log').insert({
    investor_catalog_entity_id: opts.investorCatalogEntityId, startup_org_id: opts.orgId, created_by: opts.userId,
    channel: opts.channel, content, links: sanitizeLinks(opts.links),
    ...(personDocAvailable ? {
      person_id: opts.personId || null, person_name_other: opts.personNameOther?.trim() || null, document_id: opts.documentId || null,
    } : {}),
    ...(opts.occurredAt ? { occurred_at: opts.occurredAt } : {}),
  });
  return { error };
}
