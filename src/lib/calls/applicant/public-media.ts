// Prompt 918 (Adenda 1, C) — what the link of a published call serves as its cover and logo. Exactly the rules of the rest of the public page: a call that is not published, is archived, has
// no form or sits behind a Calls switch that is off answers 404 and reveals nothing.
import { NextResponse } from 'next/server';
import { signedMediaUrl, type MediaKind } from '../branding';
import { resolvePublicCall, serviceClient } from './link';

export async function publicMedia(token: string, kind: MediaKind): Promise<Response> {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: false }, { status: 404 });
  const found = await resolvePublicCall(admin, token);
  if (!found) return NextResponse.json({ ok: false }, { status: 404 });
  const url = await signedMediaUrl(admin, kind === 'cover' ? found.call.coverPath : found.call.logoPath);
  if (!url) return NextResponse.json({ ok: false }, { status: 404 });
  const res = NextResponse.redirect(url, 302);
  res.headers.set('Cache-Control', 'public, max-age=60');
  return res;
}
