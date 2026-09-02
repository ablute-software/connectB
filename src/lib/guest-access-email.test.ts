import { describe, expect, it } from 'vitest';
import {
  GUEST_EMAIL_ASSET_BASE, assertNoUnresolvedTokens, buildGuestAccessEmail,
  greetingName, guestEmailLinks, loadGuestAccessTemplate,
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

  it('product links land on the real guest-mode workspace surfaces, not a signup wall', () => {
    const links = guestEmailLinks();
    expect(links.discover_startups_url).toContain('/portal/pipeline');
    expect(links.watson_url).toContain('/portal/watson');
    expect(links.bars_url).toContain('/portal/bars');
    for (const url of Object.values(links)) expect(url).toMatch(/^https:\/\//);
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
