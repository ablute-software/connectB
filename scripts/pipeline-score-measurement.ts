// Prompt 714 (Fase 0 do pipeline adaptativo) — Pedido A: read-only
// measurement of computeMatchScore's current base distribution, across
// every investor firm with an active MatchDeal seat, over the DISCOVERY-ONLY
// eligible candidate set. Writes a Markdown report; touches nothing in the
// database (every query below is a SELECT, and computeAdmissions is called
// read-only — its own caller in investor-pipeline.ts is the only place that
// persists a new admission, and that upsert is never reached from here).
//
// Reuses the real production functions directly (imported, not re-derived)
// so this can never drift from what getPipelineWaves actually does:
//   - filterEligibleOrgs (pipeline-eligibility.ts) for "published, eligible"
//   - computeMatchScore (investor-match-score.ts, this prompt's own Pedido B)
//   - computeAdmissions (pipeline-admissions.ts) for the monthly-cap quota
// All three are pure — no Supabase client, no 'server-only' — so importing
// them here via tsx carries no risk of touching a server-only boundary.
//
// Relationship-sourced exclusions (an org a firm already has a grant/
// decision/referral/portfolio relationship with — the "discovery" carve-out
// investor-pipeline.ts itself applies before wave-gating) are recomputed
// here rather than imported: decisions and portfolio are firm-level facts
// (investor_relationship_decisions.investor_catalog_entity_id,
// catalog_deliveries.catalog_id) and are exact; grants and referrals are
// technically PER USER in the real product (access_grants targets an
// email/person, network_referrals targets an accepted actor), so this
// script unions them across every active member of the firm — the closest
// firm-level approximation, and exact whenever a firm has exactly one
// active member (true for 4 of the 5 firms with a seat today).
//
// Run:   npx tsx scripts/pipeline-score-measurement.ts
// Reads: .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
// Writes: docs/prompt-714-score-measurement-<YYYY-MM-DD>.md

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { filterEligibleOrgs, type EligibilityOrg, type EligibilityStartupProfile } from '../src/lib/pipeline-eligibility';
import { computeMatchScore, type InvestorThesis, type StartupRound, type MatchCriterion } from '../src/lib/investor-match-score';
import { computeAdmissions } from '../src/lib/pipeline-admissions';
import { investorPlanRow, MATCHDEAL_TIER_TO_INVESTOR_PLAN, type InvestorPlanTier } from '../src/lib/plans';

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envText.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const admin: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DEFAULT_MATCHDEAL_TIER = 'tier_a'; // same fallback as investor-pipeline.ts / portal-access.ts

interface FirmRow {
  catalogEntityId: string;
  name: string;
  isTest: boolean;
  memberIds: string[];
  userIds: string[];
}

