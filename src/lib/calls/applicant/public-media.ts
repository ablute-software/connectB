// Prompt 918 (Adenda 1, C) — what the link of a published call serves as its cover and logo. Exactly the rules of the rest of the public page: a call that is not published, is archived, has
// no form or sits behind a Calls switch that is off answers 404 and reveals nothing. The bytes are served BY THIS ROUTE (streamStorageObject): no Storage address ever reaches the browser.
import { NextResponse } from 'next/server';
import { streamStorageObject } from '@/lib/document-proxy';
import type { MediaKind } from '../media-limits';
import { logMediaFailure } from '../media-log';
import { resolvePublicCall, serviceClient } from './link';

export async function publicMedia(req: Request, token: string, kind: MediaKind): Promise<Response> {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: false }, { status: 404 });
  const found = await resolvePublicCall(admin, token);
  if (!found) return NextResponse.json({ ok: false }, { status: 404 });
  const path = kind === 'cover' ? found.call.coverPath : found.call.logoPath;
  if (!path) return NextResponse.json({ ok: false }, { status: 404 });
  return streamStorageObject({ admin, storagePath: path, filename: `${kind}.${path.split('.').pop() ?? 'png'}`, req, onFailure: logMediaFailure({ where: 'public', kind, callId: found.call.id, path }) });
}
