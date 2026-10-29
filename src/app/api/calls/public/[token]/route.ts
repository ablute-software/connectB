// Prompt 905 / 907 (I1) — what the link of a published call shows to ANYONE, signed in or not: the call's header (who promotes
// it, its name, the deadline with its time zone, the summary, the regulation PDF if the team made one public) and the
// state it is in for an applicant. Public on purpose (a candidate has no account yet), so it reveals nothing beyond the call's own
// header, and nothing at all while CALLS_MODE is "off", for a call that is not published, for an archived one, or for one with no form. A deleted call answers 410.
import { NextResponse } from 'next/server';
import { isDeletedLink, promoterName } from '@/lib/calls/store';
import { callsMode } from '@/lib/calls/mode';
import { closedBeforeDeadline } from '@/lib/calls/closing';
import { brandingOf } from '@/lib/calls/branding';
import { resolvePublicCall, serviceClient } from '@/lib/calls/applicant/link';
import { applicantPhase, phaseSentence } from '@/lib/calls/applicant/phase';
import { formatDayInZone } from '@/lib/calls/tz';
import { loadSettings } from '@/lib/calls/results-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: false }, { status: 404 });
  const found = await resolvePublicCall(admin, params.token);
  if (!found) {
    // A call that was DELETED (Prompt 918, Adenda 2, C) says so — "This call is no longer available" — rather than looking like a wrong link: its owner closed it on purpose.
    if (callsMode() !== 'off' && (await isDeletedLink(admin, params.token))) return NextResponse.json({ ok: false, gone: true }, { status: 410 });
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const { call, fields } = found;

  // The regulation: only a PDF of kind "regulation" that the team marked "show to applicants".
  const { data: reg } = await admin.from('call_source_documents').select('id, file_name')
    .eq('call_id', call.id).eq('kind', 'regulation').eq('public_to_applicants', true).eq('mime_type', 'application/pdf')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();

  const phase = applicantPhase(call);
  const branding = (await brandingOf(admin, [call], 'public')).get(call.id)!;
  return NextResponse.json({
    ok: true,
    name: call.name, description: call.description, promoter: await promoterName(admin, call.promoterKind, call.promoterId),
    opensAt: call.opensAt, closesAt: call.closesAt, timezone: call.timezone, status: phase, retentionMonths: (await loadSettings(admin, call.id)).retentionMonths,
    phase,
    // The sentence under the header while applications cannot be made ("Opens on …", "Applications closed on …"); null while they can.
    message: phaseSentence(call),
    opensDay: formatDayInZone(call.opensAt, call.timezone),
    closesDay: formatDayInZone(call.closesAt, call.timezone),
    // When it really closed, if that was before its deadline (Prompt 918, Adenda 3): the entry page shows it instead of a deadline still to come.
    closedAt: phase === 'closed' && closedBeforeDeadline(call) ? call.closedAt : null,
    closedDay: phase === 'closed' && closedBeforeDeadline(call) ? formatDayInZone(call.closedAt, call.timezone) : null,
    // Eligibility rules are configured in a later stage (Etapa 2): there is nothing to put in sentences yet.
    eligibility: [] as string[],
    // The entry page (Prompt 918, Adenda 1 C): a cover (or none), and the entity's logo — uploaded for the call, else the entity's own profile logo.
    coverUrl: branding.coverUrl, logoUrl: branding.logoUrl,
    regulation: reg ? { fileName: (reg as { file_name: string }).file_name, url: `/api/calls/public/${encodeURIComponent(params.token)}/regulation` } : null,
    fieldCount: fields.length,
  });
}
