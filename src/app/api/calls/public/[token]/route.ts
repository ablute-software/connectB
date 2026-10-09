// Prompt 905 — what the link of a published call shows until the real applicant screen exists (Prompt 906):
// who promotes it, its name and dates, and one sentence about its state. Public on purpose (a candidate has no
// account yet), so it reveals nothing beyond the call's own header, and nothing at all while CALLS_MODE is off.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callsMode } from '@/lib/calls/mode';
import { loadCallByToken, promoterName } from '@/lib/calls/store';
import { syncStatus } from '@/lib/calls/state';
import { effectiveStatus, linkPlaceholderText } from '@/lib/calls/lifecycle';
import { formatDayInZone } from '@/lib/calls/tz';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  if (callsMode() === 'off') return NextResponse.json({ ok: false }, { status: 404 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false }, { status: 404 });
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const found = params.token.length >= 16 && params.token.length <= 64 ? await loadCallByToken(admin, params.token) : null;
  // A call that was taken back to draft ("Edit configuration") keeps its link but must not be advertised.
  if (!found || found.status === 'draft') return NextResponse.json({ ok: false }, { status: 404 });
  const call = await syncStatus(admin, found);
  const opens = formatDayInZone(call.opensAt, call.timezone);
  return NextResponse.json({
    ok: true,
    name: call.name, description: call.description, promoter: await promoterName(admin, call.promoterKind, call.promoterId),
    opensAt: call.opensAt, closesAt: call.closesAt, timezone: call.timezone, status: effectiveStatus(call),
    message: linkPlaceholderText(call, opens),
  });
}
