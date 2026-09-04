import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  GUEST_EMAIL_ASSET_BASE, assertNoUnresolvedTokens, buildGuestAccessEmail,
  greetingName, guestEmailLinks, loadGuestAccessTemplate, normaliseNewlines,
} from './guest-access-email';

// Prompt 532 — the email half of the release blocker. The single most
// important assertion in this file is that no `{{placeholder}}` can survive
// into a sent message; the rest pin the approved v2 design against silent
// drift (§17/§18) and the asset rule (§19).

const SAMPLE = {
  recipientEmail: 'alex.teste@example.com',
  invitedName: 'Alex Teste',
  startupName: 'ablute_',
  guestUrl: 'https://connect-b-delta.vercel.app/guest/abc123token',
};

describe('the approved v2 package ships intact', () => {
  it('loads template.html and plain_text.txt from the repo', () => {
    const { html, text } = loadGuestAccessTemplate();
    expect(html).toContain('<!doctype html>');
    expect(text).toContain('Subject:');
  });

  it('is the v2 template — the legacy decor assets it dropped are not referenced', () => {
    // §18: the refined v2 removed the CTA/About curves and the divider star.
    // Those files still exist in the ZIP; nothing may render them again.
    const { html } = loadGuestAccessTemplate();
    for (const legacy of ['button-decor.png', 'about-decor.png', 'divider-star.png']) {
      expect(html).not.toContain(legacy);
    }
  });

  it('keeps the approved structure: CTA, three hook cards, About section, footer', () => {
    const { html } = buildGuestAccessEmail(SAMPLE);
    expect(html).toContain('Access here');
    // Headings wrap in the approved markup ("Find your<br>next unicorn"), so
    // assert on the distinctive words rather than a contiguous string — the
    // point is that all three cards survive, not how they line-break.
    expect(html).toContain('next unicorn');
    expect(html).toContain('Ask Watson');
    expect(html).toContain('others miss');
    expect(html).toContain('About SherlockDeal');
    expect(html).toContain('Investor relations, investigated.');
  });

  it('keeps the v2 equal-height cards', () => {
    // §18 names "equal-height product cards" as a v2 refinement: all three
    // are pinned to the same explicit height in the approved markup.
    const { html } = loadGuestAccessTemplate();
    expect((html.match(/class="feature-card" height="320"/g) ?? []).length).toBe(3);
  });

  it('uses the web/globe icon in the About section, not the old placeholder', () => {
    expect(loadGuestAccessTemplate().html).toContain('icon-web.png');
  });
});

describe('no unresolved placeholder can ever be sent', () => {
  it('rendered HTML and text carry no {{tokens}}', () => {
    const { html, text } = buildGuestAccessEmail(SAMPLE);
    expect(html).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/i);
    expect(text).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/i);
  });

  it('assertNoUnresolvedTokens throws rather than letting one through', () => {
    expect(() => assertNoUnresolvedTokens('Hi {{recipient_first_name}},', 'test'))
      .toThrow(/unresolved template variables: \{\{recipient_first_name\}\}/);
    expect(() => assertNoUnresolvedTokens('Hi Alex,', 'test')).not.toThrow();
  });
});

