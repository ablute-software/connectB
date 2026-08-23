// Prompt 335 §D2 — search among founders who opted into network_discoverable.
// NOT open people search: only rows the org itself chose to be found by are
// ever returned, matched by name/sector/geography. Confirmed by reading:
// there is no investor-side equivalent discoverability flag anywhere in
// this schema (grepped matchdeal_profiles and the whole investor surface) —
// founders only, documented rather than silently assumed.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId, readDiscoverableFounderRows } from '@/lib/network-db';
import { searchDiscoverableFounders } from '@/lib/network';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await networkAvailable())) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 });

  const q = new URL(req.url).searchParams.get('q') ?? '';
  const rows = await readDiscoverableFounderRows(admin);
  const results = searchDiscoverableFounders(rows.filter((r) => r.orgId !== actor.orgId), q);
  return NextResponse.json({ ok: true, results });
}
