// Prompt I-01 §C.3 — who am I in the incubator workspace: my membership and
// my incubator's profile (read through RLS: incubators_member_read).
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';

// Per-user, per-request data: never prerendered (an env-less build would
// otherwise freeze the not-configured answer into a static file).
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const { sb, member, email } = gate;
  const { data: incubator, error } = await sb.from('incubators')
    .select('id, name, slug, kind, website, country, city, logo_url, description, related_catalog_entity_id, is_test')
    .eq('id', member.incubatorId).maybeSingle();
  if (error || !incubator) return NextResponse.json({ ok: false, error: 'not_allowed' }, { status: 403 });
  // D3 — the member sees whether a catalog link exists, not the catalog row.
  const { related_catalog_entity_id: related, ...rest } = incubator;
  return NextResponse.json({
    ok: true,
    member: { id: member.id, role: member.role, email },
    incubator: { ...rest, alsoInvests: !!related },
  });
}
