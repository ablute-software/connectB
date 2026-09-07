// Prompt 605 §B — may this account send a suggestion? Read-only, cheap, and
// the ONE thing the widget asks before showing the second option.
//
// The answer here is display-truth only: /api/support/submit re-runs exactly
// the same gate before writing a suggestion, and that is the enforcement
// point. Same split as `entitlements` in /api/me — a client that lies about
// eligibility gets a 403 from the write path, not a ticket.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { platformBadgesAvailable } from '@/lib/platform-badges-capability';
import { loadOrgPlatformBadges } from '@/lib/platform-badges-server';
import { supportSuggestionsAvailable } from '@/lib/support-suggestions-capability';
import { canSuggest, qualifyingBadge } from '@/lib/suggestions-gate';

const SHUT = { ok: true, canSuggest: false, badge: null as string | null };

export async function GET() {
  if (!authEnabled) return NextResponse.json(SHUT);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json(SHUT);
  if (!(await supportSuggestionsAvailable()) || !(await platformBadgesAvailable())) return NextResponse.json(SHUT);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json(SHUT);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: member } = await admin.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member?.org_id) return NextResponse.json(SHUT);

  const badges = (await loadOrgPlatformBadges(admin, member.org_id as string)).map((b) => b.badge);
  return NextResponse.json({ ok: true, canSuggest: canSuggest({ activeBadges: badges }), badge: qualifyingBadge(badges) });
}
