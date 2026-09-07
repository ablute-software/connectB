// Prompt 871 §E — Nuno's decision (2026-09-06): overlay at read time, never
// write to `people`. This replaces Prompt 581's reverse-sync (removed in
// migration 0328 for the exact reason §E gives: writing the catalog's value
// into `people.<field>` makes it indistinguishable from the org's own
// declaration, and a later catalog correction never propagates once the
// field isn't empty). Nothing here ever writes — it only reads the
// catalog's CONFIRMED (verified_fields-gated) values for a linked person,
// through the founder's own RLS-scoped client. The existing
// catalog_people/catalog_people_research/catalog_person_affiliations read
// policies already gate this correctly (is_platform_admin() OR the org has
// the affiliated firm in catalog_deliveries) — the same boundary every
// other catalog-derived UI in this codebase uses, so an org only ever sees
// a suggestion for a firm actually in its own pipeline. An unverified
// research guess (no verified_fields entry) is never surfaced — that's the
// whole point of the quarantine this overlay reads through.
import type { SupabaseClient } from '@supabase/supabase-js';

export const CATALOG_OVERLAY_FIELDS = [
  'role', 'based_in', 'linkedin_url', 'background', 'hook', 'watch_outs', 'intro_path', 'email_guess', 'kill_words',
] as const;
export type CatalogOverlayField = typeof CATALOG_OVERLAY_FIELDS[number];
export type CatalogOverlay = Partial<Record<CatalogOverlayField, { value: unknown; level: string }>>;

function hasContent(value: unknown): boolean {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export async function fetchCatalogOverlay(sb: SupabaseClient, catalogPersonId: string): Promise<CatalogOverlay> {
  const [{ data: cp }, { data: research }, { data: primary }] = await Promise.all([
    sb.from('catalog_people').select('based_in, linkedin_url').eq('id', catalogPersonId).maybeSingle(),
    sb.from('catalog_people_research')
      .select('background, hook, watch_outs, intro_path, email_guess, kill_words, verified_fields')
      .eq('person_id', catalogPersonId).maybeSingle(),
    sb.from('catalog_person_affiliations').select('title').eq('person_id', catalogPersonId).eq('is_primary', true).maybeSingle(),
  ]);

  const verifiedFields = (research?.verified_fields ?? {}) as Record<string, string>;
  const overlay: CatalogOverlay = {};
  const consider = (field: CatalogOverlayField, value: unknown) => {
    const level = verifiedFields[field];
    if (level && hasContent(value)) overlay[field] = { value, level };
  };

  consider('role', primary?.title);
  consider('based_in', cp?.based_in);
  consider('linkedin_url', cp?.linkedin_url);
  if (research) {
    consider('background', research.background);
    consider('hook', research.hook);
    consider('watch_outs', research.watch_outs);
    consider('intro_path', research.intro_path);
    consider('email_guess', research.email_guess);
    consider('kill_words', research.kill_words);
  }
  return overlay;
}

// Only the fields the founder's own row leaves empty are worth suggesting —
// showing a suggestion next to a value the org already has would read as a
// correction, which this overlay explicitly is not.
export function overlayForEmptyFields<T extends Record<string, unknown>>(overlay: CatalogOverlay, person: T): CatalogOverlay {
  const out: CatalogOverlay = {};
  for (const field of CATALOG_OVERLAY_FIELDS) {
    const entry = overlay[field];
    if (!entry) continue;
    if (!hasContent(person[field])) out[field] = entry;
  }
  return out;
}
