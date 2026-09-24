// Prompt 729 §2.1 — the validate+scan+upload core shared between
// /api/matchdeal/photo/route.ts (Prompt 161 D / 305 §A) and
// /api/company/team-photo/route.ts, so a third upload route can never be
// added without the same real-content check and virus scan the first one
// already has. The existing matchdeal/photo route is left calling its own
// inline copy of this logic unchanged (it's stable and tested) — new
// callers use this instead of writing a fourth variant.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectAllowedKind, scanWithVirusTotal } from './upload-security';

export const TEN_YEAR_SIGNED_URL_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export type ImageUploadOutcome =
  | { ok: true; storagePath: string; bytes: Buffer }
  | { ok: false; error: string; status: number };

export async function validateAndUploadImage(
  admin: SupabaseClient, file: File, opts: { maxBytes: number; pathPrefix: string },
): Promise<ImageUploadOutcome> {
  if (!file.type.startsWith('image/')) return { ok: false, error: 'Only images are accepted.', status: 400 };
  if (file.size > opts.maxBytes) {
    return { ok: false, error: `File too large (${Math.round(opts.maxBytes / (1024 * 1024))}MB max).`, status: 400 };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // Prompt 305 §A's own reasoning, unchanged: no 'svg' in the allowlist —
  // a signed URL is a plain HTTPS link nothing stops someone opening
  // directly, where a top-level SVG document's embedded <script> would run.
  const kind = detectAllowedKind(bytes, file.name);
  if (!kind) {
    return {
      ok: false, status: 400,
      error: 'This image type isn’t allowed (jpg/png/webp/gif only — no SVG), or its content doesn’t match its extension.',
    };
  }
  const verdict = await scanWithVirusTotal(bytes);
  if (verdict.status === 'flagged') return { ok: false, error: `Upload blocked — ${verdict.detail}`, status: 400 };

  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const storagePath = `${opts.pathPrefix}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, bytes, { contentType: file.type || undefined });
  if (uploadError) return { ok: false, error: uploadError.message, status: 500 };
  return { ok: true, storagePath, bytes };
}

export async function signUploadedImage(
  admin: SupabaseClient, storagePath: string, ttlSeconds: number = TEN_YEAR_SIGNED_URL_TTL_SECONDS,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { data: signed, error } = await admin.storage.from('data-room').createSignedUrl(storagePath, ttlSeconds);
  if (error || !signed?.signedUrl) return { ok: false, error: error?.message ?? 'Could not create a link for the photo.' };
  return { ok: true, url: signed.signedUrl };
}
