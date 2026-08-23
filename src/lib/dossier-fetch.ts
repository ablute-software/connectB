// Prompt 306 — the exact read sequence /api/portal/startup/[orgId] uses to
// build a disclosure-ladder dossier for one org at one level, extracted
// here so a second caller (the founder-only "see it like an investor"
// preview, Prompt 306) can call the IDENTICAL sequence instead of writing a
// second implementation of it. This is the CLAUDE.md root-cause lesson from
// the 16/08/2026 leak, applied preventively: two filters over the same data
// eventually disagree, so there is only ever one.
//
// Deliberately still just the FETCH — projecting the result down to what a
// given level may see is projectDossier's job (investor-interest-level.ts),
// unchanged, called separately by each caller after this.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getInteractionTimeline } from './investor-interaction-log';
import { vaultFrozenForOrg } from './data-room-server';
import { sanitizeInvestorSwot } from './investor-safe-swot';
import type {
  InterestLevel, FullDossierData, FounderClarificationFull, RoadmapMilestoneFull, RoadmapCategoryFull,
} from './investor-interest-level';
import type { SwotData } from './types';
import type { ReviewCategory } from './review-clarifications';
import { projectBadgesForInvestor, type BadgePublic } from './company-badges';
import { projectMiniPitchForInvestor, type MiniPitchSlideProjected, type StoredMiniPitchSlide } from './mini-pitch';

export interface DossierRawData {
  full: FullDossierData;
  swot: { visible: boolean; data: SwotData } | null;
  // Whether the founder's own toggle is ON, independent of whether `swot`
  // ended up populated (e.g. still null with the toggle on, for an org with
  // no review run yet) — callers that need to explain WHY a section is
  // absent (Prompt 306's preview) read this; /api/portal/startup/[orgId]
  // itself has never needed it, since an investor is never shown a reason,
  // only the section or its absence.
  swotToggleOn: boolean;
  roadmap: { visible: boolean; milestones: RoadmapMilestoneFull[]; categories?: RoadmapCategoryFull[] } | null;
  roadmapToggleOn: boolean;
  founderClarifications: FounderClarificationFull[];
  // Prompt 326 — fetched and projected regardless of level (Pedido E's own
  // Level-0 recommendation): already the fully masked, investor-safe shape
  // (projectBadgesForInvestor) — disputed badges and internal fields never
  // reach this far.
  badges: BadgePublic[];
  // Prompt 334 — null unless the founder has ACTIVATED a mini-pitch
  // (org_mini_pitches.activated_at not null), same "not fetched-then-
  // hidden" discipline as swot/roadmap/overview above: a draft the founder
  // is still previewing is never queried here at all for the real investor
  // route (level >= 1 investorContext callers); the founder's own preview
  // route reads the draft separately, outside this function.
  miniPitch: MiniPitchSlideProjected[] | null;
}

