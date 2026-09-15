// Prompt 692 — URGENT fix. MarketDataPanel.tsx's "Read my documents" picker
// used to query `documents`/`folders` directly from the browser
// (browserClient(), the session's own RLS-scoped client) with NO org_id
// filter at all, trusting RLS alone to scope the result. That works for an
// ordinary founder (documents_all: is_org_member(org_id) correctly limits
// them to their own org) but NOT for a platform_admin — documents_ablute_qa_read
// (is_ablute_developer() = is_platform_admin()) grants any admin unrestricted
// read across every org's Vault, with no org_id involved at all. Confirmed in
// production: sherlockdeal.com@gmail.com (a platform_admins row, member only
// of the Sherlock Deal org) saw ~80 documents in this exact picker — every
// other real org's Vault, CVs and a signed hospital LOI included — instead of
// its own 6.
//
// Same fix as every other market-data route already gets right
// (document-extract/route.ts's prepareDocumentForAi, portrait/route.ts's own
// cold-start fallback): resolve orgId from the CALLER's own org_members row
// (never a client-supplied value) and filter explicitly — "mesmo para
// admins" (Prompt 692 §3.1). Moved server-side entirely rather than just
// adding a client-side filter, because a client-side org_id is not a
// security boundary — the server has to be the one deciding it either way.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ documents: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ documents: [] });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const [{ data: docs }, { data: folders }] = await Promise.all([
    admin.from('documents').select('id, name, folder_id').eq('org_id', orgId),
    admin.from('folders').select('id, name').eq('org_id', orgId),
  ]);
  const folderNameById = new Map(((folders ?? []) as { id: string; name: string | null }[]).map((f) => [f.id, f.name ?? '']));
  const documents = ((docs ?? []) as { id: string; name: string; folder_id: string | null }[]).map((d) => ({
    id: d.id, name: d.name, folderName: d.folder_id ? folderNameById.get(d.folder_id) ?? '' : '',
  }));
  return NextResponse.json({ documents });
}
