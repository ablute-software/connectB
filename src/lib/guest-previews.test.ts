// Prompt 526 Part B / Prompt 548 — guards the things about the guest
// previews that can silently rot: the contextual copy (which the approved
// email's own CTAs promise, so a reword here breaks a promise made in
// someone's inbox), the links the sidebar builds, and the rule that no
// preview may ever reach an API.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EMAIL_CTA_KEYS, PREVIEWS, PREVIEW_COPY, activeNavKeyFor, guestNavHref, isPreviewableKey, previewSignupHref } from '@/lib/guest-previews';
import { GUEST_PREVIEWABLE_KEYS, INVESTOR_NAV_KEYS } from '@/lib/investor-nav';

const REPO = path.resolve(__dirname, '../..');
const TOKEN = 'abc123def456';

describe('guest preview copy', () => {
  it('carries the approved contextual messages verbatim', () => {
    expect(PREVIEW_COPY.pipeline.message).toBe(
      'Sign up to access a pipeline curated for your investment thesis.',
    );
    expect(PREVIEW_COPY.watson.message).toBe(
      'Create an investor account to use Watson and get a private AI second opinion on your deals.',
    );
    expect(PREVIEW_COPY.bars.message).toBe(
      'Create an investor account to assess opportunities with BARS.',
    );
  });

  it('has copy for every previewable nav entry', () => {
    for (const key of GUEST_PREVIEWABLE_KEYS) {
      expect(PREVIEW_COPY[key], `no copy for ${key}`).toBeTruthy();
      expect(PREVIEW_COPY[key].message.trim()).not.toBe('');
      expect(PREVIEW_COPY[key].title.trim()).not.toBe('');
    }
  });

  it("keeps the email's own three CTA keys and URLs intact", () => {
    expect([...EMAIL_CTA_KEYS]).toEqual(['pipeline', 'watson', 'bars']);
    for (const p of PREVIEWS) expect(p.href).toBe(`/guest/preview/${p.key}`);
  });

  it('serves all three email CTA URLs — watson and bars are NOT nav entries', () => {
    // Caught in the browser, not by review: making the route dynamic on
    // INVESTOR_NAV keys alone 404'd /guest/preview/watson and
    // /guest/preview/bars, two of the three links the approved email sends
    // people to. They are tools inside Evaluation tools, so they never
    // appear in the sidebar — but their URLs are in inboxes.
    for (const key of EMAIL_CTA_KEYS) expect(isPreviewableKey(key)).toBe(true);
    expect(GUEST_PREVIEWABLE_KEYS).not.toContain('watson');
    expect(GUEST_PREVIEWABLE_KEYS).not.toContain('bars');
  });

  it('lights up Evaluation tools for its own sub-tools', () => {
    expect(activeNavKeyFor('watson')).toBe('evaluation');
    expect(activeNavKeyFor('bars')).toBe('evaluation');
    expect(activeNavKeyFor('pipeline')).toBe('pipeline');
  });

  it('refuses a key that is neither a nav entry nor an email CTA', () => {
    for (const key of ['archive', 'access', '', '../admin']) {
      expect(isPreviewableKey(key)).toBe(false);
    }
  });
});

describe('previewSignupHref', () => {
  it('sends every CTA to the existing investor signup flow, keeping the origin', () => {
    expect(previewSignupHref('pipeline')).toBe('/signup?as=investor&source=pipeline_preview');
    expect(previewSignupHref('watson')).toBe('/signup?as=investor&source=watson_preview');
    expect(previewSignupHref('bars')).toBe('/signup?as=investor&source=bars_preview');
  });

  it('carries the guest token when there is one, so the grant can be resolved later', () => {
    expect(previewSignupHref('pipeline', TOKEN))
      .toBe(`/signup?as=investor&source=pipeline_preview&guest=${TOKEN}`);
    expect(previewSignupHref('plans', TOKEN))
      .toBe(`/signup?as=investor&source=plans&guest=${TOKEN}`);
  });

  it('escapes a token rather than pasting it into the query raw', () => {
    expect(previewSignupHref('plans', 'a b&c')).toContain('guest=a%20b%26c');
  });
});

describe('guestNavHref', () => {
  it('sends the Data room entry back to the guest\'s own share', () => {
    expect(guestNavHref('access', TOKEN)).toBe(`/guest/${TOKEN}`);
  });

  it('has no Data room entry without a token — there is nothing to return to', () => {
    expect(guestNavHref('access')).toBeNull();
  });

  it('keeps the token in the PATH, never a query string', () => {
    // A query string would be dropped by any link that rebuilds the URL, and
    // sessionStorage would break a new tab. The token travels the same way
    // the guest page itself carries it.
    const href = guestNavHref('pipeline', TOKEN);
    expect(href).toBe(`/guest/${TOKEN}/preview/pipeline`);
    expect(href).not.toContain('?');
  });

  it('points a token-less Plans entry at the public pricing page', () => {
    expect(guestNavHref('plans')).toBe('/investors#pricing');
    expect(guestNavHref('plans', TOKEN)).toBe(`/guest/${TOKEN}/preview/plans`);
  });

  it('resolves every previewable entry, with and without a token', () => {
    for (const key of GUEST_PREVIEWABLE_KEYS) {
      expect(guestNavHref(key, TOKEN), `no href for ${key}`).toBeTruthy();
      expect(guestNavHref(key), `no token-less href for ${key}`).toBeTruthy();
    }
    // Every nav entry the sidebar renders resolves to something clickable —
    // the whole point of Prompt 548. Only 'access' without a token does not.
    for (const key of INVESTOR_NAV_KEYS) {
      expect(guestNavHref(key, TOKEN), `${key} is a dead entry`).toBeTruthy();
    }
  });

  it('refuses anything that is not a nav entry', () => {
    for (const key of ['archive', '', '../admin', 'PIPELINE']) {
      expect(guestNavHref(key, TOKEN)).toBeNull();
    }
  });
});

describe('no guest preview may reach an API', () => {
  // The rule Prompt 526 set and Prompt 548 widened: these pages render for
  // anyone holding a link, so they must not fetch, must not touch the store,
  // and must not reach Supabase. Watson in particular never runs — there is
  // no request to gate, because there is no request.
  const DIRS = [
    'src/app/guest/preview',
    'src/app/guest/[token]/preview',
    'src/components/guest/previews',
  ];

  function filesUnder(dir: string): string[] {
    const abs = path.join(REPO, dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => (
      e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]
    ));
  }

  it('covers a real, non-empty set of files', () => {
    const all = DIRS.flatMap(filesUnder);
    expect(all.length, 'the preview surface moved — update DIRS').toBeGreaterThan(3);
  });

  for (const dir of DIRS) {
    it(`is clean under ${dir}`, () => {
      for (const rel of filesUnder(dir)) {
        const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
        // Comments legitimately name the routes these files do NOT call, so
        // strip them before looking for real calls.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code, `${rel} fetches`).not.toMatch(/\bfetch\s*\(/);
        expect(code, `${rel} uses the store`).not.toMatch(/\buseStore\b/);
        expect(code, `${rel} builds a Supabase client`).not.toMatch(/\bbrowserClient\b/);
        expect(code, `${rel} imports server-only Supabase`).not.toMatch(/supabase-server/);
        expect(code, `${rel} references an orgId`).not.toMatch(/orgId/);
      }
    });
  }
});
