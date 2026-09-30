// Prompt I-01 §C.4 — Founder › Definições › Programas: every relationship of
// the caller's org (founder_incubator_relationships(): only the incubator
// fields the screen shows; D3 as a boolean) and "Quem consultou"
// (founder_incubator_access_log()).
import { NextResponse } from 'next/server';
import { serverClient, authEnabled } from '@/lib/supabase-server';

// Per-user, per-request data: never prerendered (an env-less build would
// otherwise freeze the not-configured answer into a static file).
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!authEnabled) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  const [rels, log] = await Promise.all([
    sb.rpc('founder_incubator_relationships'),
    sb.rpc('founder_incubator_access_log'),
  ]);
  // Before the migration is applied the functions do not exist: an empty
  // section, never an error on the founder's settings page.
  if (rels.error) return NextResponse.json({ ok: true, available: false, relationships: [], accessLog: [] });
  return NextResponse.json({ ok: true, available: true, relationships: rels.data ?? [], accessLog: log.data ?? [] });
}
