// P134-B — the startup dossier's own data: header (name/badges/decision
// state/data-room state) plus Overview. Eligibility is the exact same P132-A
// union every other portal route uses (getPipelineWaves) — a startup that
// isn't in this investor's Pipeline gets a flat 404, identical whether the
// org doesn't exist or the investor just has no relationship to it, so this
// never leaks which orgs exist (per the mini-prompt's own requirement).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getPipelineWaves } from '@/lib/investor-pipeline';
import { getStartupPeople } from '@/lib/investor-interaction-log';

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

  // Overview — deliberately the SAME data surface matchdeal_startup_pitch_data
  // already exposes to investors browsing the MatchDeal deck (Prompt 98's
  // own SECURITY DEFINER RPC): no new private-data surface, just a second
  // place that reads it.
  const { data: startupProfile } = await admin.from('matchdeal_profiles')
    .select('id, team_summary, representative_name, representative_linkedin')
    .eq('kind', 'startup').eq('membership_id', params.orgId).maybeSingle();
  let overview = null;
  if (startupProfile) {
    const { data: pitch } = await admin.rpc('matchdeal_startup_pitch_data', { p_profile_id: startupProfile.id });
    // team_summary/representative fields live on matchdeal_profiles itself,
    // not the RPC's return shape — same is_visible=true gated row the RPC
    // already resolved from, just two more already-investor-facing columns.
    overview = pitch?.[0] ? {
      ...pitch[0], team_summary: startupProfile.team_summary,
      representative_name: startupProfile.representative_name, representative_linkedin: startupProfile.representative_linkedin,
    } : null;
  }

  // relatorio_verificacao_..._20260805 §4 — the Overview tab never actually
  // read company_people (only team_summary/representative_* free text on
  // matchdeal_profiles), even though the startup's real team roster
  // already exists and is filled in. Emails deliberately excluded here —
  // see the ladder in §5 (pending Nuno's own decision on when contacts
  // should open up); name/title/founder-flag/LinkedIn are already surfaced
  // elsewhere to investors (the RPC's own founders[] jsonb includes name/
  // title/bio) so showing them plainly here isn't a new disclosure.
  const team = await getStartupPeople(admin, params.orgId);

  return NextResponse.json({ card, overview, team });
}
