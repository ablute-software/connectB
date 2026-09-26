// Prompt 742 §D.3 — fills document_views.seconds/.pages, which have
// existed since day one (checked against production before this) but
// nothing ever wrote to them, so /documents/access-log always showed "—"
// for how long and how many pages, despite promising it (Prompt 603).
//
// Only ever updates the ONE row this call's own session (or guest token)
// actually owns, and only while it's recent — never lets an old or
// someone-else's view be nudged by a stray/forged viewId.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

const MAX_DELTA_SECONDS = 90;
// D.3 says "limited to the PDF's own page count" — the payload this route
// accepts has no totalPages field (by the prompt's own spec), and a
// well-behaved client can never observe more distinct pages than the PDF
// actually has (it only ever reports page numbers it rendered). This cap
// is the defensive belt for a malformed/forged value, not a per-document
// lookup this phase never asked for.
const MAX_SANE_PAGES = 10_000;
const RECENT_WINDOW_HOURS = 12;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'sign_in_required' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    viewId?: string; activeSecondsDelta?: number; distinctPagesSeen?: number;
  };
  if (!body.viewId) return NextResponse.json({ ok: false, error: 'viewId is required' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - RECENT_WINDOW_HOURS * 3_600_000).toISOString();
  // Confirmed against production: this table's timestamp column is
  // `viewed_at` (set at insert time, `now()` default) — not `created_at`.
  const { data: row } = await admin.from('document_views')
    .select('id, seconds, pages')
    .eq('id', body.viewId).eq('viewer_email', email).gte('viewed_at', cutoff).maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const delta = Math.max(0, Math.min(MAX_DELTA_SECONDS, Math.round(body.activeSecondsDelta ?? 0)));
  const reportedPages = Math.max(0, Math.min(MAX_SANE_PAGES, Math.round(body.distinctPagesSeen ?? 0)));
  const seconds = (row.seconds as number | null ?? 0) + delta;
  const pages = Math.max(row.pages as number | null ?? 0, reportedPages);

  const { error } = await admin.from('document_views').update({ seconds, pages }).eq('id', body.viewId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
