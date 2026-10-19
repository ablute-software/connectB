// Prompt 918 (Adenda 1, C) — the cover image and the logo of a call: what is accepted, where it lives, which logo a page shows, and the URLs. The cover and a logo uploaded FOR THE CALL are kept
// in the private `data-room` bucket and reached through the platform's own routes, which stream the bytes (no Storage address reaches the browser); without its own logo the page uses the logo of the entity's
// profile (the firm's or the incubator's) when it has one. Only PNG, JPG and WebP, up to 5 MB, the type checked on the bytes — never SVG (it can carry code) and never GIF.
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import type { Call } from './types';

import { MEDIA_MAX_BYTES, MEDIA_REFUSED_FORMAT, type MediaKind } from './media-limits';
export { MEDIA_ACCEPT, MEDIA_KINDS, MEDIA_MAX_BYTES, MEDIA_REFUSED_FORMAT, isMediaKind, type MediaKind } from './media-limits';
export const MEDIA_BUCKET = 'data-room';
const MEDIA_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;
type MediaFormat = keyof typeof MEDIA_TYPES;

export interface Branding {
  coverUrl: string | null;
  logoUrl: string | null;
  /** Where the logo comes from: uploaded for this call, or the entity's profile. */
  logoSource: 'call' | 'profile' | null;
}
export const NO_BRANDING: Branding = { coverUrl: null, logoUrl: null, logoSource: null };

const stamp = (iso: string | null | undefined): string => (iso ? String(Date.parse(iso) || 0) : '0');

/** Only an https address is an address we will show a logo from. */
export const httpsOrNull = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s<>"']{3,2000}$/i.test(v.trim()) ? v.trim() : null);

/** The logos of the entities' own profiles: firms (`matchdeal_profiles.entity_logo_url`, one of their active members' profile) and incubators (`incubators.logo_url`). Keyed `kind:id`. */
export async function profileLogos(admin: SupabaseClient, calls: Pick<Call, 'promoterKind' | 'promoterId'>[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const firms = [...new Set(calls.filter((c) => c.promoterKind === 'catalog_entity').map((c) => c.promoterId))];
  const incubators = [...new Set(calls.filter((c) => c.promoterKind === 'incubator').map((c) => c.promoterId))];
  if (incubators.length) {
    const { data } = await admin.from('incubators').select('id, logo_url').in('id', incubators);
    for (const r of (data ?? []) as { id: string; logo_url: string | null }[]) { const u = httpsOrNull(r.logo_url); if (u) out.set(`incubator:${r.id}`, u); }
  }
  if (firms.length) {
    const { data: members } = await admin.from('matchdeal_investor_members').select('id, catalog_entity_id').in('catalog_entity_id', firms).eq('status', 'active');
    const byMember = new Map(((members ?? []) as { id: string; catalog_entity_id: string }[]).map((m) => [m.id, m.catalog_entity_id]));
    if (byMember.size) {
      const { data: profiles } = await admin.from('matchdeal_profiles').select('membership_id, entity_logo_url').in('membership_id', [...byMember.keys()]);
      for (const p of (profiles ?? []) as { membership_id: string; entity_logo_url: string | null }[]) {
        const firm = byMember.get(p.membership_id); const u = httpsOrNull(p.entity_logo_url);
        if (firm && u && !out.has(`catalog_entity:${firm}`)) out.set(`catalog_entity:${firm}`, u);
      }
    }
  }
  return out;
}

/** Where an image of THIS call is reached: by the public link (any applicant) or, in the editor, through the signed-in route. */
export const mediaUrl = (call: Pick<Call, 'id' | 'linkToken'>, kind: MediaKind, version: string | null | undefined, via: 'public' | 'editor'): string =>
  via === 'public' && call.linkToken
    ? `/api/calls/public/${encodeURIComponent(call.linkToken)}/${kind}?v=${stamp(version)}`
    : `/api/calls/${call.id}/media?kind=${kind}&v=${stamp(version)}`;

/** The cover and the logo of several calls (one batch of lookups for all of them). */
export async function brandingOf(admin: SupabaseClient, calls: Call[], via: 'public' | 'editor'): Promise<Map<string, Branding>> {
  const needProfile = calls.filter((c) => !c.logoPath);
  const logos = needProfile.length ? await profileLogos(admin, needProfile) : new Map<string, string>();
  const out = new Map<string, Branding>();
  for (const c of calls) {
    const own = c.logoPath ? mediaUrl(c, 'logo', c.logoUpdatedAt, via) : null;
    const profile = own ? null : logos.get(`${c.promoterKind}:${c.promoterId}`) ?? null;
    out.set(c.id, {
      coverUrl: c.coverPath ? mediaUrl(c, 'cover', c.coverUpdatedAt, via) : null,
      logoUrl: own ?? profile, logoSource: own ? 'call' : profile ? 'profile' : null,
    });
  }
  return out;
}

export type MediaResult = { ok: true; path: string; format: MediaFormat; bytes: number; sha256: string } | { ok: false; error: string };

/**
 * Checks an image before it is kept: not empty, within 5 MB, a PNG, JPG or WebP BY ITS CONTENT (the extension must agree: a renamed file is refused), and not a known malicious file
 * (the same hash lookup every upload gets — the file itself never leaves the platform). Returns where to store it.
 */
export async function checkMedia(callId: string, kind: MediaKind, bytes: Buffer, fileName: string): Promise<MediaResult> {
  if (bytes.length === 0) return { ok: false, error: 'That file is empty.' };
  if (bytes.length > MEDIA_MAX_BYTES) return { ok: false, error: 'The image is too large (5 MB at most).' };
  const real = detectAllowedKind(bytes, fileName);
  if (real !== 'png' && real !== 'jpg' && real !== 'webp') return { ok: false, error: MEDIA_REFUSED_FORMAT };
  const verdict = await scanWithVirusTotal(bytes);
  if (verdict.status === 'flagged') return { ok: false, error: `Upload blocked: ${verdict.detail}` };
  const sha = sha256Hex(bytes);
  return { ok: true, path: `calls/${callId}/${kind}-${sha.slice(0, 12)}.${real}`, format: real, bytes: bytes.length, sha256: sha };
}

export const contentTypeOf = (path: string): string => MEDIA_TYPES[(path.split('.').pop() ?? '') as MediaFormat] ?? 'application/octet-stream';

