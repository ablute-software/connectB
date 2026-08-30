// Prompt 481 §2 — the founder registers a round they already know about.
//
// "Nunca gated pelo estado da pesquisa pública": this route depends on
// nothing except the founder being signed in and in an org. A founder who
// only ever wants to type rounds by hand never waits for a search, never
// needs documents, and never sees a capability gate — the public-search
// half of the Capital Landscape can be missing, broken, or simply never run
// and this still works.
//
// No AI call, no cost, no lock: this is the founder's own data going
// straight into their own table.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { capitalLandscapeManualRoundsAvailable } from '@/lib/market-data-capability';
import { sanitizeManualRound } from '@/lib/capital-landscape';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await capitalLandscapeManualRoundsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const round = sanitizeManualRound(body);
  // The one required field, and the message says which — never a bare
  // "invalid input" for a form the founder is standing in front of.
  if (!round) return NextResponse.json({ ok: false, error: 'A company name is required to record a round.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.from('org_capital_landscape_rounds').insert({
    org_id: orgId,
    company_name: round.companyName,
    investor_name: round.investorName,
    amount_eur: round.amountEur,
    round_type: round.roundType,
    invested_at: round.investedAt,
    source_url: round.sourceUrl,
    // source is 'manual' by column default and pinned by a CHECK — never
    // taken from the request body, so a caller cannot dress a hand-typed
    // round up as a researched one and inherit the wrong warning (§5).
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