async function main() {
  const { data: members, error: membersErr } = await admin.from('matchdeal_investor_members')
    .select('id, user_id, catalog_entity_id').eq('status', 'active');
  if (membersErr) throw membersErr;

  const catalogIds = [...new Set((members ?? []).map((m) => m.catalog_entity_id as string))];
  const { data: entities } = await admin.from('catalog_entities').select('id, name, is_test').in('id', catalogIds);
  const entityById = new Map((entities ?? []).map((e) => [e.id as string, e]));

  const firms = new Map<string, FirmRow>();
  for (const m of members ?? []) {
    const cid = m.catalog_entity_id as string;
    const entity = entityById.get(cid);
    if (!firms.has(cid)) {
      firms.set(cid, {
        catalogEntityId: cid,
        name: (entity?.name as string) ?? '(unknown)',
        isTest: !!(entity?.is_test as boolean | undefined),
        memberIds: [], userIds: [],
      });
    }
    const firm = firms.get(cid)!;
    firm.memberIds.push(m.id as string);
    firm.userIds.push(m.user_id as string);
  }

  const allMemberIds = (members ?? []).map((m) => m.id as string);
  const { data: profiles } = await admin.from('matchdeal_profiles')
    .select('id, membership_id, sectors, stages_invested, geographies, instruments, ticket_min, ticket_max, exclusions_sectors, exclusions_notes, plan_tier, is_complete, updated_at')
    .eq('kind', 'investor').in('membership_id', allMemberIds);
  const profileByMembership = new Map((profiles ?? []).map((p) => [p.membership_id as string, p]));

  // Fetched once, shared by every firm — same source getPipelineWaves reads.
  const { data: orgsRaw } = await admin.from('orgs').select('*');
  const orgs = (orgsRaw ?? []) as unknown as EligibilityOrg[];
  const { data: startupProfilesRaw } = await admin.from('matchdeal_profiles')
    .select('membership_id, owner_suspended_at, platform_suspended_at').eq('kind', 'startup');
  const startupProfiles = (startupProfilesRaw ?? []) as EligibilityStartupProfile[];
  const orgById = new Map(orgs.map((o) => [o.id as string, o as unknown as Record<string, unknown>]));

  const { data: allDecisions } = await admin.from('investor_relationship_decisions').select('org_id, investor_catalog_entity_id');
  const { data: allDeliveries } = await admin.from('catalog_deliveries').select('org_id, entity_id, catalog_id');
  const deliveryEntityIds = [...new Set((allDeliveries ?? []).map((d) => d.entity_id as string))];
  const { data: entityRows } = deliveryEntityIds.length
    ? await admin.from('entities').select('id, status').in('id', deliveryEntityIds)
    : { data: [] as { id: string; status: string | null }[] };
  const entityStatusById = new Map((entityRows ?? []).map((e) => [e.id as string, e.status as string | null]));

  const { data: allAdmissions } = await admin.from('investor_pipeline_admissions').select('investor_catalog_entity_id, org_id, admitted_at');

  const lines: string[] = [];
  lines.push(`# Prompt 714 — Fase 0: medição da base de pontuação`);
  lines.push('');
  lines.push(`Gerado em ${new Date().toISOString()} por scripts/pipeline-score-measurement.ts. Leitura apenas — nenhuma escrita na base de dados.`);
  lines.push('');
  lines.push(`## Universo real (verificado, não assumido)`);
  lines.push('');
  lines.push(`A base tem hoje **${firms.size} firmas** com pelo menos um lugar (\`matchdeal_investor_members.status='active'\`) — não "5 reais + 1 QA" como o contexto do prompt sugeria. Das ${firms.size}, **${[...firms.values()].filter((f) => !f.isTest).length} não é \`is_test\`** ("Invest green"); as outras ${[...firms.values()].filter((f) => f.isTest).length} são todas \`is_test=true\` (a QA interna do ablute_ e três contas de teste antigas). Reportado tal como está — é o dado real, não o que o estudo presumia.`);
  lines.push('');
  lines.push(`**Leitura dos números abaixo:** a base tem hoje 15 orgs no total, das quais só 6 não são \`is_test\` — e dessas 6, só 2 passam o gate completo de elegibilidade (\`filterEligibleOrgs\`: perfil de 9 campos completo, não suspensa, não fechada, não excluída de discovery, visível). Isso deixa 1-2 candidatas de discovery por firma, não um volume onde ties/histograma/simulação digam muito por si — é o tamanho real da base hoje, não um limite do método. A ausência de "dados em falta" no item 3 abaixo, para praticamente todas as firmas, é a mesma causa: as poucas candidatas que existem calham a ter os campos que estes investidores declararam. A correção do Pedido B está verificada por 8 novos testes unitários (16 no total no ficheiro) que cobrem exactamente os casos que a base real ainda não tem volume para exercitar; a fase 1/2 (mais startups reais) é o que vai tornar este relatório mais informativo.`);
  lines.push('');

  const realFirms: string[] = [];
  const testFirms: string[] = [];

  for (const firm of [...firms.values()].sort((a, b) => Number(a.isTest) - Number(b.isTest) || a.name.localeCompare(b.name))) {
    const target = firm.isTest ? testFirms : realFirms;
    const header = `### ${firm.name} (\`${firm.catalogEntityId}\`) — ${firm.isTest ? 'is_test' : 'REAL'}`;
    target.push(header);

    // Pick one thesis per firm: most complete, most recently updated.
    const candidateProfiles = firm.memberIds.map((mid) => profileByMembership.get(mid)).filter((p): p is NonNullable<typeof p> => !!p);
    if (candidateProfiles.length === 0) {
      target.push('', '_Nenhum membro desta firma completou o formulário "About" (matchdeal_profiles kind=investor). getPipelineWaves devolveria `linked:false` — sem thesis, não há score a medir._', '');
      continue;
    }
    candidateProfiles.sort((a, b) => (Number(b.is_complete) - Number(a.is_complete)) || String(b.updated_at).localeCompare(String(a.updated_at)));
    const profile = candidateProfiles[0];
    if (candidateProfiles.length > 1) {
      target.push('', `_Nota: ${candidateProfiles.length} perfis de investidor entre os membros desta firma; usado o mais completo/recente (\`${profile.id}\`)._`, '');
    }
    if (!profile.is_complete) {
      target.push('', `_Perfil incompleto (\`is_complete=false\`) — usado tal como está (getPipelineWaves não filtra por is_complete); campos por preencher contam como "sem preferência declarada", não como "em falta".._`, '');
    }

    const thesis: InvestorThesis = {
      sectors: profile.sectors ?? [], stagesInvested: profile.stages_invested ?? [],
      geographies: profile.geographies ?? [], instruments: profile.instruments ?? [],
      ticketMin: profile.ticket_min, ticketMax: profile.ticket_max,
      exclusionsSectors: profile.exclusions_sectors, exclusionsNotes: profile.exclusions_notes,
    };

    const eligibleIds = filterEligibleOrgs(orgs, startupProfiles, firm.isTest);

    // Relationship exclusions (discovery = eligible minus these).
    const decisionOrgIds = new Set((allDecisions ?? []).filter((d) => d.investor_catalog_entity_id === firm.catalogEntityId).map((d) => d.org_id as string));
    const firmDeliveries = (allDeliveries ?? []).filter((d) => d.catalog_id === firm.catalogEntityId);
    const statusesByOrg = new Map<string, (string | null)[]>();
    for (const d of firmDeliveries) {
      const orgId = d.org_id as string;
      statusesByOrg.set(orgId, [...(statusesByOrg.get(orgId) ?? []), entityStatusById.get(d.entity_id as string) ?? null]);
    }
    const portfolioOrgIds = new Set([...statusesByOrg.entries()].filter(([, statuses]) => statuses.some((s) => s === 'invested')).map(([orgId]) => orgId));

    const grantOrgIds = new Set<string>();
    const referralOrgIds = new Set<string>();
    for (const userId of firm.userIds) {
      const { data: userResult } = await admin.auth.admin.getUserById(userId);
      const email = userResult?.user?.email ?? null;
      if (email) {
        const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
        const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
        if (person?.id) orParts.push(`person_id.eq.${person.id}`);
        const { data: grants } = await admin.from('access_grants')
          .select('org_id, confirmed_at, invited_email, revoked_at, expires_at').is('revoked_at', null).or(orParts.join(','));
        const now = new Date();
        for (const g of grants ?? []) {
          const notExpired = !g.expires_at || new Date(g.expires_at as string) > now;
          const confirmedIfInvited = !g.invited_email || g.confirmed_at;
          if (notExpired && confirmedIfInvited) grantOrgIds.add(g.org_id as string);
        }
      }
      // Referrals key off the member's OWN investor matchdeal_profiles id (not the firm's chosen thesis profile).
      const ownProfile = profileByMembership.get(firm.memberIds[firm.userIds.indexOf(userId)]);
      if (ownProfile) {
        const { data: actorRow } = await admin.from('network_actors').select('id').eq('matchdeal_profile_id', ownProfile.id).maybeSingle();
        if (actorRow?.id) {
          const { data: accepted } = await admin.from('network_referrals').select('referred_org_id').eq('target_actor_id', actorRow.id).eq('state', 'accepted');
          for (const r of accepted ?? []) referralOrgIds.add(r.referred_org_id as string);
        }
      }
    }

    const relationshipOrgIds = new Set([...decisionOrgIds, ...portfolioOrgIds, ...grantOrgIds, ...referralOrgIds]);
    const discoveryIds = eligibleIds.filter((id) => !relationshipOrgIds.has(id));

    target.push('', `Elegíveis (discovery): **${discoveryIds.length}** (de ${eligibleIds.length} elegíveis no total; ${eligibleIds.length - discoveryIds.length} já têm relação — grant/decisão/referral/portfolio, excluídas da leitura de discovery por pedido).`, '');

    if (discoveryIds.length === 0) {
      target.push('_Sem candidatas de discovery — nada a medir para esta firma._', '');
      continue;
    }

    interface Scored { orgId: string; name: string; score: number; unknownCriteria: MatchCriterion[]; }
    const scored: Scored[] = discoveryIds.map((id) => {
      const org = orgById.get(id)!;
      const round: StartupRound = {
        sectors: (org.sectors as string[]) ?? [], stage: org.stage as string | null, country: org.country as string | null,
        roundTargetEur: org.round_target_eur as number | null, roundMinTicketEur: org.round_min_ticket_eur as number | null,
        roundInstruments: (org.round_instruments as string[]) ?? [],
      };
      const result = computeMatchScore(thesis, round);
      return { orgId: id, name: (org.name as string) ?? id, score: result.score, unknownCriteria: result.unknownCriteria };
    }).sort((a, b) => b.score - a.score);

    // 1. Histogram by decade + ties at max.
    const histogram = new Array(11).fill(0); // 0-9,10-19,...,100
    for (const s of scored) histogram[Math.min(10, Math.floor(s.score / 10))] += 1;
    const maxScore = scored[0].score;
    const tiedAtMax = scored.filter((s) => s.score === maxScore).length;
    target.push('**1. Distribuição de score (por dezena):**', '');
    target.push('| Faixa | Candidatas |', '|---|---|');
    for (let i = 0; i <= 10; i++) {
      const label = i === 10 ? '100' : `${i * 10}-${i * 10 + 9}`;
      if (histogram[i] > 0) target.push(`| ${label} | ${histogram[i]} |`);
    }
    target.push('', `Empatadas no valor máximo (${maxScore}): **${tiedAtMax}** de ${scored.length}.`, '');

    // 2. Admitted vs not-yet-admitted (monthly cap).
    const admittedAtByOrg = new Map((allAdmissions ?? []).filter((a) => a.investor_catalog_entity_id === firm.catalogEntityId).map((a) => [a.org_id as string, a.admitted_at as string]));
    const investorTier: InvestorPlanTier = MATCHDEAL_TIER_TO_INVESTOR_PLAN[(profile.plan_tier as string) ?? DEFAULT_MATCHDEAL_TIER] ?? MATCHDEAL_TIER_TO_INVESTOR_PLAN[DEFAULT_MATCHDEAL_TIER];
    const monthlyCap = investorPlanRow(investorTier).monthlyCap;
    const admission = computeAdmissions({
      discoveryCards: scored.map((s) => ({ orgId: s.orgId })),
      admittedAtByOrg, eligibleNowOrgIds: new Set(eligibleIds), monthlyCap, nowIso: new Date().toISOString(),
    });
    target.push('**2. Admissão (tecto mensal do plano):**', '');
    target.push(`Elegíveis de discovery: ${scored.length}. Admitidas (histórico + o que o orçamento deste mês ainda cobre): **${admission.admitted.length}**. Por admitir (bloqueadas pelo tecto): **${scored.length - admission.admitted.length}**. Tecto mensal do plano (\`${investorTier}\`): ${monthlyCap}/mês; admitidas este mês: ${admission.quota.admittedThisMonth}.`, '');

    // 3. Per-criterion missing counts + what today's (pre-Prompt-714) semantics did with them.
    const OLD_BEHAVIOR: Record<MatchCriterion, string> = {
      sector: 'dava 0 (perdia os 35 pontos)', stage: 'dava 0 (perdia os 25 pontos)',
      ticket: 'dava crédito total (ganhava os 20 pontos sem verificação)',
      geography: 'dava 0 (perdia os 10 pontos)',
      instrument: 'dava crédito total (ganhava os 10 pontos sem verificação)',
    };
    const missingCounts: Record<MatchCriterion, number> = { sector: 0, stage: 0, ticket: 0, geography: 0, instrument: 0 };
    for (const s of scored) for (const c of s.unknownCriteria) missingCounts[c] += 1;
    target.push('**3. Dados da startup em falta, por critério (só quando o investidor declarou essa dimensão):**', '');
    target.push('| Critério | Candidatas com o dado em falta | Comportamento ANTES do Prompt 714 |', '|---|---|---|');
    for (const c of ['sector', 'stage', 'ticket', 'geography', 'instrument'] as MatchCriterion[]) {
      if (missingCounts[c] > 0) target.push(`| ${c} | ${missingCounts[c]} de ${scored.length} | ${OLD_BEHAVIOR[c]} |`);
    }
    if (Object.values(missingCounts).every((v) => v === 0)) target.push('| _(nenhum — todas as candidatas têm dados completos nas dimensões que este investidor declarou)_ | | |');
    target.push('');

    // 4. Simulation: +/-5/12/20 nudge on the 'stage' dimension (Nuno's own
    // example dimension), applied as: earned stage -> +delta, known
    // stage mismatch -> -delta, no-preference/unknown stage -> untouched.
    // This models the shape of a FUTURE fase-4 adjustment (a nudge added on
    // TOP of the base score, not a change to WEIGHTS.stage itself) — nothing
    // here changes computeMatchScore or product behaviour; it only measures
    // how much reordering that kind of nudge would cause against TODAY's
    // real base scores.
    target.push('**4. Simulação — ajuste de ±5/±12/±20 na dimensão "fase" (não aplicado, só medido):**', '');
    const top = (n: number) => scored.slice(0, n).map((s) => s.orgId);
    const stageDirById = new Map<string, 1 | -1 | 0>();
    for (const id of discoveryIds) {
      const org = orgById.get(id)!;
      const round: StartupRound = {
        sectors: (org.sectors as string[]) ?? [], stage: org.stage as string | null, country: org.country as string | null,
        roundTargetEur: org.round_target_eur as number | null, roundMinTicketEur: org.round_min_ticket_eur as number | null,
        roundInstruments: (org.round_instruments as string[]) ?? [],
      };
      const r = computeMatchScore(thesis, round);
      const stageKnown = !r.unknownCriteria.includes('stage');
      const stageEarned = stageKnown && (r.reasons.includes('stage') || thesis.stagesInvested.length === 0);
      stageDirById.set(id, !stageKnown ? 0 : (stageEarned ? 1 : -1));
    }
    target.push('| Ajuste | Top-8 — posições que mudam | Top-22 — posições que mudam |', '|---|---|---|');
    for (const delta of [5, 12, 20]) {
      const adjusted = scored.map((s) => ({ orgId: s.orgId, score: s.score + delta * (stageDirById.get(s.orgId) ?? 0) })).sort((a, b) => b.score - a.score);
      const newTop8 = new Set(adjusted.slice(0, 8).map((s) => s.orgId));
      const newTop22 = new Set(adjusted.slice(0, 22).map((s) => s.orgId));
      const changed8 = top(8).filter((id) => !newTop8.has(id)).length;
      const changed22 = top(22).filter((id) => !newTop22.has(id)).length;
      target.push(`| ±${delta} | ${changed8} de ${Math.min(8, scored.length)} | ${changed22} de ${Math.min(22, scored.length)} |`);
    }
    target.push('');
  }

  lines.push('## Firmas reais', '', ...realFirms);
  lines.push('## Firmas is_test', '', ...testFirms);

  mkdirSync('docs', { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outPath = `docs/prompt-714-score-measurement-${date}.md`;
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`Written: ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
