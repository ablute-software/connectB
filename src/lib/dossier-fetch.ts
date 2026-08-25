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
  InterestLevel, FullDossierData, FounderClarificationFull, RoadmapEventFull, RoadmapCategoryFull,
} from './investor-interest-level';
import type { SwotData } from './types';
import type { ReviewCategory } from './review-clarifications';
import { projectBadgesForInvestor, type BadgePublic } from './company-badges';
import { projectMiniPitchForInvestor, type MiniPitchSlideProjected, type StoredMiniPitchSlide } from './mini-pitch';
import { projectMarketDataForInvestor, MARKET_GROUP_KEYS, type MarketGroupKey, type MarketInvestorPayload } from './market-data-investor-projection';

export interface DossierMarketRing {
  ring: string; label: string; definition: string | null; buyer: string | null; geography: string | null;
  sizeValueEur: number | null; sizeYear: number | null; sizeMethod: string | null; sizeSourceUrl: string | null;
  growthPct: number | null; growthPeriod: string | null;
}
export interface DossierMarketCompetitor {
  name: string; domain: string | null; companyType: string | null; description: string | null; positioning: string | null;
  lastRoundType: string | null; lastRoundAmountEur: number | null; lastRoundDate: string | null;
  lastKnownValuationEur: number | null; sourceUrl: string | null;
}
export interface DossierMarketRound {
  investorName: string; companyName: string; amountEur: number | null; investedAt: string | null; roundType: string | null;
}
export interface DossierMarketResearchItem { title: string; detail: string; sourceUrl: string | null }

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
  roadmap: { visible: boolean; events: RoadmapEventFull[]; categories?: RoadmapCategoryFull[] } | null;
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
  // Prompt 353 — company photos & videos, fetched at every level (same
  // "Discovery-visible by design" treatment as badges above) — level-gating
  // happens in projectDossier per category, since Team-category media
  // shouldn't reach an investor before the Team section itself does.
  // Never includes an item that hasn't cleared malware scanning (fail-
  // closed, same rule as documents) — filtered in the query itself, not
  // after the fact.
  media: DossierMediaItem[];
  // Prompt 373 §F — group-by-group publish. `visibleGroups` (which the
  // founder chose) travels alongside the actual data for the same reason
  // swotToggleOn does above: a caller explaining an absence needs to know
  // whether a group is off vs. simply empty. Fail-closed by omission — a
  // group's DATA is only ever queried when its key is in visibleGroups (see
  // fetchDossierRawData's own market block), never fetched-then-hidden.
  market: { visibleGroups: MarketGroupKey[] } & Partial<{
    rings: DossierMarketRing[]; competitors: DossierMarketCompetitor[]; rounds: DossierMarketRound[];
    trends: DossierMarketResearchItem[]; regulatory: DossierMarketResearchItem[]; definition: DossierMarketResearchItem[];
  }>;
}

export interface DossierMediaItem {
  id: string; category: 'company' | 'technology' | 'team'; caption: string;
  kind: 'image' | 'video_upload' | 'video_link'; url: string;
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
  // overview above. Prompt 359 Block E — reads roadmap_events (the canvas's
  // own per-event rows) instead of the legacy company_roadmap_milestones;
  // selects only the investor-safe fields (never org_id/sort_order/
  // created_at/updated_at).
  let roadmap: { visible: boolean; events: RoadmapEventFull[]; categories?: RoadmapCategoryFull[] } | null = null;
  let roadmapToggleOn = true;
  if (level >= 1) {
    const { data: orgRow } = await admin.from('orgs').select('roadmap_visible_to_investors').eq('id', orgId).maybeSingle();
    roadmapToggleOn = (orgRow?.roadmap_visible_to_investors as boolean | null | undefined) ?? true;
    if (roadmapToggleOn) {
      const [{ data: eventRows }, { data: categoryRows }] = await Promise.all([
        admin.from('roadmap_events')
          .select('id, title, description, date, end_date, status, category_id, document_id').eq('org_id', orgId).order('date', { ascending: true }),
        admin.from('roadmap_categories')
          .select('id, label, color, shape').eq('org_id', orgId).order('created_at', { ascending: true }),
      ]);
      roadmap = {
        visible: true,
        events: (eventRows ?? []).map((r) => ({
          id: r.id as string, title: r.title as string, description: (r.description as string | null) ?? undefined,
          date: r.date as string, end_date: (r.end_date as string | null) ?? undefined,
          status: r.status as RoadmapEventFull['status'], category_id: (r.category_id as string | null) ?? undefined,
          // Prompt 359 Block E — the evidence chip names a specific
          // document, same disclosure tier as documentTitles below (level
          // >= 2, and never while the vault kill switch is on) — a level-1
          // investor sees the roadmap ITSELF but not which document backs
          // an entry, same as they see zero document titles anywhere else
          // in the dossier at that level.
          document_id: level >= 2 ? ((r.document_id as string | null) ?? undefined) : undefined,
        })),
        categories: (categoryRows ?? []).map((c) => ({
          id: c.id as string, label: c.label as string, color: c.color as string, shape: c.shape as string,
        })),
      };
    }
  }

