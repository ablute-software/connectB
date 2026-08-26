// Prompt 359 Block D — the founder's one-click reply to a suggestion:
// "Add" creates the real roadmap_events row (resolving category_label back
// to this org's own category_id by label match, falling back to General);
// "ignore" marks it dismissed, which the unique(org_id, signature)
// constraint then keeps from ever being re-suggested for this exact
// knowledge state again.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { roadmapEventSuggestionsAvailable, roadmapEventsAvailable } from '@/lib/document-extraction-capability';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await roadmapEventSuggestionsAvailable()) || !(await roadmapEventsAvailable())) {
    return NextResponse.json({ ok: false, error: 'not configured' });
  }

  const body = await req.json().catch(() => ({})) as { id?: string; action?: 'add' | 'ignore' };
  if (!body.id || (body.action !== 'add' && body.action !== 'ignore')) {
    return NextResponse.json({ ok: false, error: 'id and action are required.' }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: suggestion } = await admin.from('roadmap_event_suggestions')
    .select('id, kind, title, date, date_precision, category_label, document_id')
    .eq('id', body.id).eq('org_id', orgId).eq('status', 'pending').maybeSingle();
  if (!suggestion) return NextResponse.json({ ok: false, error: 'Suggestion not found.' }, { status: 404 });

  if (body.action === 'ignore') {
    const { error } = await admin.from('roadmap_event_suggestions').update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Prompt 387 §D.3 — a question has no date, no category, nothing to
  // insert as a real event on its own; "Add as event" just consumes the
  // question (same lifecycle as an ignored/added event — it never comes
  // back) and hands the client its own title back, to pre-fill the SAME
  // create-event popover a manual "+ Add event" opens. The founder still
  // supplies the actual date.
  if (suggestion.kind === 'question') {
    const { error } = await admin.from('roadmap_event_suggestions').update({ status: 'added', updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, question: { title: suggestion.title } });
  }

  // Prompt 359 — the actual roadmap_events INSERT happens client-side via
  // the store's own addRoadmapEvent (same RLS-protected direct-to-Supabase
  // path every other roadmap CRUD action uses), never here: this route
  // only resolves category_label -> this org's real category_id and marks
  // the suggestion consumed. Inserting here too would either double-insert
  // or leave the client's local store stale until a full reload — the
  // client is the single place that both writes AND updates local state,
  // so it must be the one that actually creates the row.
  let categoryId: string | null = null;
  if (suggestion.category_label) {
    const { data: cat } = await admin.from('roadmap_categories').select('id').eq('org_id', orgId).ilike('label', suggestion.category_label).maybeSingle();
    categoryId = (cat?.id as string | undefined) ?? null;
  }

  const { error } = await admin.from('roadmap_event_suggestions').update({ status: 'added', updated_at: new Date().toISOString() })
    .eq('id', body.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    event: {
      title: suggestion.title, date: suggestion.date, date_precision: suggestion.date_precision,
      status: new Date(suggestion.date as string) < new Date() ? 'done' : 'planned',
      category_id: categoryId, document_id: suggestion.document_id,
    },
  });
}
