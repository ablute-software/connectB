// Prompt 295 §2 — flush endpoint for use-usage-heartbeat.ts. One row per
// session (id supplied by the client, generated once per tab-session),
// updated in place on every ~60s flush rather than inserted per heartbeat
// — same "aggregate, don't spam" discipline the hook itself follows.
// Service-role write only, same "never a direct browser write" pattern
// as page-view/route.ts (app_events) — RLS on usage_sessions has no
// insert/update policy for anon/authenticated at all.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { assertNotViewer, readVerifiedViewerOrgId } from '@/lib/developer-viewer';
import { usageSessionsAvailable } from '@/lib/usage-sessions-capability';
import { resolveOwnMatchdealProfileId } from '@/lib/matchdeal-pairing';

export async function POST(req: NextRequest) {
  if (!authEnabled) return NextResponse.json({ ok: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true });
  if (!(await usageSessionsAvailable())) return NextResponse.json({ ok: true });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true }); // unauthenticated — nothing attributable

  const body = await req.json().catch(() => ({})) as {
    sessionId?: string; context?: string; activeSeconds?: number; standbySeconds?: number; ended?: boolean;
    matchdealProfileId?: string; matchdealKind?: 'startup' | 'investor';
  };
  const { sessionId, context, ended } = body;
  const activeSeconds = Math.max(0, Math.round(body.activeSeconds ?? 0));
  const standbySeconds = Math.max(0, Math.round(body.standbySeconds ?? 0));
  if (!sessionId || (context !== 'crm' && context !== 'backoffice' && context !== 'matchdeal')) {
    return NextResponse.json({ ok: false, error: 'sessionId and a valid context are required.' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let orgId: string | null = null;
  let matchdealProfileId: string | null = null;
  if (context === 'crm' || context === 'backoffice') {
    // Prompt 559 §A — verified, so a forged cookie cannot attribute this
    // session to another org.
    orgId = await readVerifiedViewerOrgId(sb, req);
    if (!orgId) {
      const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
      orgId = (member?.org_id as string | undefined) ?? null;
    }
  } else if (context === 'matchdeal' && body.matchdealKind) {
    // Never trust the client's matchdealProfileId directly — re-resolve
    // server-side the same way /api/matchdeal/pairing/self does, and only
    // accept it if it matches what the client claimed for itself.
    const resolved = await resolveOwnMatchdealProfileId(admin, user.id, body.matchdealKind);
    if (resolved && resolved === body.matchdealProfileId) matchdealProfileId = resolved;
  }

  const now = new Date().toISOString();
  const { data: existing } = await admin.from('usage_sessions')
    .select('id, active_seconds, standby_seconds').eq('id', sessionId).maybeSingle();

  if (existing) {
    await admin.from('usage_sessions').update({
      active_seconds: (existing.active_seconds as number ?? 0) + activeSeconds,
      standby_seconds: (existing.standby_seconds as number ?? 0) + standbySeconds,
      last_flush_at: now,
      ended_at: ended ? now : null,
    }).eq('id', sessionId);
  } else {
    await admin.from('usage_sessions').insert({
      id: sessionId, context, active_seconds: activeSeconds, standby_seconds: standbySeconds,
      last_flush_at: now, ended_at: ended ? now : null,
      user_id: user.id, org_id: orgId, matchdeal_profile_id: matchdealProfileId,
    });
  }

  return NextResponse.json({ ok: true });
}
