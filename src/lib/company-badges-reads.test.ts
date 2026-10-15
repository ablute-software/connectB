// Prompt 918 — nothing reads an UNVERIFIED badge except the founder's own screens. A badge Sherlock has not confirmed against a public source is
// the founder's private claim (Prompt 918, inverting 326 §E): it may not reach an investor's dossier, and it may not reach an AI prompt either,
// because what a prompt returns can become investor-visible (the startup-performance privacy rule: a prompt is a data flow, audited like a select).
// This walks the source: every read of company_badges is either the founder's own data (the routes under api/company-badges/, which are scoped to
// the caller's org and are the only ones that may see a private badge) or filters `.eq('verification_status', 'verified')` in the query itself,
// not after the fact. A new reader that forgets fails here, not in a review.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const norm = (p: string) => p.split(path.sep).join('/');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// The founder's own screens: scoped to the caller's org, and the only place a private badge is shown (to the founder).
const FOUNDER_OWN = ['app/api/company-badges/'];
// Checks the badge's state in code, right after the read, and refuses before anything is served (tested in badges-918-routes.test.ts).
const CHECKS_IN_CODE = ['app/api/portal/badge-logo/'];

interface Read { file: string; window: string }
const reads: Read[] = [];
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  for (const m of text.matchAll(/from\(\s*['"]company_badges['"]\s*\)/g)) {
    reads.push({ file: norm(path.relative(SRC, file)), window: text.slice(m.index!, m.index! + 900) });
  }
}

describe('every read of company_badges', () => {
  it('finds the readers it is supposed to guard (so this test cannot pass by looking at nothing)', () => {
    const files = new Set(reads.map((r) => r.file));
    for (const expected of [
      'lib/dossier-fetch.ts', 'app/api/network/update/suggest/route.ts', 'app/api/roadmap/suggest-events/route.ts',
      'app/api/company-badges/route.ts', 'app/api/portal/badge-logo/[badgeId]/route.ts',
    ]) expect(files.has(expected), expected).toBe(true);
  });

  for (const r of reads) {
    const own = FOUNDER_OWN.some((p) => r.file.startsWith(p));
    const inCode = CHECKS_IN_CODE.some((p) => r.file.startsWith(p));
    it(`${r.file} — ${own ? "the founder's own data" : inCode ? 'checks the state in code' : "filters .eq('verification_status', 'verified') in the query"}`, () => {
      if (own) return;
      if (inCode) {
        expect(r.window).toMatch(/verification_status\s*!==\s*'verified'/);
        return;
      }
      expect(r.window).toMatch(/\.eq\(\s*'verification_status'\s*,\s*'verified'\s*\)/);
    });
  }

  it('the investor-facing dossier selects none of the private columns, and projects through the one function that checks source and date', () => {
    const fetchSrc = readFileSync(path.join(SRC, 'lib/dossier-fetch.ts'), 'utf8');
    expect(fetchSrc).toContain('projectBadgesForInvestor(');
    const query = reads.find((r) => r.file === 'lib/dossier-fetch.ts')!.window;
    const selectList = /\.select\(\s*'([^']*)'/.exec(query)?.[1] ?? '';
    expect(selectList).toContain('verification_status');
    for (const privateColumn of ['verification_note', 'evidence_document_id', 'description', 'linked_claim_id', 'source_found_by']) {
      expect(selectList.split(',').map((c) => c.trim()), privateColumn).not.toContain(privateColumn);
    }
  });
});
