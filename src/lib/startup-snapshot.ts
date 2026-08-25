// Investor Workspace Archive (prompt 60) — structured org snapshots + the
// "Now" AI summary. Server-only (uses the service-role client passed in).
import type { SupabaseClient } from '@supabase/supabase-js';
import { roundValuationBasisAvailable } from './round-valuation-basis-capability';
import { providerErrorMessage } from './ai-provider-error';
import { logAiCall } from './ai-cost-log';

export interface SnapshotData {
  stage: string | null; sectors: string[]; one_liner: string | null; description: string | null;
  round_target_eur: number | null; round_valuation_eur: number | null;
  // Prompt 115 Block E — absent entirely (not just null) until migration
  // 0111 lands; only ever read via `?? 'pre_money'`, never assumed present.
  round_valuation_basis?: 'pre_money' | 'post_money' | null;
  round_instruments: string[]; round_target_close_date: string | null; round_raising: boolean | null;
  employee_count: number | null;
  traction: { label: string; value: string }[];
}

const ARCHIVE_RELEVANT_ORG_FIELDS = [
  'stage', 'sectors', 'one_liner', 'description', 'round_target_eur', 'round_valuation_eur', 'round_valuation_basis',
  'round_instruments', 'round_target_close_date', 'round_raising', 'employee_count',
] as const;

export function patchTouchesArchiveRelevantFields(patch: Record<string, unknown>): boolean {
  return ARCHIVE_RELEVANT_ORG_FIELDS.some((f) => f in patch);
}

// Prompt 348 — pulled out of captureSnapshot so "Watching closely" can read
// the CURRENT state for a delta comparison without inserting a new
// startup_profile_snapshots row on every read (a GET shouldn't write).
// captureSnapshot itself is unchanged in behavior, just calls this now.
export async function readSnapshotData(admin: SupabaseClient, orgId: string): Promise<SnapshotData> {
  // round_valuation_basis is only added to the select once the propose-only
  // migration (0111) has landed — an explicit column name Postgrest doesn't
  // recognize fails the WHOLE select, unlike a plain `null` for a column
  // that exists but is unset. Two literal select strings (not one built from
  // a runtime-conditional string) so supabase-js's column-name type
  // inference still works in both branches.
  const basisAvailable = await roundValuationBasisAvailable();
  const [{ data: org }, { data: metrics }] = await Promise.all([
    basisAvailable
      ? admin.from('orgs').select(
          'stage, sectors, one_liner, description, round_target_eur, round_valuation_eur, round_valuation_basis, round_instruments, round_target_close_date, round_raising, employee_count',
        ).eq('id', orgId).single()
      : admin.from('orgs').select(
          'stage, sectors, one_liner, description, round_target_eur, round_valuation_eur, round_instruments, round_target_close_date, round_raising, employee_count',
        ).eq('id', orgId).single(),
    admin.from('org_traction_metrics').select('label, value').eq('org_id', orgId).order('sort_order', { ascending: true }),
  ]);
  return { ...(org as unknown as SnapshotData), traction: metrics ?? [] };
}

export async function captureSnapshot(admin: SupabaseClient, orgId: string, reason: 'first_contact' | 'archived' | 'manual' | 'regenerated') {
  const data = await readSnapshotData(admin, orgId);
  const { data: row } = await admin.from('startup_profile_snapshots').insert({ org_id: orgId, reason, data }).select('id').single();
  return { id: row!.id as string, data };
}

function describeSnapshot(s: SnapshotData): string {
  // Says "post-money"/"pre-money" explicitly — never a bare number — so the
  // "Now" summary the AI writes can't misstate which basis the founder meant.
  const basisWord = (s.round_valuation_basis ?? 'pre_money') === 'post_money' ? 'post-money' : 'pre-money';
  const parts = [
    s.one_liner || s.description || 'no description on file',
    s.stage ? `stage: ${s.stage}` : null,
    s.round_raising && s.round_target_eur ? `raising €${s.round_target_eur.toLocaleString()}` : null,
    s.round_valuation_eur ? `valuation €${s.round_valuation_eur.toLocaleString()} (${basisWord})` : null,
    s.round_instruments.length ? `instruments: ${s.round_instruments.join(', ')}` : null,
    s.traction.length ? `traction: ${s.traction.map((t) => `${t.label} ${t.value}`).join(', ')}` : null,
    s.employee_count ? `team: ${s.employee_count}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

// Fact-triggered, not periodic — same "no cron, regenerate only on a real
// change" discipline the reawakening engine already uses in this codebase
// (see /api/reawakening/evaluate's own header comment). Called from
// /api/org/update ONLY when the patch touches an archive-relevant field AND
// at least one investor_archive_entries row exists for the org — an org
// nobody has archived never costs an AI call.
export async function regenerateNowSummary(admin: SupabaseClient, orgId: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const { data: hasArchiveEntries } = await admin.from('investor_archive_entries').select('id').eq('org_id', orgId).limit(1);
  if (!hasArchiveEntries || hasArchiveEntries.length === 0) return { skipped: 'no_archive_entries' };

  const { id: snapshotId, data: current } = await captureSnapshot(admin, orgId, 'regenerated');
  if (!apiKey) return { skipped: 'ai_not_configured' };

  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 200,
      system: 'You write a single terse "Now" line for an investor CRM archive card, describing a startup\'s CURRENT state. One sentence, no preamble, no markdown. Only use the facts given — never invent numbers or claims not present in the data.',
      messages: [{ role: 'user', content: `Current state of this startup:\n${describeSnapshot(current)}\n\nWrite the "Now" line.` }],
    }),
  });
  if (!res.ok) {
    // Prompt 307 §A — fire-and-forget background regeneration, no client
    // ever sees this; still logged (was silently swallowed before) so a
    // sustained provider outage is visible server-side. Routed through the
    // shared helper purely for consistent logging/truncation.
    providerErrorMessage('[startup-snapshot]', await res.text());
    return { skipped: 'ai_call_failed' };
  }
  const body = await res.json();
  // Cost audit 2026-08-25 — this was the ONE real AI call in the app that
  // never reached ai_call_log (confirmed by a full ledger + code sweep):
  // it read body.content but never body.usage, so its spend was invisible
  // in every per-founder cost figure. Notably it's also the only AI call
  // triggered by an INVESTOR's action (archiving a startup) rather than the
  // founder's own — so the org it bills to is the startup being archived,
  // which is exactly the orgId already in scope here.
  void logAiCall({ route: 'startup-snapshot', purpose: 'now_summary', model, usage: body?.usage, orgId });
  const text = body?.content?.[0]?.text?.trim();
  if (!text) return { skipped: 'ai_empty_response' };

  await admin.from('startup_now_summaries').upsert(
    { org_id: orgId, summary_text: text, based_on_snapshot_id: snapshotId, generated_at: new Date().toISOString() },
    { onConflict: 'org_id' },
  );
  return { ok: true, text };
}
