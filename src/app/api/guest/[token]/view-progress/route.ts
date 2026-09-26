// Prompt 742 §D.3 — the guest token's own equivalent of
// /api/portal/view-progress. Ownership is the token's invited_email, not a
// session — everything else (12h window, delta cap, cumulative pages) is
// identical.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { guestGrantTokenAvailable } from '@/lib/access-requests-capability';
import { findGrantByGuestToken } from '@/lib/guest-link-security';

const MAX_DELTA_SECONDS = 90;
const MAX_SANE_PAGES = 10_000;
const RECENT_WINDOW_HOURS = 12;

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false }, { status: 200 });
  if (!(await guestGrantTokenAvailable())) return NextResponse.json({ ok: false }, { status: 200 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { grant } = await findGrantByGuestToken(admin, params.token);
  if (!grant || grant.confirmed_at) return NextResponse.json({ ok: false, error: 'invalid' }, { status: 403 });
  if (!grant.guest_token_expires_at || new Date(grant.guest_token_expires_at as string) <= new Date()) {
    return NextResponse.json({ ok: false, error: 'expired' }, { status: 410 });
  }
  const invitedEmail = grant.invited_email as string;

  const body = await req.json().catch(() => ({})) as {
    viewId?: string; activeSecondsDelta?: number; distinctPagesSeen?: number;
  };
  if (!body.viewId) return NextResponse.json({ ok: false, error: 'viewId is required' }, { status: 400 });

  const cutoff = new Date(Date.now() - RECENT_WINDOW_HOURS * 3_600_000).toISOString();
  const { data: row } = await admin.from('document_views')
    .select('id, seconds, pages')
    .eq('id', body.viewId).eq('viewer_email', invitedEmail).gte('viewed_at', cutoff).maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const delta = Math.max(0, Math.min(MAX_DELTA_SECONDS, Math.round(body.activeSecondsDelta ?? 0)));
  const reportedPages = Math.max(0, Math.min(MAX_SANE_PAGES, Math.round(body.distinctPagesSeen ?? 0)));
  const seconds = (row.seconds as number | null ?? 0) + delta;
  const pages = Math.max(row.pages as number | null ?? 0, reportedPages);

  const { error } = await admin.from('document_views').update({ seconds, pages }).eq('id', body.viewId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
