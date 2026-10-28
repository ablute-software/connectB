// Prompt 922 (I3) — a document of the application, read INSIDE the platform: the frozen copy made at submission, streamed through this route (the bytes pass here; no Storage address ever reaches the browser, so
// there is no link to copy or forward). The evaluator needs the application assigned to them; an administrator any. When the evaluation is blind the file keeps its content but its name is masked.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { documentFor, gateFor } from '@/lib/calls/eval-store';

export const dynamic = 'force-dynamic';

const INLINE: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export async function GET(_req: Request, { params }: { params: { id: string; applicationId: string; fileId: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  const gate = await gateFor(auth, params.applicationId);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const doc = await documentFor(auth, gate, params.fileId);
  if (!doc) return NextResponse.json({ ok: false }, { status: 404 });
  const { data, error } = await auth.admin.storage.from('data-room').download(doc.frozenPath);
  if (error || !data) return NextResponse.json({ ok: false, error: 'The document could not be opened. Please try again.' }, { status: 404 });
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(doc.fileName)?.[1] ?? '').toLowerCase();
  const type = INLINE[ext];
  const name = encodeURIComponent(doc.fileName);
  return new Response(data.stream(), {
    status: 200,
    headers: {
      'content-type': type ?? 'application/octet-stream',
      'content-disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'",
    },
  });
}