// `investorContext` is null for a caller with no real investor on the other
// side (Prompt 306's preview) — contactHistory then stays exactly what it
// already stayed for a level<2 or investorCatalogEntityId-less investor
// caller: an empty array, never fabricated.
export async function fetchDossierRawData(
  admin: SupabaseClient,
  orgId: string,
  level: InterestLevel,
  investorContext: { investorCatalogEntityId: string; email: string } | null,
): Promise<DossierRawData> {
  // Overview body — deliberately the SAME data surface matchdeal_startup_pitch_data
  // already exposes to investors browsing the MatchDeal deck (Prompt 98's
  // own SECURITY DEFINER RPC): no new private-data surface, just a second
  // place that reads it. Only fetched at all once level >= 1 unlocks it —
  // not fetched-then-hidden.
  let overview: Record<string, unknown> | null = null;
  if (level >= 1) {
    const { data: startupProfile } = await admin.from('matchdeal_profiles')
      .select('id, team_summary, representative_name, representative_linkedin')
      .eq('kind', 'startup').eq('membership_id', orgId).maybeSingle();
    if (startupProfile) {
      const { data: pitch } = await admin.rpc('matchdeal_startup_pitch_data', { p_profile_id: startupProfile.id });
      overview = pitch?.[0] ? {
        ...pitch[0], team_summary: startupProfile.team_summary,
        representative_name: startupProfile.representative_name, representative_linkedin: startupProfile.representative_linkedin,
      } : null;
    }
  }

  // Everything below is only ever FETCHED at level >= 2 — not fetched-then-
  // hidden, genuinely not read, so a bug in projectDossier could at worst
  // leak an already-fetched (level 1) overview, never team/traction/
  // contacts/documents a level-0/1 investor was never supposed to see.
  let team: FullDossierData['team'] = [];
  let contactHistory: FullDossierData['contactHistory'] = [];
  let documentTitles: FullDossierData['documentTitles'] = [];
  let tractionDetailed: Record<string, unknown> = {};
  if (level >= 2) {
    const { data: people } = await admin.from('company_people')
      .select('id, full_name, title, is_founder, linkedin_url, email').eq('org_id', orgId).order('sort_order', { ascending: true });
    team = (people ?? []).map((p) => ({
      id: p.id as string, fullName: p.full_name as string, title: p.title as string | null,
      isFounder: p.is_founder as boolean, linkedinUrl: p.linkedin_url as string | null, email: p.email as string | null,
    }));
    tractionDetailed = (overview?.traction_metrics as Record<string, unknown> | null) ?? {};
    if (investorContext) {
      const timeline = await getInteractionTimeline(admin, {
        investorCatalogEntityId: investorContext.investorCatalogEntityId, email: investorContext.email, orgId,
      });
      contactHistory = timeline.map((t) => ({ id: t.id, at: t.at, content: t.content, channel: t.channel }));
    }
    // Prompt 278 §4 — the kill switch, explicitly confirmed to cover this
    // route too: documentTitles is its OWN gate here (level >= 2), entirely
    // separate from access_grants/resolveDocumentAccess. Not fetched-then-
    // hidden: skipped entirely while frozen, same "not fetched below its
    // level" discipline this function applies everywhere else.
    if (!(await vaultFrozenForOrg(admin, orgId))) {
      const { data: docs } = await admin.from('documents').select('id, name').eq('org_id', orgId);
      documentTitles = (docs ?? []).map((d) => ({ id: d.id as string, name: d.name as string }));
    }
  }

  // SWOT snapshot. Only ever fetched at level >= 1 (same "not fetched-then-
  // hidden" discipline as `overview` above), and only when the founder's
  // own toggle is on — no point reading review_runs at all if the answer is
  // going to be withheld anyway. Explicit projection to SwotData's 4 arrays
  // only: never the raw review_runs.report row.
  let swot: { visible: boolean; data: SwotData } | null = null;
  let swotToggleOn = true;
  if (level >= 1) {
    const { data: orgRow } = await admin.from('orgs').select('swot_visible_to_investors').eq('id', orgId).maybeSingle();
    swotToggleOn = (orgRow?.swot_visible_to_investors as boolean | null | undefined) ?? true;
    if (swotToggleOn) {
      const { data: latestRun } = await admin.from('review_runs').select('report')
        .eq('org_id', orgId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      // SO `report.investor_safe`, gerado por um prompt que nunca viu o
      // pipeline. Sem esse campo (runs anteriores a 211), o SWOT e null:
      // NUNCA cair para o report completo, que e o do founder e carrega
      // passes, contactos e progresso do round. Fail-closed: a ausencia e
      // um inconveniente e a fuga e uma traicao a startup.
      const report = latestRun?.report as { investor_safe?: Partial<SwotData> } | null | undefined;
      if (report?.investor_safe) {
        // Sanitizado outra vez na leitura: barato, e cobre um run gravado
        // por uma versao anterior deste guarda.
        const { data: safe } = sanitizeInvestorSwot(report.investor_safe);
        swot = { visible: true, data: safe };
      }
    }
  }

  // Roadmap. Only ever fetched at level >= 1, only when the founder's own
  // toggle is on — same "not fetched-then-hidden" discipline as swot/
  // overview above. Selects only period_kind/period_year/period_quarter/
  // items(_v2) — never created_at/updated_at/sort_order.
  let roadmap: { visible: boolean; milestones: RoadmapMilestoneFull[]; categories?: RoadmapCategoryFull[] } | null = null;
  let roadmapToggleOn = true;
  if (level >= 1) {
    const { data: orgRow } = await admin.from('orgs').select('roadmap_visible_to_investors').eq('id', orgId).maybeSingle();
    roadmapToggleOn = (orgRow?.roadmap_visible_to_investors as boolean | null | undefined) ?? true;
    if (roadmapToggleOn) {
      const [{ data: milestoneRows }, { data: categoryRows }] = await Promise.all([
        admin.from('company_roadmap_milestones')
          .select('period_kind, period_year, period_quarter, items, items_v2').eq('org_id', orgId).order('period_year', { ascending: true }),
        admin.from('roadmap_categories')
          .select('id, label, color, shape').eq('org_id', orgId).order('created_at', { ascending: true }),
      ]);
      roadmap = {
        visible: true,
        milestones: (milestoneRows ?? []).map((r) => ({
          period_kind: r.period_kind as RoadmapMilestoneFull['period_kind'], period_year: r.period_year as number,
          period_quarter: (r.period_quarter as number | null) ?? undefined, items: (r.items as string[] | null) ?? [],
          items_v2: (r.items_v2 as { text: string; category_id: string | null }[] | null) ?? undefined,
        })),
        categories: (categoryRows ?? []).map((c) => ({
          id: c.id as string, label: c.label as string, color: c.color as string, shape: c.shape as string,
        })),
      };
    }
  }

  // Founder clarifications. `.eq('visible_to_investors', true)` in the
  // query itself, not a JS filter after the fact — a hidden clarification
  // never leaves the database. Selects ONLY category + clarification_text.
  let founderClarifications: FounderClarificationFull[] = [];
  if (level >= 1) {
    const { data: clarificationRows } = await admin.from('review_clarifications')
      .select('category, clarification_text').eq('org_id', orgId).eq('visible_to_investors', true);
    founderClarifications = (clarificationRows ?? []).map((r) => ({
      category: r.category as ReviewCategory, text: r.clarification_text as string,
    }));
  }

  const full: FullDossierData = {
    overview: (overview ?? {}) as FullDossierData['overview'],
    tractionDetailed, team, contactHistory, documentTitles,
  };

  // Prompt 326 — fetched at EVERY level, same "not level-gated" treatment
  // as the intro pitch (Prompt 325): badges are Discovery-visible by
  // design. Projected through projectBadgesForInvestor immediately, not
  // left for the caller — verification_note/evidence_document_id/disputed
  // rows never leave this function at all.
  const { data: badgeRows } = await admin.from('company_badges')
    .select('id, name, description, year, verification_status').eq('org_id', orgId);
  const badges = projectBadgesForInvestor(
    (badgeRows ?? []).map((b) => ({
      id: b.id as string, name: b.name as string, description: b.description as string | null,
      year: b.year as number | null, verificationStatus: b.verification_status as 'unverified' | 'verified' | 'disputed',
    })),
  );

  // Mini-pitch. Only ever fetched at level >= 1 (same "not fetched-then-
  // hidden" discipline as swot/overview/roadmap above), and only an
  // ACTIVATED row counts — a founder still previewing/regenerating a draft
  // must never have it leak to an investor a moment before they meant to
  // publish it.
  let miniPitch: MiniPitchSlideProjected[] | null = null;
  if (level >= 1) {
    const { data: pitchRow } = await admin.from('org_mini_pitches')
      .select('slides, activated_at').eq('org_id', orgId).maybeSingle();
    if (pitchRow?.activated_at) {
      miniPitch = projectMiniPitchForInvestor((pitchRow.slides as StoredMiniPitchSlide[] | null) ?? []);
    }
  }

  return { full, swot, swotToggleOn, roadmap, roadmapToggleOn, founderClarifications, badges, miniPitch };
}
