// Prompt 933 — the page for an address that matches nothing. A test can pin what the page SAYS and how the app is wired to draw it; what cannot be pinned here is the HTTP status (Next decides it, after the
// middleware) and how it looks in a browser, which `npm run verify:not-found` (scripts/check-not-found.mjs) and the screenshots of the prompt's report cover. The middleware half — an unknown page path goes on to
// Next instead of /login, an unknown /api path is 404 JSON — is src/lib/route-zones.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// next/font only exists inside Next's compiler; the layout calls it at module scope.
vi.mock('next/font/google', () => ({ Fraunces: () => ({ variable: 'font-fraunces' }), Inter: () => ({ variable: 'font-inter' }) }));

import NotFound, { metadata } from '@/app/not-found';
import { NotFoundCard } from './NotFoundCard';
import { NotFoundFrame } from './NotFoundFrame';
import { PublicSiteLayout } from './PublicSiteLayout';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const card = renderToStaticMarkup(createElement(NotFoundCard));
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

describe('the card', () => {
  it('says what happened in plain words, and puts "404" last, small', () => {
    expect(card.match(/<h1[ >]/g)).toHaveLength(1);
    expect(card).toMatch(/<h1[^>]*>No leads here<span[^>]*aria-hidden="true"[^>]*><\/span><\/h1>/);
    const text = textOf(card);
    expect(text).toContain('That address doesn’t match anything on Sherlock Deal. It may have been mistyped, or the link may be old.');
    expect(text.indexOf('Error 404 · Page not found')).toBeGreaterThan(text.indexOf('may be old'));
    // nothing technical in front of the person
    expect(textOf(card.slice(0, card.indexOf('</p>') + 4))).not.toMatch(/404|not found/i);
    expect(card).not.toContain('This page could not be found');
  });

  it('offers the two actions: back to the front door, and a way to say the link should have worked', () => {
    expect(card).toMatch(/<a [^>]*href="\/"[^>]*>Back to Sherlock Deal<\/a>/);
    expect(card).toMatch(/<a [^>]*href="\/contact"[^>]*>Report a problem<\/a>/);
    expect(card.match(/<a /g)).toHaveLength(2);
  });

  it('draws the mark of the logo and nothing new: no image, no new drawing', () => {
    expect(card).toContain('<svg');
    expect(card.match(/<svg/g)).toHaveLength(1);
    expect(card).not.toContain('<img');
  });

  it('is what src/app/not-found.tsx renders, with a title of its own — and nothing in that file can change the status or send the visitor anywhere', () => {
    expect(renderToStaticMarkup(createElement(NotFound))).toBe(card);
    expect(String(metadata.title)).toContain('Page not found');
    const code = read('src/app/not-found.tsx').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/redirect\(/, /\bstatus\b/, /notFound\(/, /export const dynamic/, /permanentRedirect/, /\bheaders\(|\bcookies\(/]) expect(code, String(forbidden)).not.toMatch(forbidden);
  });

  // The first version had `.nf { margin: 0 auto; padding: 0 24px }`: one class, the same specificity as the frame's `.landing *` reset, which won — the card sat against the left edge, and had no margin on a phone.
  it('every rule of its stylesheet is two classes deep — `.nf .x`, or `.nf.root` for the card\'s own box (the frame resets margin and padding on `.landing *`)', () => {
    const css = read('src/components/site/not-found.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...css.matchAll(/^([^\s@}{][^{]*)\{/gm)].map((m) => m[1].trim());
    expect(selectors.length).toBeGreaterThan(8);
    for (const sel of selectors) for (const part of sel.split(',')) expect(part.trim(), part.trim()).toMatch(/^\.nf(\.root| \.[a-z]+)([ :.][^,]*)?$/);
    // the card puts both classes on its root element
    expect(read('src/components/site/NotFoundCard.tsx')).toContain('className={`${s.nf} ${s.root}`}');
  });
});

describe('the frame (the public header and footer around the card)', () => {
  const frame = (signedIn: boolean) => renderToStaticMarkup(<NotFoundFrame signedIn={signedIn}><p>card</p></NotFoundFrame>);
  const guest = frame(false);
  const member = frame(true);

  it('has the same header and footer as every public page, with and without a session', () => {
    for (const markup of [guest, member]) {
      expect(markup).toContain('<nav class="');
      expect(markup).toContain('aria-label="Main"');
      expect(markup).toContain('data-scrolled="true"');
      expect(markup).toContain('<footer');
      expect(markup).toContain('aria-label="Footer"');
      expect(markup).toContain('href="/legal/privacy-notice"');
      expect(markup).toContain('<main');
    }
  });

  it('a visitor sees Sign in and Create account; a person with a session sees one button that opens the workspace', () => {
    expect(guest).toMatch(/href="\/login"[^>]*>Sign in</);
    expect(guest).toMatch(/href="\/signup"[^>]*>Create account</);
    expect(guest).not.toContain('Open workspace');
    expect(member).toMatch(/href="\/go"[^>]*>Open workspace</);
    expect(member).not.toContain('Sign in');
    expect(member).not.toContain('Create account');
  });

  it('is at least one screen high only when asked (the 404 asks; /faq, /about and /for-startups do not)', () => {
    const plain = renderToStaticMarkup(createElement(PublicSiteLayout, null, createElement('p', null, 'x')));
    expect(guest.match(/<div class="([^"]*)"/)?.[1]).not.toBe(plain.match(/<div class="([^"]*)"/)?.[1]);
    expect(read('src/components/site/site-page.module.css')).toMatch(/\.site\.fill \{[^}]*min-height: 100vh/);
  });
});

describe('the wiring: who draws the frame, and who stays away', () => {
  const shell = read('src/components/shell.tsx');
  const widget = read('src/components/ReportProblemWidget.tsx');

  it('the Shell asks for the segment of the page of an unknown address — not the path, which differs between the HTML made at build time and the browser', () => {
    expect(shell).toContain("useSelectedLayoutSegment() === '/_not-found'");
    expect(shell).toMatch(/\|\| isNotFoundRoute\n[^\n]*\n?[^\n]*\n\s*\|\| isPublicSitePage\(path\);/);
    // returned before the bare-route early return, which would otherwise swallow it
    expect(shell.indexOf('if (isNotFoundRoute) return <NotFoundFrame')).toBeGreaterThan(0);
    expect(shell.indexOf('if (isNotFoundRoute) return <NotFoundFrame')).toBeLessThan(shell.indexOf('if (isBareShellRoute) return'));
  });

  it('the frame is loaded on demand: a static import in the Shell would put the landing\'s stylesheet and two font families on every screen of the app', () => {
    expect(shell).toMatch(/dynamic\(\(\) => import\('@\/components\/site\/NotFoundFrame'\)/);
    expect(shell).not.toMatch(/^import .*(NotFoundFrame|PublicSiteLayout)/m);
  });

  it('the floating "Tell us" button is not drawn on that page (it has its own link), decided by the same segment', () => {
    expect(widget).toContain("useSelectedLayoutSegment() === '/_not-found'");
    expect(widget).toMatch(/if \(notFound\) return null;\n\s*if \(!showsReportProblemWidget\(pathname\)\) return null;/);
  });

  it('nothing else answers an unknown address: no catch-all page, and the one catch-all under /api answers 404 JSON', () => {
    const api = read('src/app/api/[...slug]/route.ts');
    expect(api).toMatch(/status: 404/);
    expect(api).toContain("error: 'not_found'");
    expect(existsSync(path.join(ROOT, 'src/app/[...slug]'))).toBe(false);
  });
});

describe('the /api catch-all', () => {
  it('answers 404 JSON, with the same body as the middleware, for every method', async () => {
    const route = await import('@/app/api/[...slug]/route');
    const handlers = { GET: route.GET, HEAD: route.HEAD, OPTIONS: route.OPTIONS, POST: route.POST, PUT: route.PUT, PATCH: route.PATCH, DELETE: route.DELETE } as unknown as Record<string, (req: Request) => Promise<Response> | Response>;
    for (const [method, handler] of Object.entries(handlers)) {
      const res = await handler(new Request('https://www.sherlockdeal.com/api/me/nothing', { method }));
      expect(res.status, method).toBe(404);
      expect(res.headers.get('content-type'), method).toContain('application/json');
      if (method !== 'HEAD') expect(await res.json(), method).toEqual({ ok: false, error: 'not_found', message: 'There is no such API route.' });
    }
  });
});

describe('the HTTP check', () => {
  const script = read('scripts/check-not-found.mjs');

  it('looks for the words the card really has', () => {
    const title = script.match(/export const TITLE = '([^']+)'/)?.[1];
    expect(title).toBeTruthy();
    expect(textOf(card)).toContain(title as string);
  });

  it('is wired as an npm script and fails (exit 1) when an answer is not the expected one', () => {
    expect(JSON.parse(read('package.json')).scripts['verify:not-found']).toBe('node scripts/check-not-found.mjs');
    expect(script).toContain('process.exit(1)');
    for (const must of ['r.status === 404', "redirect: 'manual'", '/api/isto-nao-existe', '/dashboard']) expect(script, must).toContain(must);
  });
});
