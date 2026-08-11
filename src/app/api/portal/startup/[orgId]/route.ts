// P134-B / P136 — the startup dossier's own data: header (name/badges/
// decision state/data-room state, unchanged since P134-B — this is exactly
// what the compact Pipeline row already reveals at Discovery, per P134-A,
// so re-gating it a second time here would be security theater over data
// already sitting in the investor's browser from the Pipeline fetch) plus
// the disclosure ladder's own level-projected content (P136 §6): Overview
// body, team, traction, contact history, and document titles are NEVER
// sent below the level that unlocks them — projectDossier builds a
// DIFFERENT object per level, nothing is ever hidden client-side.
//
// Eligibility is the exact same P132-A union every other portal route uses
// (getPipelineWaves) — a startup that isn't in this investor's Pipeline
// gets a flat 404, identical whether the org doesn't exist or the investor
// just has no relationship to it, so this never leaks which orgs exist.
//
// Prompt 166 §D — `dossier.swot` follows the exact same level-gated,
// never-fetched-below-its-level pattern as `overview`, plus one extra gate
// of its own (orgs.swot_visible_to_investors, migration 0159).
//
// Prompt 168 §D — `dossier.founderClarifications` is the same pattern again:
// level >= 1, filtered at the query itself (visible_to_investors = true),
// projected to {category, text} only — item_text never has a path into
// this route's response.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getPipelineWaves } from '@/lib/investor-pipeline';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { currentInterestLevel, projectDossier, type FullDossierData, type FounderClarificationFull } from '@/lib/investor-interest-level';
import { getInterestLevelRows, toInvestorFacingLevelRows } from '@/lib/investor-interest-level-db';
import { interestLevelAvailable } from '@/lib/investor-interest-level-capability';
import { getInteractionTimeline } from '@/lib/investor-interaction-log';
import type { SwotData } from '@/lib/types';
import type { ReviewCategory } from '@/lib/review-clarifications';

