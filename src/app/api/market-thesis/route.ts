// Prompt 444 §A/§D — Market Thesis: read + update. GET bundles the current
// thesis and its active hypotheses in one round trip (the UI always needs
// both together). PATCH upserts the thesis (one row per org, no history —
// same discipline as org_market_data) and bumps `version` only when a real
// content field changed (nextMarketThesisVersion, market-thesis.ts) — a
// no-op resubmit, or a save that only touches updated_at, leaves it alone.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketThesisAvailable, marketHypothesesAvailable, marketThesisDocumentSuggestMarkAvailable } from '@/lib/market-data-capability';
import { sanitizeMarketThesisFields, nextMarketThesisVersion, MARKET_THESIS_TEXT_MAX, MARKET_THESIS_TEXT_FIELD_KEYS, type MarketThesisFields, type MarketThesisTextFieldKey } from '@/lib/market-thesis';
import {
  readCandidateDocumentIds, computeDocumentSuggestSignature, isThesisIncomplete, shouldAutoSuggestFromDocuments,
} from '@/lib/market-thesis-document-suggest';
import { truncateAtWord } from '@/lib/text-truncate';

async function resolveOrgId(sb: Awaited<ReturnType<typeof serverClient>>, userId: string): Promise<string | null> {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const orgId = await resolveOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  if (!(await marketThesisAvailable())) return NextResponse.json({ available: false });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const hypothesesAvail = await marketHypothesesAvailable();

  const [{ data: thesis }, hypothesesResult, { data: org }] = await Promise.all([
    admin.from('org_market_thesis').select('*').eq('org_id', orgId).maybeSingle(),
    hypothesesAvail
      ? admin.from('org_market_hypotheses').select('id, label, definition, thesis_version, status, position')
        .eq('org_id', orgId).eq('status', 'active').order('position', { ascending: true })
      : Promise.resolve({ data: [] as unknown[] }),
    admin.from('orgs').select('intro_problem, intro_solution, one_liner, description, country').eq('id', orgId).maybeSingle(),
  ]);

  // Prompt 456 — real, zero-LLM-cost suggestions for the 3 text fields that
  // already have a founder-confirmed source elsewhere (Settings → Intro
  // pitch, and the org's own country). Never overwrites a field the
  // founder already has here, even if it differs from the source.
  const suggestions: Partial<Record<'product_summary' | 'core_problem' | 'geography', string>> = {};
  if (!thesis?.product_summary?.trim()) {
    // Prompt 457 — intro_solution is empty for orgs (ablute_ included) that
    // never filled in Settings → Intro pitch. one_liner/description are a
    // richer, already-confirmed fallback source — company_claims was
    // checked too (Prompt 457's own investigation) and rejected: 'problema'
    // is empty and 'solucao' mixes in unrelated topics (rounds, pilots),
    // too noisy to suggest cleanly.
    const fallback = org?.intro_solution?.trim() || org?.one_liner?.trim() || truncateAtWord(org?.description?.trim(), MARKET_THESIS_TEXT_MAX);
    if (fallback) suggestions.product_summary = fallback;
  }
  if (!thesis?.core_problem?.trim() && org?.intro_problem?.trim()) suggestions.core_problem = org.intro_problem.trim();
  if (!thesis?.geography?.trim() && org?.country?.trim()) suggestions.geography = org.country.trim();

  // Prompt 473 §1 — whether the client should fire the automatic
  // document-suggestion pass. Decided HERE, on the server, because two of
  // the three conditions (the recorded signature, the candidate document
  // set) are things the browser cannot know. This GET itself stays
  // zero-cost: no model call, and the two document queries below only run
  // when the thesis is actually incomplete — a founder with a complete
  // thesis pays nothing extra for this field existing.
  //
  // The POST re-checks all of this independently; this flag is a hint to
  // the client, never an authorisation.
  const thesisFields: Partial<Record<MarketThesisTextFieldKey, string | null>> = {};
  for (const key of MARKET_THESIS_TEXT_FIELD_KEYS) {
    const v = (thesis as Record<string, unknown> | null)?.[key];
    thesisFields[key] = typeof v === 'string' ? v : null;
  }
  let autoSuggestEligible = false;
  if (isThesisIncomplete(thesisFields) && (await marketThesisDocumentSuggestMarkAvailable())) {
    const candidateIds = await readCandidateDocumentIds(admin, orgId);
    autoSuggestEligible = shouldAutoSuggestFromDocuments({
      thesisIncomplete: true,
      candidateDocumentCount: candidateIds.length,
      currentSignature: candidateIds.length > 0 ? computeDocumentSuggestSignature(candidateIds) : null,
      storedSignature: ((thesis as Record<string, unknown> | null)?.document_suggest_auto_signature as string | null) ?? null,
      markCapabilityAvailable: true,
    });
  }

  return NextResponse.json({
    available: true, thesis: thesis ?? null, hypotheses: hypothesesResult.data ?? [], suggestions,
    autoSuggest: { eligible: autoSuggestEligible },
  });
}

export async function PATCH(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const orgId = await resolveOrgId(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  if (!(await marketThesisAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const next = sanitizeMarketThesisFields(body);

  const { data: existingRow } = await admin.from('org_market_thesis').select('*').eq('org_id', orgId).maybeSingle();
  const existing: (MarketThesisFields & { version: number }) | null = existingRow ? {
    product_summary: existingRow.product_summary as string | null,
    core_problem: existingRow.core_problem as string | null,
    primary_user: existingRow.primary_user as string | null,
    economic_buyer: existingRow.economic_buyer as string | null,
    beachhead: existingRow.beachhead as string | null,
    geography: existingRow.geography as string | null,
    primary_use_case: existingRow.primary_use_case as string | null,
    adjacent_technologies: (existingRow.adjacent_technologies as string[] | null) ?? [],
    excluded_markets: (existingRow.excluded_markets as string[] | null) ?? [],
    version: existingRow.version as number,
  } : null;

  const version = nextMarketThesisVersion(existing, next);

  const { error } = await admin.from('org_market_thesis').upsert({
    org_id: orgId, ...next, version, updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, version });
}
