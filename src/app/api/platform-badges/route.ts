// Prompt 601 §D — founder-facing: my org's platform statuses, with what each
// one gives in plain words and, for tech master, where the 2-month window
// stands. Read through the service role after resolving the org from the
// session (same shape as /api/promo/status), never trusting a client id.
// Never reachable by an investor session: an investor has no org_members
// row, so this answers "no badges" — and nothing here is ever joined into
// a portal/dossier response.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { readVerifiedViewerOrgId } from '@/lib/developer-viewer';
import { platformBadgesAvailable } from '@/lib/platform-badges-capability';
import { loadOrgPlatformBadges, orgUsageSummary } from '@/lib/platform-badges-server';
import { BADGE_LABEL, freeTierFromBadges, rightsText, sortByImportance, techMasterWindow, TECH_MASTER_WARNING_PCTS } from '@/lib/platform-badges';

// Never prerendered: the early returns above the cookie read (no env, no
// table) let an env-less build cache this route as static, which would serve
// "no badges" to every founder forever. Confirmed in the 601 build manifest.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, badges: [], freeTier: null });
  if (!(await platformBadgesAvailable())) return NextResponse.json({ ok: true, badges: [], freeTier: null });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true, badges: [], freeTier: null });

  // Developer Viewer sessions see the viewed org's statuses (read-only, as
  // everything in the viewer is).
  let orgId = await readVerifiedViewerOrgId(sb, req);
  if (!orgId) {
    const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
    orgId = (member?.org_id as string | undefined) ?? null;
  }
  if (!orgId) return NextResponse.json({ ok: true, badges: [], freeTier: null });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const now = new Date();
  const rows = sortByImportance(await loadOrgPlatformBadges(admin, orgId));
  const usage = rows.some((r) => r.badge === 'tech_master') ? await orgUsageSummary(admin, orgId) : null;

  const badges = rows.map((r) => {
    const window = r.badge === 'tech_master' ? techMasterWindow(r, usage?.lastUse ?? null, now) : null;
    return {
      badge: r.badge, label: BADGE_LABEL[r.badge], rights: rightsText(r, now),
      grantedAt: r.legacy ? null : r.grantedAt, freeUntil: r.freeUntil, discountPct: r.discountPct,
      sedulousCount: r.sedulousCount,
      lapsed: !!r.lapsedAt,
      window: window ? {
        elapsedPct: window.elapsedPct, daysLeft: window.daysLeft, deadlineAt: window.deadlineAt,
        lastUse: usage?.lastUse ?? null, warning: window.elapsedPct >= TECH_MASTER_WARNING_PCTS[0],
      } : null,
    };
  });

  return NextResponse.json({ ok: true, badges, freeTier: freeTierFromBadges(rows, now) });
}
