// Prompt 306 — "See how investors see this profile" read-only preview.
// Founder-only, own org only. Deliberately calls the EXACT SAME
// fetchDossierRawData + projectDossier sequence /api/portal/startup/[orgId]
// uses for a real investor (see dossier-fetch.ts's own header) — never a
// second implementation of the disclosure-ladder filter. `level` is an
// explicit simulation parameter here, not resolved from
// investor_relationship_decisions/investor_interest_levels — there is no
// real investor on the other side of this request, just a founder asking
// "what would level N show".
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { projectDossier, type InterestLevel } from '@/lib/investor-interest-level';
import { fetchDossierRawData } from '@/lib/dossier-fetch';

function parseLevel(raw: string | null): InterestLevel {
  const n = raw == null ? 3 : Number(raw);
  return n === 0 || n === 1 || n === 2 ? n : 3; // default AND fallback for anything unrecognised is the max level (3)
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const level = parseLevel(new URL(req.url).searchParams.get('level'));

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // No real investor on the other side of a self-preview, so contactHistory
  // stays [] — same as it would for any level<2 or identity-less caller of
  // the real route (Pedido 1: "não inventar dados").
  const raw = await fetchDossierRawData(admin, orgId, level, null);

  // Level 3 is the ceiling of what ANY investor could ever be granted
  // (shareEmail is its own separate founder decision on the level-3 grant
  // itself, per investor-interest-level.ts's own comment) — assumed true
  // here so the preview shows the most any investor could ever see,
  // documented rather than silently chosen (Pedido 1 explicitly asks not to
  // pick this in silence).
  const shareEmail = level >= 3;

  const dossier = projectDossier(level, raw.full, shareEmail, raw.swot, raw.founderClarifications, raw.roadmap, raw.badges);

  return NextResponse.json({
    ok: true, level, dossier,
    // Pedido 1 — a toggled-off section must be distinguishable from "not
    // unlocked at this level yet" so the preview page can render "off,
    // here's the switch" instead of just omitting the section like the real
    // investor-facing route does (which has no reason to ever explain an
    // absence to an investor).
    swotToggleOn: raw.swotToggleOn, roadmapToggleOn: raw.roadmapToggleOn,
  });
}
