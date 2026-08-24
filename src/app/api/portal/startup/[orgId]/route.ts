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
//
// Prompt 167 §C — `dossier.roadmap` is the same pattern once more:
// level >= 1 AND orgs.roadmap_visible_to_investors, projected to only
// period_kind/period_year/period_quarter/items (migration 0161).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getPipelineWaves } from '@/lib/investor-pipeline';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { currentInterestLevel, projectDossier } from '@/lib/investor-interest-level';
import { getInterestLevelRows, toInvestorFacingLevelRows } from '@/lib/investor-interest-level-db';
import { interestLevelAvailable } from '@/lib/investor-interest-level-capability';
import { fetchDossierRawData } from '@/lib/dossier-fetch';
import { pioneerBadgeAvailable } from '@/lib/pioneer-capability';

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

  // Prompt 161 §C.4 — "ao lado do nome da empresa no perfil/dossiê visível
  // ao investidor." Deliberately a single-org read here, not threaded
  // through getPipelineWaves (shared by the whole Pipeline list + the CSV
  // export, already a heavier computation) — the prompt only asks for the
  // dossier header, not every row of the list.
  let pioneerBadge = false;
  if (await pioneerBadgeAvailable()) {
    const { data: orgRow } = await admin.from('orgs').select('pioneer_badge').eq('id', params.orgId).maybeSingle();
    pioneerBadge = !!orgRow?.pioneer_badge;
  }

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

  // Prompt 306 — the read sequence itself now lives in dossier-fetch.ts,
  // shared with the founder-only "see it like an investor" preview so the
  // two never drift into two different filters over the same data.
  const raw = await fetchDossierRawData(
    admin, params.orgId, level,
    investorCatalogEntityId ? { investorCatalogEntityId, email } : null,
  );
  const dossier = projectDossier(level, raw.full, shareEmail, raw.swot, raw.founderClarifications, raw.roadmap, raw.badges, raw.miniPitch, raw.media);

  // Bug fix (relatorio_verificacao_..._8143c75_p136 §3) — this used to
  // forward `levelRows` in full, `note` included: the founder's own
  // private reasoning for a grant/deny decision, sitting unlabeled in the
  // investor's Network tab despite never being rendered anywhere in the
  // UI. toInvestorFacingLevelRows keeps only {level, status} — everything
  // the client actually uses (the "Request contact"/"waiting"/"declined"
  // buttons key off status alone).
  return NextResponse.json({ card, pioneerBadge, level, levelRows: toInvestorFacingLevelRows(levelRows), dossier });
}
