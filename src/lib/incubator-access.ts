// Prompt I-01 §B.3 — the single gate every /api/incubator/** route starts
// with. Server-only entry point; the logic is in incubator-access-core.ts.
// Nothing here reads a founder table: the incubator reads only its own
// tables (and, for the Portfolio, the incubator_portfolio() function, which
// returns level-0 fields only).
import 'server-only';
import { NextResponse } from 'next/server';
import { serverClient, authEnabled } from './supabase-server';
import { resolveIncubatorMember, type IncubatorMember } from './incubator-access-core';

export { resolveIncubatorMember, resolveIncubatorAccess } from './incubator-access-core';
export type { IncubatorMember, IncubatorAccess } from './incubator-access-core';

type Sb = Awaited<ReturnType<typeof serverClient>>;

export interface IncubatorGate {
  sb: Sb;
  userId: string;
  email: string | null;
  member: IncubatorMember;
}

// Session + active membership, or the error response to return. `ownerOnly`
// adds the owner check the Equipa/Definições writes need (the SQL functions
// re-check it — this only gives the UI a clean 403).
export async function requireIncubatorMember(
  opts: { incubatorId?: string | null; ownerOnly?: boolean } = {},
): Promise<IncubatorGate | { error: NextResponse }> {
  if (!authEnabled) return { error: NextResponse.json({ ok: false, error: 'not configured', demo: true }, { status: 200 }) };
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 }) };
  const member = await resolveIncubatorMember(sb, user.id, opts.incubatorId);
  if (!member) return { error: NextResponse.json({ ok: false, error: 'not_allowed' }, { status: 403 }) };
  if (opts.ownerOnly && member.role !== 'owner') {
    return { error: NextResponse.json({ ok: false, error: 'not_allowed' }, { status: 403 }) };
  }
  return { sb, userId: user.id, email: user.email ?? null, member };
}
