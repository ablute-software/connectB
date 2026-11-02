// Prompt 930 (B) — ONE way to hand a document of a submitted application to the browser: the frozen copy made at submission, STREAMED through the platform (the bytes pass through our route; no Storage address ever
// reaches the browser, so there is nothing to copy, forward or keep). A PDF or an image is sent inline (the in-platform viewer shows it in a frame); anything else — Office files, html, svg… — is a forced download, never
// rendered in the platform's own origin. Used by the Applications screen and by the evaluator's screen, so they cannot drift apart. Who may open what is decided by the routes (the call's permissions), and every opening is
// recorded: who, which document, when ("who opened what", as in the data room).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

const INLINE: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export type Streamed = { ok: true; response: Response } | { ok: false; status: number; error: string };

export async function streamFrozenDocument(admin: SupabaseClient, frozenPath: string, fileName: string): Promise<Streamed> {
  const { data, error } = await admin.storage.from('data-room').download(frozenPath);
  if (error || !data) return { ok: false, status: 404, error: 'The document could not be opened. Please try again.' };
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1] ?? '').toLowerCase();
  const type = INLINE[ext];
  return {
    ok: true,
    response: new Response(data.stream(), {
      status: 200,
      headers: {
        'content-type': type ?? 'application/octet-stream',
        'content-disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
        'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'",
      },
    }),
  };
}

/** "Who opened what": one event per opening. The name of the file is not written (in a blind evaluation it is masked, and the id says which one); a failure to record never stops the document from opening. */
export async function logDocumentOpened(admin: SupabaseClient, callId: string, applicationId: string, actor: string, fileId: string, where: 'applications' | 'evaluation'): Promise<void> {
  try { await admin.from('call_events').insert({ call_id: callId, application_id: applicationId, event: 'document_opened', actor_user_id: actor, detail: { fileId, where } }); }
  catch (e) { console.error('[calls] could not record a document opening:', (e as Error).message); }
}