describe('variables are wired to real values', () => {
  const { html, text, subject } = buildGuestAccessEmail(SAMPLE);

  it('uses the approved subject wording from the package itself', () => {
    expect(subject).toBe('ablute_ shared documents with you');
  });

  it('strips the Subject: line out of the plain-text body', () => {
    expect(text.startsWith('Subject:')).toBe(false);
    expect(text).toContain('Hi Alex,');
  });

  it('the primary CTA is the guest URL — never the email, never a generic link', () => {
    expect(html).toContain(SAMPLE.guestUrl);
    expect(text).toContain(SAMPLE.guestUrl);
    // §24: the recipient's address must not become the authorization.
    expect(html).not.toContain('alex.teste@example.com');
  });

  it('assets resolve to public HTTPS URLs, never local paths or data URIs', () => {
    expect(GUEST_EMAIL_ASSET_BASE).toMatch(/^https:\/\//);
    expect(GUEST_EMAIL_ASSET_BASE).toMatch(/\/email\/guest-access$/);
    expect(html).toContain(`${GUEST_EMAIL_ASSET_BASE}/sherlockdeal-logo.png`);
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('/mnt/');
    expect(html).not.toContain('localhost');
  });

  it('product links land on the real guest-mode preview surfaces, not a signup wall', () => {
    const links = guestEmailLinks();
    expect(links.discover_startups_url).toContain('/guest/preview/pipeline');
    expect(links.watson_url).toContain('/guest/preview/watson');
    expect(links.bars_url).toContain('/guest/preview/bars');
    for (const url of Object.values(links)) expect(url).toMatch(/^https:\/\//);
  });

  it('carries the share token into the three CTAs when the caller has one', () => {
    const links = guestEmailLinks('abc123');
    expect(links.discover_startups_url).toContain('/guest/abc123/preview/pipeline');
    expect(links.watson_url).toContain('/guest/abc123/preview/watson');
    expect(links.bars_url).toContain('/guest/abc123/preview/bars');
    // The footer is about the product, not the share — no token in it.
    expect(links.privacy_url).not.toContain('abc123');
    expect(links.contact_url).not.toContain('abc123');
  });

  it('keeps ?from=guest-email on the three CTAs, with or without a token', () => {
    for (const links of [guestEmailLinks(), guestEmailLinks('abc123')]) {
      expect(links.discover_startups_url).toContain('?from=guest-email');
      expect(links.watson_url).toContain('?from=guest-email');
      expect(links.bars_url).toContain('?from=guest-email');
    }
  });

  // Prompt 557's core regression test. Every URL the email carries used to
  // 404 or bounce to /login; nothing in the codebase noticed, because
  // nothing checked that these strings correspond to routes. This walks
  // src/app for real and fails if any of them stops resolving — including
  // if someone deletes or renames a preview route later.
  describe('every URL in the email resolves to a route that exists and needs no account', () => {
    const APP_DIR = path.join(process.cwd(), 'src', 'app');

    /** Route paths Next will serve, derived from the filesystem: a directory
     *  holding page.tsx is a route; (groups) collapse; [dynamic] segments
     *  match anything. Returns matcher regexes, not literal strings, so a
     *  dynamic segment is compared the way Next resolves it. */
    function routeMatchers(dir: string, prefix = ''): RegExp[] {
      const out: RegExp[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'api') continue;
        if (entry.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
          const pattern = (prefix === '' ? '/' : prefix)
            .replace(/\[\.\.\.[^\]]+\]/g, '.+')
            .replace(/\[[^\]]+\]/g, '[^/]+');
          out.push(new RegExp(`^${pattern}$`));
        }
        if (entry.isDirectory()) {
          // (group) segments are organisational and do not appear in the URL.
          const segment = /^\(.+\)$/.test(entry.name) ? '' : `/${entry.name}`;
          out.push(...routeMatchers(path.join(dir, entry.name), prefix + segment));
        }
      }
      return out;
    }

    const matchers = routeMatchers(APP_DIR);

    // Mirrors src/middleware.ts's own prefix test. A guest clicking these
    // has no session by definition, so a link that is merely a real route
    // but not public is still broken — it 307s to /login?next=…, which is
    // exactly what /privacy, /security and /support were doing.
    const PUBLIC_PREFIXES = ['/', '/terms', '/contact', '/guest', '/investors', '/privacy-request', '/login', '/signup'];
    const isPublic = (p: string) => PUBLIC_PREFIXES.some((q) => p === q || p.startsWith(q === '/' ? '/' : q + '/')) && (p === '/' || PUBLIC_PREFIXES.some((q) => q !== '/' && (p === q || p.startsWith(q + '/'))));

    it('finds the preview routes at all (guards the walker itself)', () => {
      expect(matchers.some((m) => m.test('/guest/preview/pipeline'))).toBe(true);
      expect(matchers.some((m) => m.test('/guest/abc123/preview/pipeline'))).toBe(true);
      // The routes the email used to point at genuinely do not exist —
      // if this ever starts failing, /portal grew subroutes and the comment
      // in guestEmailLinks needs revisiting, not this assertion deleting.
      expect(matchers.some((m) => m.test('/portal/pipeline'))).toBe(false);
      expect(matchers.some((m) => m.test('/privacy'))).toBe(false);
      expect(matchers.some((m) => m.test('/security'))).toBe(false);
      expect(matchers.some((m) => m.test('/support'))).toBe(false);
    });

    for (const withToken of [undefined, 'abc123']) {
      const label = withToken ? 'with a share token' : 'without a share token';
      it(`${label}`, () => {
        const links = guestEmailLinks(withToken);
        for (const [name, url] of Object.entries(links)) {
          const pathname = new URL(url).pathname;
          expect(matchers.some((m) => m.test(pathname)), `${name} -> ${pathname} matches no route in src/app`).toBe(true);
          expect(isPublic(pathname), `${name} -> ${pathname} is not reachable without an account`).toBe(true);
        }
      });
    }
  });

  it('escapes the startup name so a quote in it cannot break the markup', () => {
    const { html: escaped } = buildGuestAccessEmail({ ...SAMPLE, startupName: 'A"B <script>' });
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('does NOT html-escape the plain-text part', () => {
    const { text: plain } = buildGuestAccessEmail({ ...SAMPLE, startupName: 'Bar & Co' });
    expect(plain).toContain('Bar & Co');
    expect(plain).not.toContain('Bar &amp; Co');
  });
});

describe('greetingName', () => {
  it('uses the first name the founder typed', () => {
    expect(greetingName('Alex Teste', 'x@y.com')).toBe('Alex');
  });

  it('falls back to the address local part rather than an empty greeting', () => {
    expect(greetingName(null, 'maria.silva@fund.vc')).toBe('Maria');
    expect(greetingName('   ', 'joao_pedro@fund.vc')).toBe('Joao');
  });

  it('never renders an empty name', () => {
    expect(greetingName(undefined, '@nothing.com')).toBe('there');
  });
});

// Prompt 535 — this suite failed on every Windows checkout and passed on
// Linux, because git's core.autocrlf rewrites the template to CRLF and
// JavaScript's "." does not match a carriage return, so the Subject: line
// stopped being stripped out of the plain-text body.
//
// These assertions are written against synthetic CRLF rather than against
// the file on disk on purpose: a "no \r in the loaded template" check would
// pass trivially on Linux, where the file is LF whether or not the
// normalisation exists, and would therefore never catch its removal in CI.
describe('CRLF template handling', () => {
  it('normalises CRLF to LF', () => {
    expect(normaliseNewlines('Subject: x\r\n\r\nHi Alex,\r\n')).toBe('Subject: x\n\nHi Alex,\n');
  });

  it('leaves LF input untouched', () => {
    expect(normaliseNewlines('Subject: x\n\nHi Alex,\n')).toBe('Subject: x\n\nHi Alex,\n');
  });

  it('lets the Subject: line be stripped from a CRLF body', () => {
    // The exact failure: without normalisation the match returns null, the
    // subject falls back to a default, and the body keeps a literal
    // "Subject: ..." first line that the recipient sees.
    const crlf = 'Subject: Acme shared documents with you\r\n\r\nHi Alex,\r\n';
    const [firstLine, ...rest] = normaliseNewlines(crlf).split('\n');
    const match = firstLine.match(/^Subject:\s*(.+)$/);
    expect(match?.[1]).toBe('Acme shared documents with you');
    expect(rest.join('\n').replace(/^\n+/, '').startsWith('Subject:')).toBe(false);
  });

  it('the template as loaded carries no carriage returns, on any platform', () => {
    const { html, text } = loadGuestAccessTemplate();
    expect(text).not.toContain('\r');
    expect(html).not.toContain('\r');
  });
});
