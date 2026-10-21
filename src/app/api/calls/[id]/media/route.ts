// Prompt 918 (Adenda 1, C) — the cover image and the logo of a call, from the General step. Whoever may "Configure call" can set or remove them, in any state except archived (they
// are the page's face, not its configuration: nothing an applicant answers depends on them).
//   GET    ?kind=cover|logo   the image of THIS call (the editor's preview), served by this route
//   POST   multipart { kind, file, saveToProfile? }   PNG, JPG or WebP, up to 5 MB, type checked on the bytes, hash-scanned like every upload; never SVG
//   DELETE ?kind=cover|logo
// `saveToProfile` (logo only, and only after the person confirmed it) also keeps the logo as the entity's own profile logo when the profile has none.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { MEDIA_BUCKET, checkMedia, isMediaKind, type MediaKind } from '@/lib/calls/branding';
import { streamStorageObject } from '@/lib/document-proxy';
import { saveLogoToProfile } from '@/lib/calls/branding-profile';
import { logMediaFailure } from '@/lib/calls/media-log';
import { logCallEvent, setCallMedia } from '@/lib/calls/store';
import { buildCallState } from '@/lib/calls/state';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const kindOf = (req: Request): MediaKind | null => { const k = new URL(req.url).searchParams.get('kind'); return isMediaKind(k) ? k : null; };

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  const kind = kindOf(req);
  if (!kind) return NextResponse.json({ ok: false, error: 'Unknown image.' }, { status: 400 });
  const path = kind === 'cover' ? auth.call.coverPath : auth.call.logoPath;
  if (!path) return NextResponse.json({ ok: false }, { status: 404 });
  return streamStorageObject({ admin: auth.admin, storagePath: path, filename: `${kind}.${path.split('.').pop() ?? 'png'}`, req, onFailure: logMediaFailure({ where: 'editor', kind, callId: auth.call.id, path }) });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (auth.call.status === 'archived') return NextResponse.json({ ok: false, error: 'An archived call cannot be changed.' }, { status: 409 });
  const form = await req.formData().catch(() => null);
  const kind = form?.get('kind');
  const file = form?.get('file');
  if (!isMediaKind(kind) || !(file instanceof File)) return NextResponse.json({ ok: false, error: 'Choose an image to upload.' }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const checked = await checkMedia(auth.call.id, kind, bytes, file.name);
  if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });

  const old = kind === 'cover' ? auth.call.coverPath : auth.call.logoPath;
  const up = await auth.admin.storage.from(MEDIA_BUCKET).upload(checked.path, bytes, { contentType: file.type || undefined, upsert: true });
  if (up.error) return NextResponse.json({ ok: false, error: 'We could not save the image. Please try again.' }, { status: 500 });
  const updated = await setCallMedia(auth.admin, auth.call, kind, checked.path);
  if (!updated) { await auth.admin.storage.from(MEDIA_BUCKET).remove([checked.path]); return NextResponse.json({ ok: false, error: 'We could not save the image. Please try again.' }, { status: 500 }); }
  if (old && old !== checked.path) await auth.admin.storage.from(MEDIA_BUCKET).remove([old]);
  await logCallEvent(auth.admin, auth.call.id, kind === 'cover' ? 'call_cover_set' : 'call_logo_set', auth.userId, { format: checked.format, bytes: checked.bytes });

  let profile: 'saved' | 'already_has_one' | 'not_possible' | null = null;
  if (kind === 'logo' && form?.get('saveToProfile') === 'true') {
    profile = await saveLogoToProfile(auth.admin, updated, auth.userId, checked.path);
    if (profile === 'saved') await logCallEvent(auth.admin, auth.call.id, 'call_logo_saved_to_profile', auth.userId, {});
  }
  return NextResponse.json({ ...(await buildCallState(auth.admin, updated, auth.promoter)), profile });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const kind = kindOf(req);
  if (!kind) return NextResponse.json({ ok: false, error: 'Unknown image.' }, { status: 400 });
  const old = kind === 'cover' ? auth.call.coverPath : auth.call.logoPath;
  const updated = await setCallMedia(auth.admin, auth.call, kind, null);
  if (!updated) return NextResponse.json({ ok: false, error: 'We could not remove the image. Please try again.' }, { status: 500 });
  if (old) await auth.admin.storage.from(MEDIA_BUCKET).remove([old]);
  await logCallEvent(auth.admin, auth.call.id, kind === 'cover' ? 'call_cover_removed' : 'call_logo_removed', auth.userId, {});
  return NextResponse.json(await buildCallState(auth.admin, updated, auth.promoter));
}
