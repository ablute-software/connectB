// Prompt 924 (Etapa 4, I3) — the file an applicant attached to a contestation, for whoever has "Handle contestations": read by the server and streamed. There is no Storage link in the browser.
import { authCall } from '@/lib/calls/access';
import { contestationFile } from '@/lib/calls/contestations-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string; cid: string } }) {
  const auth = await authCall(params.id, { need: 'handle_contestations' });
  if (auth.error) return auth.error;
  const file = await contestationFile(auth.admin, auth.call, params.cid);
  if (!file) return new Response(JSON.stringify({ ok: false, error: 'There is no file.' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const safe = file.name.replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 120) || 'contestation.pdf';
  return new Response(new Uint8Array(file.bytes), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${safe}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
