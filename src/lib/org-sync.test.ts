// Prompt 906 §A — the pieces that make "saved" reach the whole page: the `org:changed` event, the rule for
// adopting what the server stored, and the wiring that keeps every server-derived banner subscribed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORG_CHANGED_EVENT, announceOrgChanged, newOrgSaveTracker, orgFieldsToAdopt, sameStoredValue, saveOrgPatch, subscribeOrgChanged,
  type OrgSaveDeps,
} from '@/lib/org-sync';

afterEach(() => { vi.unstubAllGlobals(); });

describe('org:changed', () => {
  it('reaches every subscriber once per announcement, and stops after unsubscribe', () => {
    vi.stubGlobal('window', new EventTarget());
    const a = vi.fn(); const b = vi.fn();
    const offA = subscribeOrgChanged(a);
    subscribeOrgChanged(b);
    announceOrgChanged();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    announceOrgChanged();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('is the event name the prompt asked for', () => {
    expect(ORG_CHANGED_EVENT).toBe('org:changed');
  });

  it('does nothing on the server (no window): announce and subscribe are safe no-ops', () => {
    expect(() => announceOrgChanged()).not.toThrow();
    const off = subscribeOrgChanged(() => { throw new Error('must not be called'); });
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});

describe('sameStoredValue — same content, any representation', () => {
  it('a database null and the store\'s undefined are the same "empty"', () => {
    expect(sameStoredValue(null, undefined)).toBe(true);
    expect(sameStoredValue(undefined, null)).toBe(true);
    expect(sameStoredValue(null, 0)).toBe(false);
    expect(sameStoredValue(undefined, '')).toBe(false);
  });

  it('PostgREST returns numeric columns as strings: 0 and "0", 250000 and "250000" are the same value', () => {
    expect(sameStoredValue(0, '0')).toBe(true);
    expect(sameStoredValue(250000, '250000')).toBe(true);
    expect(sameStoredValue(250000, '250001')).toBe(false);
  });

  it('arrays compare element by element, in order', () => {
    expect(sameStoredValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameStoredValue(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameStoredValue([], [])).toBe(true);
    expect(sameStoredValue(['a'], 'a')).toBe(false);
  });
});

describe('orgFieldsToAdopt — what the database holds differently from what was typed', () => {
  it('is empty in the normal case: nothing to commit, nothing to re-render', () => {
    const local = { website: 'https://x.test', revenue_eur: 0, founded_year: 2019, sectors: ['AgriTech & FoodTech'] };
    const stored = { website: 'https://x.test', revenue_eur: '0', founded_year: 2019, sectors: ['AgriTech & FoodTech'] };
    expect(orgFieldsToAdopt(local, stored, Object.keys(local))).toEqual({});
  });

  it('adopts the stored value when the server changed or refused it, and turns a null into undefined', () => {
    const local = { website: 'x.test', one_liner: 'typed', stage: 'seed' };
    const stored = { website: 'https://x.test', one_liner: null, stage: 'seed' };
    expect(orgFieldsToAdopt(local, stored, ['website', 'one_liner', 'stage'])).toEqual({ website: 'https://x.test', one_liner: undefined });
  });

  it('only looks at the fields it was asked about: a newer edit of another field is never touched', () => {
    const local = { website: 'newer', one_liner: 'newer' };
    const stored = { website: 'older', one_liner: 'older' };
    expect(orgFieldsToAdopt(local, stored, ['website'])).toEqual({ website: 'older' });
  });

  it('a field the server did not return at all counts as empty — it did not store it', () => {
    expect(orgFieldsToAdopt({ intro_problem: 'typed' }, {}, ['intro_problem'])).toEqual({ intro_problem: undefined });
  });
});

// ─── the save, as one protocol ──────────────────────────────────────────────────
type Answer = Awaited<ReturnType<OrgSaveDeps['post']>>;

function saveHarness(local: Record<string, unknown> = {}) {
  const log: string[] = [];
  const org = { ...local };
  const pending: { body: string; resolve: (a: Answer) => void; reject: (e: unknown) => void }[] = [];
  const tracker = newOrgSaveTracker();
  const deps: OrgSaveDeps = {
    post: (body) => new Promise<Answer>((resolve, reject) => { log.push('post'); pending.push({ body, resolve, reject }); }),
    getLocalOrg: () => org,
    adopt: (fields) => { log.push('adopt ' + JSON.stringify(fields)); Object.assign(org, fields); },
    announce: () => { log.push('announce'); },
    onError: (e) => { log.push('error ' + String(e)); },
  };
  return { log, org, pending, tracker, deps, save: (patch: Record<string, unknown>) => saveOrgPatch(patch, tracker, deps) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('saveOrgPatch — what happens after the optimistic commit', () => {
  it('announces once the server said ok, and not a moment before', async () => {
    const t = saveHarness({ website: 'https://x.test' });
    const done = t.save({ website: 'https://x.test' });
    await tick();
    expect(t.log).toEqual(['post']); // sent, nothing announced yet
    t.pending[0].resolve({ ok: true, org: { website: 'https://x.test' } });
    await done;
    expect(t.log).toEqual(['post', 'announce']);
  });

  it('adopts what the database stored differently, and does it BEFORE announcing', async () => {
    const t = saveHarness({ website: 'x.test', one_liner: 'typed' });
    const done = t.save({ website: 'x.test', one_liner: 'typed' });
    t.pending[0].resolve({ ok: true, org: { website: 'https://x.test', one_liner: 'typed' } });
    await done;
    expect(t.log).toEqual(['post', 'adopt {"website":"https://x.test"}', 'announce']);
    expect(t.org.website).toBe('https://x.test');
  });

  it('a save the server refused announces nothing and adopts nothing (the old behaviour: log it)', async () => {
    const t = saveHarness({ website: 'x' });
    const done = t.save({ website: 'x' });
    t.pending[0].resolve({ ok: false, error: 'Your role can’t edit organisation settings.' });
    await done;
    expect(t.log).toEqual(['post', 'error Your role can’t edit organisation settings.']);
  });

  it('a request that fails outright (offline, 500 page) announces nothing', async () => {
    const t = saveHarness();
    const done = t.save({ stage: 'seed' });
    t.pending[0].reject(new Error('network down'));
    await done;
    expect(t.log).toEqual(['post', 'error Error: network down']);
  });

  it('an ok answer without an org still announces (nothing to compare, but the write landed)', async () => {
    const t = saveHarness();
    const done = t.save({ stage: 'seed' });
    t.pending[0].resolve({ ok: true });
    await done;
    expect(t.log).toEqual(['post', 'announce']);
  });

  it('fields the form cleared (undefined) are not sent, and not owned: JSON drops them', async () => {
    const t = saveHarness();
    const done = t.save({ website: undefined, stage: 'seed' });
    expect(JSON.parse(t.pending[0].body)).toEqual({ stage: 'seed' });
    expect(t.tracker.lastWriter).toEqual({ stage: 1 });
    t.pending[0].resolve({ ok: true, org: { stage: 'seed' } });
    await done;
  });

  it('two saves in flight, the older answer arriving last, must not roll back the newer edit', async () => {
    const t = saveHarness();
    t.org.website = 'b'; // the optimistic copy after the SECOND edit
    const first = t.save({ website: 'a' });
    const second = t.save({ website: 'b' });
    t.pending[1].resolve({ ok: true, org: { website: 'b' } });
    await second;
    t.pending[0].resolve({ ok: true, org: { website: 'a' } }); // stale: it describes the first save
    await first;
    expect(t.org.website).toBe('b');
    expect(t.log.filter((l) => l.startsWith('adopt'))).toEqual([]);
    expect(t.log.filter((l) => l === 'announce')).toHaveLength(2);
  });

  it('...but the older save still owns the fields the newer one did not touch', async () => {
    const t = saveHarness({ website: 'x.test', one_liner: 'y' });
    const first = t.save({ website: 'x.test' });
    const second = t.save({ one_liner: 'y' });
    t.pending[1].resolve({ ok: true, org: { one_liner: 'y' } });
    await second;
    t.pending[0].resolve({ ok: true, org: { website: 'https://x.test' } });
    await first;
    expect(t.org.website).toBe('https://x.test');
  });
});

// ─── wiring ──────────────────────────────────────────────────────────────────
// The repo has no DOM test environment (no jsdom / testing-library), so what a component DOES on `org:changed`
// is proved in a browser (Prompt 906 report, screenshots); what stays checkable here is that nobody quietly
// removes the wiring, and that no NEW reader of the server-derived visibility state repeats the 07/10 bug.
const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

describe('the wiring that keeps the banner honest', () => {
  it('the Supabase store saves through saveOrgPatch and announces through it; the demo store announces itself', () => {
    const supa = read('lib/store-supabase.tsx');
    expect(supa).toMatch(/void saveOrgPatch\(patch as Record<string, unknown>, orgSavesRef\.current, \{[\s\S]*?announce: announceOrgChanged,/);
    // the old fire-and-forget fetch (which threw the answer away) must not come back next to it
    expect(supa).not.toMatch(/fetch\('\/api\/org\/update', \{[^}]*\}\)\.then\(\(r\) => r\.json\(\)\)\.then\(\(b\) =>/);
    // (after the commit has rendered, not synchronously: a listener that asks for the org must find the new one)
    expect(read('lib/store-demo.tsx')).toMatch(/updateOrg\(patch\)\s*\{[\s\S]*?setTimeout\(announceOrgChanged, 0\)/);
  });

  it('removing a person announces too (the database nulls orgs.primary_contact_person_id, which the gate reads)', () => {
    expect(read('lib/store-supabase.tsx')).toMatch(/'removeCompanyPerson', announceOrgChanged\)/);
  });

  it('every client component that reads /api/company/visibility for the startup subscribes to org:changed', () => {
    const readers = walk(SRC)
      .filter((f) => /\.tsx$/.test(f))
      .filter((f) => /fetch\(\s*[`'"]\/api\/company\/visibility\?kind=/.test(readFileSync(f, 'utf8')));
    expect(readers.map((f) => path.basename(f)).sort()).toEqual(['MatchDealVisibilityBanner.tsx', 'VisibilityToggle.tsx']);
    for (const f of readers) expect(readFileSync(f, 'utf8'), path.basename(f)).toContain('subscribeOrgChanged');
  });

  it('and answers that come back out of order cannot overwrite a newer one', () => {
    for (const rel of ['components/VisibilityToggle.tsx', 'components/dashboard/MatchDealVisibilityBanner.tsx']) {
      expect(read(rel), rel).toContain('latestLoad');
    }
  });
});
