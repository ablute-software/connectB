// Prompt 421 §E — the one real permission action this wave adds to what
// was a purely read-only ColleaguesCard: remove a colleague's access to
// this firm's workspace. Any active member of the firm can revoke any
// other — no owner/member role gate, matching how this codebase already
// treats firm-level decisions elsewhere (investor_relationship_decisions'
// own AP-14 note: "the decision belongs to the ORGANIZATION, not this one
// user"). Never lets a caller revoke their own membership through this
// route (that's a different action — leaving the firm — out of scope
// here) and never touches a different firm's row.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const own = await resolveActiveInvestorMember(admin, user.id);
  if (!own) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { memberId?: string };
  const memberId = body.memberId;
  if (!memberId) return NextResponse.json({ ok: false, error: 'Missing memberId.' }, { status: 400 });
  if (memberId === own.id) return NextResponse.json({ ok: false, error: "Can't revoke your own access here." }, { status: 400 });

  // Scoped to the SAME firm as the caller — never cross-firm, checked here
  // (not just relied on client-side) since this route uses the admin
  // client and bypasses RLS entirely.
  const { data: target } = await admin.from('matchdeal_investor_members')
    .select('id, catalog_entity_id').eq('id', memberId).maybeSingle();
  if (!target || target.catalog_entity_id !== own.catalog_entity_id) {
    return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  const { error } = await admin.from('matchdeal_investor_members').update({ status: 'revoked' }).eq('id', memberId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
