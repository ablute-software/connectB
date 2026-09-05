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

// Prompt 580 §C — "X (Y)" is this codebase's own convention for "known as
// X, formerly/also Y" (this file's header names "MAZE (Mustard Seed MAZE)"
// as the motivating example) — but normalizeName's own parenthetical-strip
// step just discards Y, so a row named "MAZE (Mustard Seed MAZE)" and a
// separate real row actually named "Mustard Seed MAZE" never matched each
// other; the first only ever matched itself. Confirmed empirically before
// writing this fix: findDuplicateClusters returned zero clusters for that
// exact production pair. Y is extracted as its own name candidate so it is
// checked against every OTHER row's real name, same as any alias would be.
function extractParenthetical(name: string): string | null {
  return name.match(/\(([^)]+)\)/)?.[1] ?? null;
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

export type MatchReason = 'domain' | 'name' | 'alias';

// Prompt 580 §B.4/§B.1 — the atomic fact behind a cluster: this VALUE
// (a domain, a normalized name, or an alias's own text) is shared by these
// ids. A cluster is the transitive closure of these; the closure is what
// decides "is this worth reviewing", but the raw matches are what a human
// (or "Not duplicates") needs to act on a SPECIFIC link rather than the
// whole group. Confirmed against the 2026-08-13 production incident: btov
// Partners ended up with 5 wrong aliases and, from the OLD cluster shape,
// there was no way to see that each one was really its own weak, separate
// coincidence rather than one strong 4-way match.
export interface DupMatch {
  reason: MatchReason;
  value: string;
  ids: string[];
}

export interface DupCluster {
  ids: string[];
  reasons: MatchReason[];
  matches: DupMatch[];
  // Prompt 580 §B.4 — a group this size joined at least partly by alias is
  // exactly the shape of the incident this prompt exists because of (one
  // catalog_id collecting several unrelated firms' names as aliases,
  // chained transitively into what LOOKS like a single strong match).
  suspicious: boolean;
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
  // Prompt 580 §B.4 — name and alias values share ONE map for matching
  // (an alias's whole job is to match a DIFFERENT row's real name — Bynd's
  // alias "Busy Angels SCR" only means anything against another row named
  // that), tagged per-entry so attribution can still tell them apart. An
  // earlier draft of this fix put name and alias in separate maps to keep
  // attribution clean and, in doing so, broke matching itself: Start
  // Ventures' own real name and Nysnø's alias "Start Ventures" both
  // normalize to "start", but each map held only one id under that key —
  // one id is never a match, so the two never got unioned at all. Caught by
  // this file's own test (a cluster the fixture requires came back empty).
  const byValue = new Map<string, { id: string; viaAlias: boolean }[]>();

  for (const r of rows) {
    const d = normalizeDomain(r.website);
    if (d) byDomain.set(d, [...(byDomain.get(d) ?? []), r.id]);
    const n = normalizeName(r.name);
    if (n) byValue.set(n, [...(byValue.get(n) ?? []), { id: r.id, viaAlias: false }]);
    const paren = extractParenthetical(r.name);
    const pn = paren ? normalizeName(paren) : null;
    if (pn && pn !== n) byValue.set(pn, [...(byValue.get(pn) ?? []), { id: r.id, viaAlias: false }]);
  }
  for (const a of aliases) {
    const n = normalizeName(a.alias);
    if (n) byValue.set(n, [...(byValue.get(n) ?? []), { id: a.catalog_id, viaAlias: true }]);
  }

  for (const ids of byDomain.values()) {
    const uniq = [...new Set(ids)];
    for (let i = 1; i < uniq.length; i++) union(uniq[0], uniq[i]);
  }
  for (const entries of byValue.values()) {
    const uniqIds = [...new Set(entries.map((e) => e.id))];
    for (let i = 1; i < uniqIds.length; i++) union(uniqIds[0], uniqIds[i]);
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
    const reasons = new Set<MatchReason>();
    const matches: DupMatch[] = [];

    for (const [value, rawIds] of byDomain.entries()) {
      const uniq = [...new Set(rawIds)].filter((id) => idSet.has(id));
      if (uniq.length < 2) continue;
      reasons.add('domain');
      matches.push({ reason: 'domain', value, ids: uniq });
    }
    for (const [value, entries] of byValue.entries()) {
      const uniqIds = [...new Set(entries.map((e) => e.id))].filter((id) => idSet.has(id));
      if (uniqIds.length < 2) continue;
      // 'alias' whenever an alias was part of what tied these ids together
      // — that's the fact a reviewer needs, not which SIDE of the pair
      // happened to be the alias.
      const reason: MatchReason = entries.some((e) => e.viaAlias) ? 'alias' : 'name';
      reasons.add(reason);
      matches.push({ reason, value, ids: uniqIds });
    }

    const suspicious = reasons.has('alias') && ids.length > 3;
    clusters.push({ ids, reasons: [...reasons], matches, suspicious });
  }
  return clusters;
}
