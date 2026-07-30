// Investor Workspace shell (prompt 57) — search catalog_entities by name so
// an investor can find/confirm their own firm when linking their session to
// a real matchdeal_investor_members row (About tab, first visit). Read-only,
// service-role (investors aren't org_members, same trust boundary as every
// other /api/portal/* route), requires a signed-in session but no further
// scoping — the catalog itself isn't sensitive per-org data.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

// Prompt 68 — a rejected entity (already reviewed and declined) must never
// be offered as a candidate to link against; "This is us" on a rejected row
// is always a dead end ("Could not automatically verify..." with no way
// out), the exact hole this closes. Only 'rejected' is excluded — 'pending'
// stays searchable on purpose, e.g. so a colleague at a newly-added firm
// (Prompt 63 Bloco 1) can find and link to the same row instead of creating
// a duplicate.
function looksLikeUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const host = new URL(withProto).hostname;
    return host.includes('.') && !/\s/.test(value);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q || q.length < 2) return NextResponse.json({ results: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await admin.from('catalog_entities').select('id, name, website')
    .ilike('name', `%${q}%`).neq('verification_status', 'rejected').limit(10);
  const results = (data ?? []).map((r) => ({ ...r, website: looksLikeUrl(r.website) ? r.website : null }));
  return NextResponse.json({ results });
}