export async function GET(req: Request, { params }: { params: { orgId: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = await getPipelineWaves(sb, admin, user.id, email);
  const card = result.linked ? result.waves.flatMap((w) => w.items).find((c) => c.orgId === params.orgId) : null;
  if (!card) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  // P136 — compute the current level. investor_relationship_decisions'
  // own decision drives level 0/1 and the mandatory pass-collapse; levels
  // 2/3 come from investor_interest_levels (0131, propose-only — degrades
  // to level-1-max, never crashes, on an environment that hasn't applied it).
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  const decisionForLevel: 'interested' | 'passed' | null = card.status === 'passed' ? 'passed' : card.status === 'interested' ? 'interested' : null;
  const levelRows = investorCatalogEntityId && await interestLevelAvailable()
    ? await getInterestLevelRows(admin, params.orgId, investorCatalogEntityId) : [];
  const level = currentInterestLevel(decisionForLevel, levelRows);
  const shareEmail = levelRows.some((r) => r.level === 3 && r.status === 'granted' && r.shareDirectEmail);

  // Overview body — deliberately the SAME data surface matchdeal_startup_pitch_data
  // already exposes to investors browsing the MatchDeal deck (Prompt 98's
  // own SECURITY DEFINER RPC): no new private-data surface, just a second
  // place that reads it. Only fetched at all once level >= 1 unlocks it —
  // not fetched-then-hidden.
  let overview: Record<string, unknown> | null = null;
  if (level >= 1) {
    const { data: startupProfile } = await admin.from('matchdeal_profiles')
      .select('id, team_summary, representative_name, representative_linkedin')
      .eq('kind', 'startup').eq('membership_id', params.orgId).maybeSingle();
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
    const [{ data: people }, { data: docs }] = await Promise.all([
      admin.from('company_people').select('id, full_name, title, is_founder, linkedin_url, email').eq('org_id', params.orgId).order('sort_order', { ascending: true }),
      admin.from('documents').select('id, name').eq('org_id', params.orgId),
    ]);
    team = (people ?? []).map((p) => ({
      id: p.id as string, fullName: p.full_name as string, title: p.title as string | null,
      isFounder: p.is_founder as boolean, linkedinUrl: p.linkedin_url as string | null, email: p.email as string | null,
    }));
    documentTitles = (docs ?? []).map((d) => ({ id: d.id as string, name: d.name as string }));
    tractionDetailed = (overview?.traction_metrics as Record<string, unknown> | null) ?? {};
    if (investorCatalogEntityId) {
      const timeline = await getInteractionTimeline(admin, { investorCatalogEntityId, email, orgId: params.orgId });
      contactHistory = timeline.map((t) => ({ id: t.id, at: t.at, content: t.content, channel: t.channel }));
    }
  }

  // Prompt 166 §D — SWOT snapshot. Only ever fetched at level >= 1 (same
  // "not fetched-then-hidden" discipline as `overview` above), and only
  // when the founder's own toggle is on — no point reading review_runs at
  // all if the answer is going to be withheld anyway. Explicit projection
  // to SwotData's 4 arrays only: never the raw review_runs.report row (no
  // score/summary/risks/recommendations reaches this route's own local
  // scope beyond what's needed to build `swot`, let alone the client) —
  // the "never a silent join" discipline migration 0158 documents.
  let swot: { visible: boolean; data: SwotData } | null = null;
  if (level >= 1) {
    const { data: orgRow } = await admin.from('orgs').select('swot_visible_to_investors').eq('id', params.orgId).maybeSingle();
    const visible = (orgRow?.swot_visible_to_investors as boolean | null | undefined) ?? true;
    if (visible) {
      const { data: latestRun } = await admin.from('review_runs').select('report')
        .eq('org_id', params.orgId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const report = latestRun?.report as Partial<SwotData> | null | undefined;
      if (report) {
        swot = {
          visible: true,
          data: {
            strengths: report.strengths ?? [], weaknesses: report.weaknesses ?? [],
            opportunities: report.opportunities ?? [], threats: report.threats ?? [],
          },
        };
      }
    }
  }

  // Prompt 168 §D — founder clarifications. `.eq('visible_to_investors',
  // true)` in the query itself, not a JS filter after the fact — a hidden
  // clarification (including every clarification on a weaknesses/risks/
  // threats bullet, per Nuno's own decision that those stay fully out of
  // view even via a clarification) never leaves the database. Selects
  // ONLY category + clarification_text — never item_text or any other
  // column — the same explicit field-by-field projection §D.5 asks for,
  // matching the SWOT projection above rather than ever forwarding a raw row.
  let founderClarifications: FounderClarificationFull[] = [];
  if (level >= 1) {
    const { data: clarificationRows } = await admin.from('review_clarifications')
      .select('category, clarification_text').eq('org_id', params.orgId).eq('visible_to_investors', true);
    founderClarifications = (clarificationRows ?? []).map((r) => ({
      category: r.category as ReviewCategory, text: r.clarification_text as string,
    }));
  }

  const full: FullDossierData = {
    overview: (overview ?? {}) as FullDossierData['overview'],
    tractionDetailed, team, contactHistory, documentTitles,
  };
  const dossier = projectDossier(level, full, shareEmail, swot, founderClarifications);

  // Bug fix (relatorio_verificacao_..._8143c75_p136 §3) — this used to
  // forward `levelRows` in full, `note` included: the founder's own
  // private reasoning for a grant/deny decision, sitting unlabeled in the
  // investor's Network tab despite never being rendered anywhere in the
  // UI. toInvestorFacingLevelRows keeps only {level, status} — everything
  // the client actually uses (the "Request contact"/"waiting"/"declined"
  // buttons key off status alone).
  return NextResponse.json({ card, level, levelRows: toInvestorFacingLevelRows(levelRows), dossier });
}
