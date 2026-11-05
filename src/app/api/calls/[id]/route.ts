// Prompt 905 — one call: everything the editor needs (GET) and the General tab's autosave (PATCH).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { parseGeneralPatch } from '@/lib/calls/mappers';
import { bumpConfig, loadPromoterNames, promoterName, setCallDescription } from '@/lib/calls/store';
import { setCallLimit } from '@/lib/calls/call-limit';
import { nameClashBody } from '@/lib/calls/call-names';
import { buildCallState } from '@/lib/calls/state';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  return NextResponse.json(await buildCallState(auth.admin, auth.call, auth.promoter));
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  if (auth.call.status !== 'draft') {
    // After validation only the PRESENTATION may change — the description (the cover image and the logo have their own route). Nothing an applicant answers depends on it, so it is
    // not the configuration and does not move its version (Prompt 918, Adenda 1). Everything else stays locked.
    const keys = Object.keys(body).filter((k) => k !== 'baseVersion');
    if (keys.length > 0 && keys.every((k) => k === 'description') && auth.call.status !== 'archived') {
      const only = parseGeneralPatch({ description: body.description }, auth.call);
      if (!only.ok) return NextResponse.json({ ok: false, error: only.error }, { status: 400 });
      const updated = await setCallDescription(auth.admin, auth.call, only.patch.description ?? null);
      if (!updated) return NextResponse.json({ ok: false, error: 'We could not save the description. Please try again.' }, { status: 500 });
      return NextResponse.json(await buildCallState(auth.admin, updated, auth.promoter));
    }
    // Prompt 929 (A): the maximum number of applications and "show places left" stay editable once the call is open (raising the limit reopens a full call that is still within its dates).
    if (keys.length > 0 && keys.every((k) => k === 'description' || k === 'maxApplications' || k === 'showPlacesLeft') && auth.call.status !== 'archived') {
      const only = parseGeneralPatch(Object.fromEntries(keys.map((k) => [k, body[k]])), auth.call);
      if (!only.ok) return NextResponse.json({ ok: false, error: only.error }, { status: 400 });
      let updated = auth.call;
      if ('description' in only.patch) updated = (await setCallDescription(auth.admin, updated, only.patch.description ?? null)) ?? updated;
      if ('max_applications' in only.patch || 'show_places_left' in only.patch) {
        const limited = await setCallLimit(auth.admin, updated, { ...('max_applications' in only.patch ? { max_applications: only.patch.max_applications } : {}), ...('show_places_left' in only.patch ? { show_places_left: only.patch.show_places_left } : {}) }, await promoterName(auth.admin, auth.call.promoterKind, auth.call.promoterId));
        if (!limited) return NextResponse.json({ ok: false, error: 'We could not save it. Please try again.' }, { status: 500 });
        updated = limited;
      }
      return NextResponse.json(await buildCallState(auth.admin, updated, auth.promoter));
    }
    return NextResponse.json({ ok: false, code: 'locked', error: 'This call is validated. Use “Edit configuration” to change it.' }, { status: 409 });
  }
  const parsed = parseGeneralPatch(body, auth.call);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  // Prompt 927 (F): renaming never makes two calls of the organisation share a name (the call's own name, written again, is not a clash).
  if (typeof parsed.patch.name === 'string' && parsed.patch.name !== auth.call.name) {
    const clash = nameClashBody(await loadPromoterNames(auth.admin, auth.call.promoterKind, auth.call.promoterId), parsed.patch.name, auth.call.id);
    if (clash) return NextResponse.json({ ok: false, ...clash }, { status: 409 });
  }

  const baseVersion = Number(body.baseVersion);
  if (!Number.isInteger(baseVersion)) return NextResponse.json({ ok: false, error: 'Missing baseVersion.' }, { status: 400 });
  const updated = await bumpConfig(auth.admin, auth.call, baseVersion, parsed.patch as Record<string, unknown>);
  if (!updated) {
    return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed this call. Reload to see their changes.', current: auth.call.configVersion }, { status: 409 });
  }
  return NextResponse.json(await buildCallState(auth.admin, updated, auth.promoter));
}
