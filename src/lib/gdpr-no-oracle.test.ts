import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 626 §C, as a test rather than a comment, because the thing it forbids
// is the thing a well-meaning person builds next.
//
// "Nenhuma pesquisa por nome. 'Estou na vossa base?' transforma o catálogo num
// oráculo — qualquer pessoa passa a poder confirmar se um nome lá está. Isso é
// uma fuga com aspecto de transparência."
//
// The public form DOES look the claimant up — it has to, or the reviewer would
// start from nothing. The rule is not "do not look"; it is "do not tell". So
// what this checks is the one place the difference becomes observable: the
// response. If the intake route ever returns whether a record was found — a
// count, a name, a boolean, a 404 on no match — then the form has become a
// name search reached through a different door, and anybody can query it.
//
// Deliberately a source-level check. The behaviour is a NEGATIVE ("this value
// never leaves"), and a runtime test can only sample the inputs it thought of;
// somebody adding `found: !!match` would pass every runtime test written
// today.
const INTAKE = join('src', 'app', 'api', 'gdpr', 'request', 'route.ts');

describe('the public rights form is not a name search (Prompt 626 §C)', () => {
  const source = readFileSync(INTAKE, 'utf8');

  it('resolves the claimant against people, because the reviewer needs a starting point', () => {
    // Guards the other half: if this lookup ever disappears, the test below
    // would pass vacuously and stop meaning anything.
    expect(source).toContain("from('people')");
  });

  it('never puts the result of that lookup in the response', () => {
    // Every `return NextResponse.json(...)` in the file, flattened.
    const responses = [...source.matchAll(/NextResponse\.json\(([\s\S]*?)\)\s*[;,]/g)].map((m) => m[1]);
    expect(responses.length).toBeGreaterThan(0);
    for (const body of responses) {
      expect(body).not.toMatch(/\bmatch\b/);
      expect(body).not.toMatch(/\bperson_id\b/);
      expect(body).not.toMatch(/\bfound\b/);
    }
  });

  it('does not branch its status code on whether a record exists', () => {
    // A 404 for "no match" leaks the same bit as a body field would, and is
    // easier to reach for than it looks: `if (!match) return ... 404` reads
    // like ordinary defensive code.
    expect(source).not.toMatch(/if\s*\(\s*!\s*match[\s\S]{0,120}?status:\s*404/);
  });

  it('accepts the request whether or not anything matched', () => {
    // The insert uses `match?.id ?? null` — a null person_id is a normal row,
    // not an error. If this ever becomes a hard requirement, the form starts
    // rejecting exactly the people it exists for.
    expect(source).toContain('match?.id ?? null');
  });
});