  // Prompt 373 §F — Market data, group by group. `market_groups_visible_to_
  // investors` is unconditionally read (it's a cheap, always-present column,
  // same as roadmap/swot's own toggle reads above) but each GROUP's actual
  // data is only queried when its key is present — the "not fetched-then-
  // hidden" discipline this file's header describes, applied per-group
  // instead of per-section. §0.1 is what makes this investor-facing at all
  // possible now (see migration 0246's own header for the full reasoning);
  // §F.5 still applies in full: nothing here ever reads passes, outreach
  // counts, or pipeline stats — only the founder's own market research.
  let visibleGroups: MarketGroupKey[] = [];
  const marketFull: MarketInvestorPayload = {};
  if (level >= 1) {
    const { data: orgRow } = await admin.from('orgs').select('market_groups_visible_to_investors').eq('id', orgId).maybeSingle();
    visibleGroups = ((orgRow?.market_groups_visible_to_investors as string[] | null) ?? [])
      .filter((g): g is MarketGroupKey => (MARKET_GROUP_KEYS as string[]).includes(g));

    if (visibleGroups.includes('rings')) {
      const { data: rows } = await admin.from('org_market_rings')
        .select('ring, label, definition, buyer, geography, size_value_eur, size_year, size_method, size_source_url, growth_pct, growth_period')
        .eq('org_id', orgId).eq('status', 'accepted');
      marketFull.rings = (rows ?? []).map((r) => ({
        ring: r.ring as string, label: r.label as string, definition: r.definition as string | null,
        buyer: r.buyer as string | null, geography: r.geography as string | null,
        sizeValueEur: r.size_value_eur as number | null, sizeYear: r.size_year as number | null,
        sizeMethod: r.size_method as string | null, sizeSourceUrl: r.size_source_url as string | null,
        growthPct: r.growth_pct as number | null, growthPeriod: r.growth_period as string | null,
      })) as DossierMarketRing[];
    }

    let competitorCompanyIds: string[] = [];
    if (visibleGroups.includes('competitors') || visibleGroups.includes('rounds')) {
      const { data: rows } = await admin.from('org_competitors')
        .select('positioning, market_company_id, market_companies(name, domain, company_type, description, last_round_type, last_round_amount_eur, last_round_date, last_known_valuation_eur, source_url)')
        .eq('org_id', orgId);
      competitorCompanyIds = ((rows ?? []) as { market_company_id: string }[]).map((r) => r.market_company_id);
      if (visibleGroups.includes('competitors')) {
        marketFull.competitors = ((rows ?? []) as Record<string, unknown>[]).map((r) => {
          const mc = (r.market_companies as Record<string, unknown> | null) ?? {};
          return {
            name: (mc.name as string) ?? 'Unknown', domain: (mc.domain as string | null) ?? null,
            companyType: (mc.company_type as string | null) ?? null, description: (mc.description as string | null) ?? null,
            positioning: r.positioning as string | null,
            lastRoundType: (mc.last_round_type as string | null) ?? null, lastRoundAmountEur: (mc.last_round_amount_eur as number | null) ?? null,
            lastRoundDate: (mc.last_round_date as string | null) ?? null, lastKnownValuationEur: (mc.last_known_valuation_eur as number | null) ?? null,
            sourceUrl: (mc.source_url as string | null) ?? null,
          };
        }) as DossierMarketCompetitor[];
      }
    }

    if (visibleGroups.includes('rounds') && competitorCompanyIds.length > 0) {
      // Same "don't .in() a long id list" gotcha as competitor-investments/
      // route.ts — this list is small (this org's own declared competitors)
      // so it's a non-issue here, but filtering in memory keeps the same
      // discipline as every other reader of this table.
      const { data: rows } = await admin.from('investor_investments')
        .select('company_id, amount_eur, invested_at, round_type, catalog_entities(name), market_companies(name)');
      const companyIdSet = new Set(competitorCompanyIds);
      marketFull.rounds = ((rows ?? []) as Record<string, unknown>[])
        .filter((r) => companyIdSet.has(r.company_id as string))
        .map((r) => ({
          investorName: (r.catalog_entities as { name?: string } | null)?.name ?? 'Unknown investor',
          companyName: (r.market_companies as { name?: string } | null)?.name ?? 'a competitor',
          amountEur: r.amount_eur as number | null, investedAt: r.invested_at as string | null, roundType: r.round_type as string | null,
        })) as DossierMarketRound[];
    }

    for (const [group, section] of [['trends', 'trends'], ['regulatory', 'regulatory'], ['definition', 'definition']] as const) {
      if (!visibleGroups.includes(group)) continue;
      const { data: rows } = await admin.from('market_research_items')
        .select('title, detail, source_url').eq('org_id', orgId).eq('section', section).eq('status', 'accepted');
      marketFull[group] = ((rows ?? []) as { title: string; detail: string; source_url: string | null }[])
        .map((r) => ({ title: r.title, detail: r.detail, sourceUrl: r.source_url }));
    }
  }
  // Defense-in-depth (this file's own root-cause lesson, see header): even
  // though only enabled groups were ever queried above, project again
  // before returning — a group's data can never leave this function unless
  // its key survives BOTH the query gate and this final filter.
  const market = { visibleGroups, ...projectMarketDataForInvestor(visibleGroups, marketFull) } as DossierRawData['market'];

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

