// Prompt 444 §F — editing an existing hypothesis (label/definition) or
// archiving it (the founder deciding not to pursue it — never deleted,
// same "if it exists it's authentic" rule this codebase applies
// everywhere else). Not named as its own route in §C, but §F explicitly
// requires hypothesis cards to be editable, so this is the minimal
// addition that satisfies it, following the same per-resource PATCH shape
// already used elsewhere (e.g. /api/support/my-tickets/[id]).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketHypothesesAvailable } from '@/lib/market-data-capability';
import { MAX_ACTIVE_HYPOTHESES, canHaveActiveHypotheses } from '@/lib/market-thesis';

const LABEL_MAX = 200;
const DEFINITION_MAX = 500;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

  if (!(await marketHypothesesAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({})) as { label?: string; definition?: string; status?: string };
  const patch: Record<string, unknown> = {};

  if (body.label != null) {
    const label = body.label.trim().slice(0, LABEL_MAX);
    if (!label) return NextResponse.json({ ok: false, error: 'Label cannot be empty.' }, { status: 400 });
    patch.label = label;
  }
  if (body.definition != null) {
    const definition = body.definition.trim().slice(0, DEFINITION_MAX);
    if (!definition) return NextResponse.json({ ok: false, error: 'Definition cannot be empty.' }, { status: 400 });
    patch.definition = definition;
  }
  if (body.status != null) {
    if (body.status !== 'active' && body.status !== 'archived') {
      return NextResponse.json({ ok: false, error: 'status must be active or archived.' }, { status: 400 });
    }
    // Re-activating counts against the same cap creating one does — the
    // cap is about how many are being actively pursued at once, regardless
    // of whether the row is new or was archived earlier.
    if (body.status === 'active') {
      const { count } = await admin.from('org_market_hypotheses').select('id', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('status', 'active').neq('id', params.id);
      if (!canHaveActiveHypotheses(count ?? 0, 1)) {
        return NextResponse.json({ ok: false, error: `You can have at most ${MAX_ACTIVE_HYPOTHESES} active hypotheses.` }, { status: 400 });
      }
    }
    patch.status = body.status;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await admin.from('org_market_hypotheses').update(patch)
    .eq('id', params.id).eq('org_id', orgId).select('id, label, definition, thesis_version, status, position').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  return NextResponse.json({ ok: true, hypothesis: data });
}
