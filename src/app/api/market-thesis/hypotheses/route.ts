// Prompt 444 §B/§C.3 — the CONFIRM half of verify-then-promote: creates
// hypotheses for real. Never called directly by generate/route.ts — only
// by the founder's own explicit submit, after they've reviewed/edited/
// removed candidates client-side. The active cap (3) is enforced HERE,
// server-side, not just in the UI — same "not just cost, it's intellectual
// focus" reasoning the prompt states explicitly.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketThesisAvailable, marketHypothesesAvailable } from '@/lib/market-data-capability';
import { MAX_ACTIVE_HYPOTHESES, canHaveActiveHypotheses } from '@/lib/market-thesis';

const LABEL_MAX = 200;
const DEFINITION_MAX = 500;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  if (!(await marketThesisAvailable()) || !(await marketHypothesesAvailable())) {
    return NextResponse.json({ ok: false, error: 'not configured' });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({})) as { hypotheses?: { label?: string; definition?: string }[] };
  const candidates = (body.hypotheses ?? [])
    .map((h) => ({
      label: typeof h.label === 'string' ? h.label.trim().slice(0, LABEL_MAX) : '',
      definition: typeof h.definition === 'string' ? h.definition.trim().slice(0, DEFINITION_MAX) : '',
    }))
    .filter((h) => h.label && h.definition);
  if (candidates.length === 0) return NextResponse.json({ ok: false, error: 'Nothing to create.' }, { status: 400 });

  const { data: thesis } = await admin.from('org_market_thesis').select('version').eq('org_id', orgId).maybeSingle();
  if (!thesis) return NextResponse.json({ ok: false, error: 'Complete your Market Thesis first.' }, { status: 400 });

  const { count: activeCount } = await admin.from('org_market_hypotheses').select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('status', 'active');
  if (!canHaveActiveHypotheses(activeCount ?? 0, candidates.length)) {
    return NextResponse.json({
      ok: false,
      error: `You can have at most ${MAX_ACTIVE_HYPOTHESES} active hypotheses — archive one first, or select fewer.`,
    }, { status: 400 });
  }

  const { data: lastPositionRow } = await admin.from('org_market_hypotheses').select('position')
    .eq('org_id', orgId).order('position', { ascending: false }).limit(1).maybeSingle();
  let nextPosition = ((lastPositionRow?.position as number | undefined) ?? -1) + 1;

  const rows = candidates.map((c) => ({
    org_id: orgId, label: c.label, definition: c.definition,
    thesis_version: thesis.version as number, status: 'active', position: nextPosition++,
  }));

  const { data: inserted, error } = await admin.from('org_market_hypotheses').insert(rows)
    .select('id, label, definition, thesis_version, status, position');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, hypotheses: inserted ?? [] });
}
