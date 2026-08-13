import { describe, expect, it } from 'vitest';
import { findLikelyCatalogMatch } from './manual-entity-match';

const CATALOG = [
  { id: 'cat-1', name: 'Bynd Venture Capital', website: 'https://bynd.vc' },
  { id: 'cat-2', name: 'Nina Capital', website: 'https://ninacapital.vc' },
];
const ALIASES = [{ catalog_id: 'cat-1', alias: 'Busy Angels SCR' }];

describe('findLikelyCatalogMatch', () => {
  it('matches by normalized website domain (highest priority)', () => {
    const match = findLikelyCatalogMatch({ name: 'Bynd VC (Porto)', website: 'https://www.bynd.vc/team' }, CATALOG, ALIASES);
    expect(match).toEqual({ catalogId: 'cat-1', reason: 'domain' });
  });

  it('matches by normalized name when domains differ or are absent', () => {
    const match = findLikelyCatalogMatch({ name: 'Nina Capital', website: null }, CATALOG, ALIASES);
    expect(match).toEqual({ catalogId: 'cat-2', reason: 'name' });
  });

  it('matches by a known alias (a former/alternate name)', () => {
    const match = findLikelyCatalogMatch({ name: 'Busy Angels SCR', website: 'https://different-domain.example' }, CATALOG, ALIASES);
    expect(match).toEqual({ catalogId: 'cat-1', reason: 'alias' });
  });

  it('returns null when nothing matches', () => {
    const match = findLikelyCatalogMatch({ name: 'Totally New Investor', website: 'https://new-investor.example' }, CATALOG, ALIASES);
    expect(match).toBeNull();
  });

  it('prefers a domain match over a coincidental name match', () => {
    // Deliberately conflicting: matches cat-2's domain but cat-1's alias.
    const match = findLikelyCatalogMatch({ name: 'Busy Angels SCR', website: 'https://ninacapital.vc' }, CATALOG, ALIASES);
    expect(match).toEqual({ catalogId: 'cat-2', reason: 'domain' });
  });
});
