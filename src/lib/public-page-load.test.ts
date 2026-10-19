// Prompt 920 addendum (19/10/2026) — what the browser of an ANONYMOUS visitor to a public page loads and prints.
//
// Lighthouse on production found three things that no test could see, because they are not in any page's markup but in what the page's
// layout and shell do around it: a render-blocking stylesheet from fonts.googleapis.com on every page (~0.9 s of blocking on mobile), a
// "Failed to load resource: 401" in the console of every public page (the Shell's nav badge asking for the visitor's support tickets), and
// two more calls that were each a 307 to /login that fetch follows and downloads as a whole HTML page. These tests pin the fix at its
// source; the end-to-end proof (a browser, an auth-enabled build, the list of requests) is in docs/screenshots-920/.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A React with no renderer: useState hands back its initial value and useEffect only RECORDS the effect, so a test can run it (or not) by hand.
// That is all these hooks need — and it lets a plain node test see whether a hook would have fetched.
const effects: Array<() => void | (() => void)> = [];
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const stub = { ...actual, useState: (init: unknown) => [init, () => {}], useEffect: (fn: () => void | (() => void)) => { effects.push(fn); } };
  return { ...stub, default: stub };
});

import { useSupportUnreadCount } from '@/components/SupportTicketsPanel';
import { useUnreadMessagesCount } from '@/components/deal-messages/DealThreadView';
import { usePendingInterestCount, useInterestRequests } from '@/lib/interest-requests-client';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const srcFiles = (dir = 'src'): string[] => readdirSync(join(ROOT, dir)).flatMap((e) => {
  const rel = join(dir, e);
  if (statSync(join(ROOT, rel)).isDirectory()) return srcFiles(rel);
  return /\.(ts|tsx|css)$/.test(e) ? [rel] : [];
});

describe('fonts: self-hosted by next/font, named once', () => {
  const layout = read('src/app/layout.tsx');

  it('the root layout loads Comfortaa and Inter through next/font and no longer links to Google Fonts', () => {
    const code = layout.replace(/^\s*\/\/.*$/gm, ''); // the layout\'s own comments explain what used to be there
    expect(code).toMatch(/from 'next\/font\/google'/);
    expect(code).toMatch(/Comfortaa\(\{[\s\S]*?variable: '--font-comfortaa'/);
    expect(code).toMatch(/Inter\(\{[\s\S]*?variable: '--font-inter'/);
    expect(code).not.toMatch(/<link[^>]*fonts\.googleapis\.com/);
    expect(code).not.toContain('<head');
  });

  it('the generated Arial fallback is off: it changed the glyph of every "←"/symbol the face lacks (1363 pixels on /contact; 1 with it off) — the stack stays the old one', () => {
    const code = layout.replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/adjustFontFallback: false/g) ?? []).toHaveLength(2); // Inter and Comfortaa
    expect(code).toContain("fontFamily: 'var(--font-inter), system-ui, sans-serif'");
  });

  it('both variables are on <html>, where every page, the Shell, the auth screens and the back office inherit them — and the body reads one of them', () => {
    expect(layout).toMatch(/<html lang="en" className=\{`\$\{inter\.variable\} \$\{comfortaa\.variable\}`\}>/);
    expect(layout).toContain("fontFamily: 'var(--font-inter), system-ui, sans-serif'");
  });

  // The next two tests read every file under src/. In a full run (400+ test files in parallel, other sessions busy on the same machine) the default
  // 5 s per test was exceeded on 19/10/2026 — four scanning tests timed out together and all passed alone in 3 s — so these two say how long a scan may take.
  it('no other file names the two families: a literal would silently fall back to the system font, with no error and no failing page', { timeout: 30_000 }, () => {
    const offenders = srcFiles().filter((f) => f !== join('src', 'app', 'layout.tsx') && !/\.test\.tsx?$/.test(f)).filter((f) => /Comfortaa|fonts\.googleapis\.com\/css2\?family=Inter/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('every place that uses the brand family reads the variable (the 20 that wrote the literal stack)', { timeout: 30_000 }, () => {
    const users = srcFiles().filter((f) => !/\.test\.tsx?$/.test(f)).filter((f) => read(f).includes('var(--font-comfortaa)'));
    expect(users.length).toBeGreaterThanOrEqual(15);
    for (const f of users) expect(read(f)).toContain('var(--font-comfortaa), var(--font-inter), sans-serif');
  });
});

describe('the Shell\'s nav badges do not fetch for a visitor who has no nav', () => {
  const fetchMock = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, tickets: [], threads: [], requests: [] }) }));
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  beforeEach(() => {
    effects.length = 0;
    fetchMock.mockClear(); addEventListener.mockClear(); removeEventListener.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { addEventListener, removeEventListener });
  });
  const run = () => effects.map((e) => e()).filter((c): c is () => void => typeof c === 'function');

  const HOOKS: [string, (enabled?: boolean) => unknown, string][] = [
    ['useSupportUnreadCount', useSupportUnreadCount, '/api/support/my-tickets'],
    ['useUnreadMessagesCount', useUnreadMessagesCount, '/api/founder/messages'],
    ['useInterestRequests', useInterestRequests, '/api/founder/interest-level-requests'],
    ['usePendingInterestCount', usePendingInterestCount, '/api/founder/interest-level-requests'],
  ];

  it.each(HOOKS)('%s: disabled -> no request and no listener', (_name, hook) => {
    hook(false);
    run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it.each(HOOKS)('%s: enabled (and by default, for the screens that only exist for a signed-in user) -> one request, one listener, removed on cleanup', (_name, hook, url) => {
    for (const call of [() => hook(true), () => hook()]) {
      effects.length = 0; fetchMock.mockClear(); addEventListener.mockClear(); removeEventListener.mockClear();
      call();
      const cleanups = run();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(url);
      expect(addEventListener).toHaveBeenCalledTimes(1);
      cleanups.forEach((c) => c());
      expect(removeEventListener).toHaveBeenCalledTimes(1);
    }
  });

  it('the Shell hands ONE gate to all three, and the gate needs a signed-in session and a route that draws a nav', () => {
    const shell = read('src/components/shell.tsx');
    expect(shell).toContain('const badgesEnabled = me?.authEnabled === true && !isBareShellRoute;');
    for (const h of ['useUnreadMessagesCount', 'useSupportUnreadCount', 'usePendingInterestCount']) expect(shell).toContain(`${h}(badgesEnabled)`);
    // the gate is computed after the route has been classified, and before the bare-route early return
    const gate = shell.indexOf('const badgesEnabled');
    expect(gate).toBeGreaterThan(shell.indexOf('const isBareShellRoute'));
    expect(gate).toBeLessThan(shell.indexOf('if (isBareShellRoute) return'));
  });

  it('the floating "Tell us" widget (mounted on the public pages too) asks whether the user may suggest only once it knows there is a user', () => {
    const w = read('src/components/ReportProblemWidget.tsx');
    const getUser = w.indexOf('auth.getUser()');
    const guard = w.indexOf('if (!data.user) return;');
    const eligibility = w.indexOf("'/api/suggestions/eligibility'");
    expect(getUser).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(getUser);
    expect(eligibility).toBeGreaterThan(guard);
  });
});
