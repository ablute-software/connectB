// BLOCO 3 catalog merge-duplicates tool. Pure functions, no I/O — matches
// the algorithm IRM_SPEC §9b-3 documents for import-time entity matching:
// normalized website domain, and normalized name (diacritics/legal-suffix/
// parenthetical-alias stripped) with known aliases folded in as extra names
// pointing at the same catalog row. "MAZE (Mustard Seed MAZE)" == "MAZE";
// "Bynd Venture Capital" == "Bynd" == "Busy Angels SCR" (former name, via
// an explicit alias row) are the motivating examples.
const LEGAL_SUFFIXES = /\b(inc|incorporated|ltd|llc|lda|sa|gmbh|scr|capital|ventures|partners|vc|fund|group|co)\b/g;

export function normalizeName(name: string): string {
  return name
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(withProto).hostname.replace(/^www\./, '').toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export interface CatalogRow {
  id: string;
  name: string;
  website: string | null;
}

export interface Alias {
  catalog_id: string;
  alias: string;
}

export interface DupCluster {
  ids: string[];
  reasons: ('domain' | 'name' | 'alias')[];
}

export function findDuplicateClusters(rows: CatalogRow[], aliases: Alias[]): DupCluster[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (const r of rows) find(r.id);

  const byDomain = new Map<string, string[]>();
  const byName = new Map<string, string[]>();

  for (const r of rows) {
    const d = normalizeDomain(r.website);
    if (d) byDomain.set(d, [...(byDomain.get(d) ?? []), r.id]);
    const n = normalizeName(r.name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), r.id]);
  }
  for (const a of aliases) {
    const n = normalizeName(a.alias);
    if (n) byName.set(n, [...(byName.get(n) ?? []), a.catalog_id]);
  }

  for (const ids of byDomain.values()) {
    const uniq = [...new Set(ids)];
    for (let i = 1; i < uniq.length; i++) union(uniq[0], uniq[i]);
  }
  for (const ids of byName.values()) {
    const uniq = [...new Set(ids)];
    for (let i = 1; i < uniq.length; i++) union(uniq[0], uniq[i]);
  }

  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    const root = find(r.id);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root)!.add(r.id);
  }

  const clusters: DupCluster[] = [];
  for (const idSet of groups.values()) {
    if (idSet.size < 2) continue;
    const ids = [...idSet];
    const reasons = new Set<'domain' | 'name' | 'alias'>();
    for (const group of byDomain.values()) if (group.some((id) => idSet.has(id)) && new Set(group).size > 1) reasons.add('domain');
    for (const group of byName.values()) if (group.some((id) => idSet.has(id)) && new Set(group).size > 1) reasons.add('name');
    if (aliases.some((a) => idSet.has(a.catalog_id))) reasons.add('alias');
    clusters.push({ ids, reasons: [...reasons] });
  }
  return clusters;
}
