// Prompt 680 — the investor side had no equivalent of the founder's own
// /api/account/access-log at all: a founder can see who opened their
// documents and when, but an investor had no view of their OWN access
// history across the startups they follow. Same underlying table
// (document_views) both real open routes already write to
// (api/portal/open/[documentId], api/guest/[token]/open/[documentId]) —
// filtered by viewer_email instead of org_id, since one investor's history
// spans multiple startups rather than living inside one org.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: true, available: false, views: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // allowBillingLapsed:true — this is a read of your own history, not a
  // paid feature; a billing-lapsed investor should still be able to see it.
  const member = await resolveActiveInvestorMember(admin, user.id, { allowBillingLapsed: true });
  if (!member) return NextResponse.json({ ok: true, available: false, views: [] });

  const { data: views } = await admin.from('document_views')
    .select('id, org_id, document_id, viewed_at, seconds, pages')
    .eq('viewer_email', email).order('viewed_at', { ascending: false }).limit(300);

  const orgIds = [...new Set((views ?? []).map((v) => v.org_id as string))];
  const docIds = [...new Set((views ?? []).map((v) => v.document_id as string))];
  const [{ data: orgs }, { data: docs }] = await Promise.all([
    orgIds.length ? admin.from('orgs').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    docIds.length ? admin.from('documents').select('id, name').in('id', docIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const docNameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));

  return NextResponse.json({
    ok: true, available: true,
    views: (views ?? []).map((v) => ({
      id: v.id,
      orgName: orgNameById.get(v.org_id as string) ?? '(startup no longer exists)',
      documentName: docNameById.get(v.document_id as string) ?? '(document no longer exists)',
      viewedAt: v.viewed_at, seconds: v.seconds, pages: v.pages,
    })),
  });
}
