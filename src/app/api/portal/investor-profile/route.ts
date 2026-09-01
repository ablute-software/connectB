// Investor Workspace shell (prompt 57), Zona 2 — the investor's own
// thesis/profile, stored on matchdeal_profiles (kind='investor'), keyed by
// matchdeal_investor_members (see migration 0056's header comment for why
// this reuses MatchDeal's existing schema instead of a new table).
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
// Prompt 176 §A.1 — was investor-sector-taxonomy.ts's own 22-value flat
// list (a completely different vocabulary from the startup side's — zero
// string overlap, e.g. 'fintech' vs 'FinTech & InsurTech'). That mismatch
// is the root cause investor-match-score.ts's overlaps() always scored
// sector as 0 for real data (35 of 100 match-score points, silently dead).
// Now the exact same canonical taxonomy startups use (sector-taxonomy.ts,
// via SectorPicker.tsx) — see that file's own header for the group
// structure. `sectorOptions` stays in the response (kept for API-contract
// stability / any future flat-list consumer) but the client-side picker
// (InvestorProfilePanel.tsx) no longer reads it — it imports SectorPicker
// directly, same as the startup side.
import { ALL_SECTOR_NAMES } from '@/lib/sector-taxonomy';
import { computeIdentityStatus } from '@/lib/investor-identity';
import { countDistinctVoucherEntities } from '@/lib/investor-vouching';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { investorBillingConfigured } from '@/lib/stripe-env';
import { isBlockedState } from '@/lib/investor-billing-access';
import { assertNotViewer } from '@/lib/developer-viewer';
import { syncInvestorProfileToCatalog } from '@/lib/investor-profile-sync';

const EDITABLE = [
  'sectors', 'geographies', 'stages_invested', 'instruments', 'instrument_other',
  'ticket_min', 'ticket_max', 'lead_or_colead', 'country',
  'investments_per_year', 'capital_to_deploy_eur', 'usual_co_investors',
  'exclusions_sectors', 'exclusions_notes', 'specific_criteria', 'focus_keywords',
  // Prompt 110 Block D (migration 0107).
  'accepts_cold_contact', 'typical_decision_weeks', 'decision_process', 'does_follow_on', 'takes_board_seat',
  // Prompt 421 §F — the firm logo (Photos & media tab). Pre-existing
  // matchdeal_profiles column (migration 0053) — this route just never
  // exposed it to the investor's own edit form before.
  'photo_url',
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

// Prompt 506 — a linha já foi lida acima para o `hasSubscription`; isto é só
// a leitura do estado a partir dela, sem uma segunda ida à base de dados.
function readAccessFromRow(row: { access_state?: string | null; plan_tier?: string | null } | null) {
  const state = row?.access_state ?? 'active';
  return { blocked: isBlockedState(state), lastPaidTier: row?.plan_tier ?? null };
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 506 — o GET é uma das três excepções ao bloqueio por falta de
  // pagamento: é ele que alimenta o painel de Plans e a própria mensagem que
  // explica o bloqueio. Sem isto, uma firma em dívida veria "sem perfil
  // ligado" e não teria por onde voltar a pagar. O POST desta mesma rota
  // (editar o perfil) NÃO leva a excepção — editar é uso a sério.
  const member = await resolveActiveInvestorMember(admin, user.id, { allowBillingLapsed: true });
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

  // Prompt 156 — migration 0156. A separate small query rather than adding
  // this to resolveActiveInvestorMember's own select: that helper is shared
  // across 11 call sites, most of which have nothing to do with the
  // Pipeline confirm step. Prompt 421 §D.2 — notify_new_eligible_startup
  // (migration 0267) rides along on this same query, same reasoning.
  const { data: memberRow } = await admin.from('matchdeal_investor_members')
    .select('pipeline_confirmed_at, notify_new_eligible_startup').eq('id', member.id).maybeSingle();

  // Prompt 501 — o estado de billing da FIRMA, para o painel de Plans saber
  // se mostra checkout real, "Manage subscription", ou o fluxo antigo de
  // pedido manual. Deliberadamente só DOIS booleanos: o stripe_customer_id e
  // o stripe_subscription_id nunca saem do servidor (é essa a razão de
  // investor_billing ter RLS sem policies — ver migração 0287). Pendurado
  // nesta rota, que o painel já busca, em vez de um segundo fetch a /api/me.
  const { data: firmBilling } = await admin.from('investor_billing')
    .select('stripe_subscription_id, access_state, plan_tier')
    .eq('catalog_entity_id', member.catalog_entity_id).maybeSingle();
  // Prompt 506 — `blocked` é o que faz o painel mostrar "sem acesso até
  // pagar" em vez do estado normal, e `lastPaidTier` é o que lhe permite
  // dizer QUAL plano reactivar em vez de um genérico. Continua sem sair
  // daqui nenhum id do Stripe.
  const firmAccess = readAccessFromRow(firmBilling);

  return NextResponse.json({
    linked: true, entityName: entity?.name ?? null, profile, completeness: completeness(profile ?? {}),
    billing: {
      configured: investorBillingConfigured(),
      hasSubscription: !!firmBilling?.stripe_subscription_id,
      blocked: firmAccess.blocked,
      lastPaidTier: firmAccess.lastPaidTier,
    },
    sectorOptions: ALL_SECTOR_NAMES, identityStatus,
    pipelineConfirmedAt: (memberRow?.pipeline_confirmed_at as string | null) ?? null,
    notifyNewEligibleStartup: (memberRow?.notify_new_eligible_startup as boolean | null) ?? false,
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k];
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });
  // Prompt 421 §F — only http(s), same discipline sanitizeLinks() (investor-
  // interaction-log.ts) already applies to every other free-text URL an
  // investor can save on this platform.
  if (typeof patch.photo_url === 'string' && !/^https?:\/\//i.test(patch.photo_url)) {
    return NextResponse.json({ ok: false, error: 'Logo URL must start with http:// or https://.' }, { status: 400 });
  }

  // Prompt 121 §2.2 — return the row actually written so the client can use
  // it directly instead of firing a second, racy GET (see the client's
  // save(), which used to call load() blindly and silently ignore whether
  // this POST even succeeded).
  const { data: updated, error } = await admin.from('matchdeal_profiles').update(patch)
    .eq('membership_id', member.id).eq('kind', 'investor').select('*').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Prompt 519 §2 — the moment an investor describes themselves, that
  // description reaches the shared catalog row, and from there every founder
  // path that reads it (the Entity summary prefill, unlockPack, the monthly
  // delivery). Before this it stopped at matchdeal_profiles and the founder's
  // dossier stayed empty even though the platform had the answer.
  //
  // Awaited, but never able to fail this request: syncInvestorProfileToCatalog
  // returns its error instead of throwing, so a catalog problem cannot make
  // the investor's own save look like it failed.
  const catalogSync = await syncInvestorProfileToCatalog(admin, member.catalog_entity_id);
  if (catalogSync.error) console.error('[investor-profile] catalog sync failed', catalogSync.error);

  return NextResponse.json({ ok: true, profile: updated, completeness: completeness(updated ?? {}), catalogSync: catalogSync.updated });
}
