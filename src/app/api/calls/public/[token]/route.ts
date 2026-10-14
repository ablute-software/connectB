// Prompt 905 / 907 (I1) — what the link of a published call shows to ANYONE, signed in or not: the call's header (who promotes
// it, its name, the deadline with its time zone, the summary, the regulation PDF if the team made one public) and the
// state it is in for an applicant. Public on purpose (a candidate has no account yet), so it reveals nothing beyond the call's own
// header, and nothing at all while CALLS_MODE is "off", for a call that is not published, for an archived one, or for one with no form.
import { NextResponse } from 'next/server';
import { promoterName } from '@/lib/calls/store';
import { resolvePublicCall, serviceClient } from '@/lib/calls/applicant/link';
import { applicantPhase, phaseSentence } from '@/lib/calls/applicant/phase';
import { formatDayInZone } from '@/lib/calls/tz';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: false }, { status: 404 });
  const found = await resolvePublicCall(admin, params.token);
  if (!found) return NextResponse.json({ ok: false }, { status: 404 });
  const { call, fields } = found;

  // The regulation: only a PDF of kind "regulation" that the team marked "show to applicants".
  const { data: reg } = await admin.from('call_source_documents').select('id, file_name')
    .eq('call_id', call.id).eq('kind', 'regulation').eq('public_to_applicants', true).eq('mime_type', 'application/pdf')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();

  const phase = applicantPhase(call);
  return NextResponse.json({
    ok: true,
    name: call.name, description: call.description, promoter: await promoterName(admin, call.promoterKind, call.promoterId),
    opensAt: call.opensAt, closesAt: call.closesAt, timezone: call.timezone, status: phase,
    phase,
    // The sentence under the header while applications cannot be made ("Opens on …", "Applications closed on …"); null while they can.
    message: phaseSentence(call),
    opensDay: formatDayInZone(call.opensAt, call.timezone),
    closesDay: formatDayInZone(call.closesAt, call.timezone),
    // Eligibility rules are configured in a later stage (Etapa 2): there is nothing to put in sentences yet.
    eligibility: [] as string[],
    regulation: reg ? { fileName: (reg as { file_name: string }).file_name, url: `/api/calls/public/${encodeURIComponent(params.token)}/regulation` } : null,
    fieldCount: fields.length,
  });
}
