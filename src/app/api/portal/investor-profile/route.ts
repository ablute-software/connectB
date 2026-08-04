// Investor Workspace shell (prompt 57), Zona 2 — the investor's own
// thesis/profile, stored on matchdeal_profiles (kind='investor'), keyed by
// matchdeal_investor_members (see migration 0056's header comment for why
// this reuses MatchDeal's existing schema instead of a new table).
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { SECTOR_TAXONOMY } from '@/lib/investor-sector-taxonomy';
import { computeIdentityStatus } from '@/lib/investor-identity';
import { countDistinctVoucherEntities } from '@/lib/investor-vouching';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

// Identity verification Fase A (prompt 63), Bloco 2 — @ablute.pt sessions
// never see the real "Which firm are you with?" search/match screen at
// all: they're linked straight to the single fixed "ablute_ — Internal QA"
// catalog row (migration 0063), clearly marked, pre-verified (it's a known
// fixture, not a real trust question), never a fabricated real-looking VC.
const QA_ENTITY_NAME = 'ablute_ — Internal QA';

async function autoLinkQaSession(sb: SupabaseClient, admin: SupabaseClient, userId: string) {
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (!isAbluteQa) return null;
  const { data: qaEntity } = await admin.from('catalog_entities').select('id').eq('name', QA_ENTITY_NAME).maybeSingle();
  if (!qaEntity) return null;
  // domain_verified stays false here on purpose — this isn't a real domain
  // match, it's an internal bypass. The QA entity's own
  // verification_status='verified' (migration 0063 seed) is what makes
  // identity_status compute to 'verified', an honest audit trail either way.
  const { data: member } = await admin.from('matchdeal_investor_members')
    .upsert({ user_id: userId, catalog_entity_id: qaEntity.id, status: 'active' }, { onConflict: 'user_id,catalog_entity_id' })
    .select('id, catalog_entity_id, domain_verified').single();
  return member ?? null;
}

const EDITABLE = [
  'sectors', 'geographies', 'stages_invested', 'instruments', 'instrument_other',
  'ticket_min', 'ticket_max', 'lead_or_colead', 'country',
  'investments_per_year', 'capital_to_deploy_eur', 'usual_co_investors',
  'exclusions_sectors', 'exclusions_notes', 'specific_criteria', 'focus_keywords',
  // Prompt 110 Block D (migration 0107).
  'accepts_cold_contact', 'typical_decision_weeks', 'decision_process', 'does_follow_on', 'takes_board_seat',
] as const;

// Weighted the same way companyCompleteness.ts does — essentials (ticket,
// sectors, stages) count for more than optional colour (co-investors,
// exclusions). Threshold for the Pipeline gate (Bloco 3) lives in the
// client, reading this same pct.
const FIELDS: { id: string; weight: number; isFilled: (p: Record<string, unknown>) => boolean }[] = [
  { id: 'ticket', weight: 20, isFilled: (p) => p.ticket_min != null || p.ticket_max != null },
  { id: 'sectors', weight: 20, isFilled: (p) => Array.isArray(p.sectors) && p.sectors.length > 0 },
  { id: 'stages', weight: 15, isFilled: (p) => Array.isArray(p.stages_invested) && p.stages_invested.length > 0 },
  { id: 'geographies', weight: 10, isFilled: (p) => Array.isArray(p.geographies) && p.geographies.length > 0 },
  { id: 'instruments', weight: 10, isFilled: (p) => Array.isArray(p.instruments) && p.instruments.length > 0 },
  { id: 'lead_or_colead', weight: 10, isFilled: (p) => !!p.lead_or_colead },
  { id: 'country', weight: 5, isFilled: (p) => !!p.country },
  { id: 'specific_criteria', weight: 5, isFilled: (p) => !!(p.specific_criteria as string | null)?.trim() },
  { id: 'deploy', weight: 5, isFilled: (p) => p.investments_per_year != null || p.capital_to_deploy_eur != null },
];

function completeness(profile: Record<string, unknown>) {
  const total = FIELDS.reduce((s, f) => s + f.weight, 0);
  const filled = FIELDS.filter((f) => f.isFilled(profile)).reduce((s, f) => s + f.weight, 0);
  return Math.round((filled / total) * 100);
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) member = await autoLinkQaSession(sb, admin, user.id);
  if (!member) return NextResponse.json({ linked: false });

  const { data: entity } = await admin.from('catalog_entities').select('name, verification_status').eq('id', member.catalog_entity_id).maybeSingle();
  let { data: profile } = await admin.from('matchdeal_profiles').select('*')
    .eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();
  if (!profile) {
    const { data: created } = await admin.from('matchdeal_profiles')
      .insert({ membership_id: member.id, kind: 'investor', entity_name: entity?.name ?? null })
      .select('*').single();
    profile = created;
  }

  const distinctVoucherEntityCount = await countDistinctVoucherEntities(admin, member.catalog_entity_id);
  const identityStatus = computeIdentityStatus({
    selfDeclaredIndividual: !!profile?.self_declared_individual,
    domainVerified: !!member.domain_verified,
    entityVerificationStatus: entity?.verification_status ?? null,
    distinctVoucherEntityCount,
  });

  return NextResponse.json({
    linked: true, entityName: entity?.name ?? null, profile, completeness: completeness(profile ?? {}),
    sectorOptions: SECTOR_TAXONOMY, identityStatus,
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 121 §2.2 — GET has had an autoLinkQaSession fallback since Fase
  // A; POST never did. A QA session whose membership isn't persisted yet
  // could load the form (GET auto-links) but got a silent 403 on Save if
  // anything reset that link between the two requests — parity with GET
  // closes that gap.
  let member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) member = await autoLinkQaSession(sb, admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k];
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });

  // Prompt 121 §2.2 — return the row actually written so the client can use
  // it directly instead of firing a second, racy GET (see the client's
  // save(), which used to call load() blindly and silently ignore whether
  // this POST even succeeded).
  const { data: updated, error } = await admin.from('matchdeal_profiles').update(patch)
    .eq('membership_id', member.id).eq('kind', 'investor').select('*').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, profile: updated, completeness: completeness(updated ?? {}) });
}