  // Prompt 353 — company photos & videos. `.eq('malware_scan_status', 'clean')`
  // in the query itself, not a JS filter after the fact — an unscanned or
  // flagged item never leaves the database, same fail-closed discipline
  // /api/portal/access applies to documents (toPortalDoc's own malware
  // check). video_link rows are written 'clean' at insert time (nothing to
  // scan), so this one filter covers both sources uniformly.
  const { data: mediaRows } = await admin.from('company_media')
    .select('id, kind, category, caption, storage_path, external_url')
    // Prompt 375 — 'local_only' (validated locally, never submitted to a
    // third party — the normal outcome for a private company photo/video
    // now) is exactly as safe to serve as 'clean'; only 'flagged' blocks.
    .eq('org_id', orgId).in('malware_scan_status', ['clean', 'local_only']).order('sort_order', { ascending: true });
  const media: DossierMediaItem[] = [];
  for (const m of mediaRows ?? []) {
    let itemUrl: string | null = null;
    if (m.kind === 'video_link') {
      itemUrl = m.external_url as string;
    } else if (m.storage_path) {
      const { data: signed } = await admin.storage.from('data-room').createSignedUrl(m.storage_path as string, 300);
      itemUrl = signed?.signedUrl ?? null;
    }
    if (itemUrl) {
      media.push({
        id: m.id as string, category: m.category as DossierMediaItem['category'],
        caption: m.caption as string, kind: m.kind as DossierMediaItem['kind'], url: itemUrl,
      });
    }
  }

  return { full, swot, swotToggleOn, roadmap, roadmapToggleOn, founderClarifications, badges, miniPitch, media, market };
}
