// Prompt I-01 §C.1 — validation of the back-office incubator form. Pure, so
// the create and edit routes share one reading of the fields.
import { INCUBATOR_KINDS, slugifyIncubatorName, type IncubatorKind } from './incubators';

export interface IncubatorFields {
  name: string;
  slug: string;
  kind: IncubatorKind;
  legal_name: string | null;
  vat_id: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  logo_url: string | null;
  description: string | null;
  related_catalog_entity_id: string | null;
  is_test: boolean;
  is_internal: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export function parseIncubatorFields(body: Record<string, unknown>): { ok: true; fields: IncubatorFields } | { ok: false; error: string } {
  const name = text(body.name);
  if (!name) return { ok: false, error: 'O nome é obrigatório.' };
  const kind = (text(body.kind) ?? 'other') as IncubatorKind;
  if (!INCUBATOR_KINDS.some((k) => k.key === kind)) return { ok: false, error: 'Tipo inválido.' };
  const slug = slugifyIncubatorName(text(body.slug) ?? name);
  const related = text(body.related_catalog_entity_id);
  if (related && !UUID_RE.test(related)) return { ok: false, error: 'Entidade do catálogo inválida.' };
  return {
    ok: true,
    fields: {
      name, slug, kind,
      legal_name: text(body.legal_name),
      vat_id: text(body.vat_id),
      website: text(body.website),
      country: text(body.country),
      city: text(body.city),
      logo_url: text(body.logo_url),
      description: text(body.description),
      related_catalog_entity_id: related,
      is_test: body.is_test === true,
      is_internal: body.is_internal === true,
    },
  };
}
