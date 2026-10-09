// Prompt 905 — "does this person get the Calls tab?" The two workspace shells call this on mount. With the
// switch off (or the caller not on the allowlist) it answers 404 and the tab simply never appears.
import { NextResponse } from 'next/server';
import { authCalls } from '@/lib/calls/access';

export async function GET() {
  const auth = await authCalls();
  if (auth.error) return auth.error;
  return NextResponse.json({
    ok: true,
    promoters: auth.promoters.map((p) => ({ kind: p.kind, id: p.id, name: p.name, canManage: p.canManage })),
  });
}
