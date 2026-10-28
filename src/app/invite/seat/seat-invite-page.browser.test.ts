// Prompt 923 (B, C) — the seat-invitation page and the investor sign-in form in a REAL browser (the real components bundled with rolldown; the routes answered by a small stand-in, the auth provider by
// src/test/supabase-browser-stub.ts): only the email (locked), the 6-digit code, the name and the role — never a startup, never "Claim this profile"; the wait before another code counted down on the screen; an expired or
// replaced code says what to do; an incomplete email is stopped before a code is asked for; the refusal of an account that cannot join says why and that the invitation is still open; an unknown, cancelled or spent
// link; another address; the person who is already signed in; and nothing wider than the screen at 1280/768/375 px. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://invite.test';
const SHOTS = path.join(process.cwd(), 'docs/auth/screenshots-923');
const INVITED = 'sherlockdeal.com+aval2@gmail.com';
const STUBS: Record<string, string> = { '@/lib/supabase': 'test/supabase-browser-stub.ts', '@/components/auth/AuthShell': 'test/browser-stubs.tsx', 'next/link': 'test/browser-stubs.tsx' };

interface Api { invite: { status: number; body: unknown }; code: { status: number; body: unknown }; accessGet: { status: number; body: unknown }; accessPost: { status: number; body: unknown }; calls: string[]; posts: Record<string, unknown>[] }

describe.skipIf(!CHROME)('the seat-invitation page and the code form (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-invite-'));
    const src = path.join(process.cwd(), 'src');
    await build({
      input: path.join(src, 'app/invite/seat/seat-invite-page.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      // The stand-ins are swapped in by a plugin (it runs before the alias, so a specific module is replaced and the rest of '@/…' still resolves to src).
      plugins: [{ name: 'test-stubs', resolveId(source: string) { return STUBS[source] ? path.join(src, STUBS[source]) : null; } }],
      resolve: { alias: { '@': src } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      // A page reads process.env.NEXT_PUBLIC_… at load (the brand's address): there is no process in a browser, so an empty one is declared first.
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js', banner: 'var process = typeof process !== "undefined" ? process : { env: {} };' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `seat-invite-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/app/invite/**/*.tsx', '--content', 'src/components/auth/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  const defaults = (): Api => ({
    invite: { status: 200, body: { ok: true, firmName: 'ablute_ — Internal QA', email: INVITED, status: 'open' } },
    code: { status: 200, body: { ok: true, message: `We sent a 6-digit code to ${INVITED}.` } },
    accessGet: { status: 200, body: { ok: true, signedInAs: INVITED, matches: true, needsProfile: true } },
    accessPost: { status: 200, body: { ok: true, firmName: 'ablute_ — Internal QA', alreadyAccepted: false, next: '/go?as=investor' } },
    calls: [], posts: [],
  });

  async function open(width: number, api: Api, opts: { user?: boolean; start?: 'page' | 'signin'; otpFail?: { status: number; code?: string; message: string } | null } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 700 });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url()); const method = route.request().method();
      api.calls.push(`${method} ${url.pathname}`);
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      if (url.pathname.startsWith('/go')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>go</title><p data-testid="arrived">arrived</p>' });
      if (url.pathname.startsWith('/api/auth-failures')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      const raw = route.request().postData(); if (raw) api.posts.push(JSON.parse(raw));
      const r = url.pathname.endsWith('/code') ? api.code : url.pathname.endsWith('/accept') ? (method === 'GET' ? api.accessGet : api.accessPost) : api.invite;
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(({ user, otpFail }) => {
      (window as unknown as { __sb: unknown }).__sb = { user: user ? { id: 'u1', email: 'sherlockdeal.com+aval2@gmail.com', email_confirmed_at: '2026-10-28T10:00:00Z', user_metadata: {} } : null, goodCode: '123456', verifyFail: { status: 403, code: 'otp_expired', message: 'Email link is invalid or has expired' }, otpFail, calls: [] };
    }, { user: opts.user === true, otpFail: opts.otpFail ?? null });
    await page.addScriptTag({ content: bundle });
    await page.evaluate((s) => { const w = window as unknown as { __startPage: (t: string) => void; __startSignIn: () => void }; if (s === 'signin') w.__startSignIn(); else w.__startPage('tok'); }, opts.start ?? 'page');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const sbCalls = () => page.evaluate(() => (window as unknown as { __sb: { calls: { fn: string; args: unknown }[] } }).__sb.calls);
    return { page, errors, dialogs, overflow, sbCalls };
  }

  it('NEW PERSON: only the email (locked), the code, the name and the role — no startup, no password, no "Claim this profile" — and at the end they are taken to the firm\'s workspace', async () => {
    const api = defaults();
    const { page, errors, dialogs, sbCalls } = await open(1280, api);
    await page.waitForSelector('[data-testid="seat-invite-title"]');
    expect(await page.locator('[data-testid="seat-invite-title"]').innerText()).toBe('Join ablute_ — Internal QA');
    const email = page.locator('[data-testid="seat-invite-email"]');
    expect(await email.inputValue()).toBe(INVITED);
    expect(await email.getAttribute('readonly')).not.toBeNull();
    const text = (await page.locator('[data-testid="seat-invite-page"]').innerText()).toLowerCase();
    for (const forbidden of ['startup name', 'company name', 'claim this profile', 'create a startup', 'password']) expect(text, forbidden).not.toContain(forbidden);
    await page.screenshot({ path: path.join(SHOTS, 'invite-1-intro-1280.png'), fullPage: true });
    await page.locator('[data-testid="seat-invite-send"]').click();
    await page.waitForSelector('[data-testid="seat-invite-code"]');
    expect(api.calls).toContain('POST /api/invite/seat/tok/code');
    expect(api.posts).toEqual([]);                                                                 // the browser sent no address: the server uses the invitation's own
    expect(await page.locator('[data-testid="seat-invite-new-code-note"]').innerText()).toContain('replaces the previous one');
    expect(await page.locator('[data-testid="seat-invite-resend"]').isDisabled()).toBe(true);        // the wait before another code is counted
    expect(await page.locator('[data-testid="seat-invite-resend"]').innerText()).toMatch(/wait \d+s/);
    // a wrong or replaced code: the sentence says what to do
    await page.locator('[data-testid="seat-invite-code"]').fill('000000');
    await page.locator('[data-testid="seat-invite-verify"]').click();
    await page.waitForSelector('[data-testid="seat-invite-message"]');
    expect(await page.locator('[data-testid="seat-invite-message"]').innerText()).toBe('This code has expired or was replaced by a newer one. Use the latest code we sent, or request a new one.');
    // the right one: signed in → the page asks for the name and the role
    await page.locator('[data-testid="seat-invite-code"]').fill('123 456');
    expect(await page.locator('[data-testid="seat-invite-code"]').inputValue()).toBe('123456');
    await page.locator('[data-testid="seat-invite-verify"]').click();
    await page.waitForSelector('[data-testid="seat-invite-profile"]');
    expect((await sbCalls()).filter((c) => c.fn === 'verifyOtp').length).toBe(3);                // the wrong code is tried as "email" and as "signup"; the right one works at once
    expect(await page.locator('[data-testid="seat-invite-join"]').isDisabled()).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, 'invite-3-profile-1280.png'), fullPage: true });
    await page.locator('[data-testid="seat-invite-name"]').fill('Aval Two');
    await page.locator('[data-testid="seat-invite-role"]').fill('Analyst');
    await page.locator('[data-testid="seat-invite-join"]').click();
    await page.waitForSelector('[data-testid="seat-invite-done"]');
    expect(api.posts.at(-1)).toEqual({ name: 'Aval Two', role: 'Analyst' });
    expect(await page.locator('[data-testid="seat-invite-done"]').innerText()).toContain('You are now part of ablute_ — Internal QA');
    await page.waitForSelector('[data-testid="arrived"]', { timeout: 8000 });
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/go?as=investor');
    expect(await page.evaluate(() => document.cookie)).toContain('sd_area=investor');
    expect(errors).toEqual([]);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('C — two codes in a row: "For security, wait N seconds before asking for a new code." counts down live and the button stays off until it is over', async () => {
    const api = defaults();
    api.code = { status: 429, body: { ok: false, code: 'rate_limited', error: 'For security, wait 3 seconds before asking for a new code.', retryAfterSeconds: 3 } };
    const { page } = await open(1280, api);
    await page.waitForSelector('[data-testid="seat-invite-send"]');
    await page.locator('[data-testid="seat-invite-send"]').click();
    await page.waitForSelector('[data-testid="seat-invite-message"]');
    expect(await page.locator('[data-testid="seat-invite-message"]').innerText()).toMatch(/^For security, wait [123] seconds? before asking for a new code\.$/);
    expect(await page.locator('[data-testid="seat-invite-send"]').isDisabled()).toBe(true);
    expect(await page.locator('[data-testid="seat-invite-send"]').innerText()).toMatch(/^Wait [123]s$/);
    await page.waitForFunction(() => !(document.querySelector('[data-testid="seat-invite-send"]') as HTMLButtonElement).disabled, null, { timeout: 8000 });
    expect(await page.locator('[data-testid="seat-invite-send"]').innerText()).toBe('Send me a code');
    await page.close();
  }, 120_000);

  it('EXISTING account already signed in with the invited address: no code, no questions — it joins and goes to the firm\'s workspace', async () => {
    const api = defaults(); api.accessGet = { status: 200, body: { ok: true, signedInAs: INVITED, matches: true, needsProfile: false } };
    const { page } = await open(1280, api, { user: true });
    await page.waitForSelector('[data-testid="seat-invite-done"]');
    expect(api.calls).toContain('POST /api/invite/seat/tok/accept');
    expect(api.calls).not.toContain('POST /api/invite/seat/tok/code');
    await page.waitForSelector('[data-testid="arrived"]', { timeout: 8000 });
    await page.close();
  }, 120_000);

  it('an account that cannot join: the page says why and that the invitation is still open; the link out leads to their own account', async () => {
    const sentence = 'This account already belongs to «Portugal Ventures». Ask the inviter to use a different email, or leave «Portugal Ventures» first.';
    const api = defaults(); api.accessGet = { status: 200, body: { ok: true, signedInAs: INVITED, matches: true, needsProfile: false } };
    api.accessPost = { status: 409, body: { ok: false, code: 'other_firm', error: sentence } };
    const { page, overflow } = await open(375, api, { user: true });
    await page.waitForSelector('[data-testid="seat-invite-refused"]');
    expect(await page.locator('[data-testid="seat-invite-refusal"]').innerText()).toBe(sentence);
    expect(await page.locator('[data-testid="seat-invite-refused"]').innerText()).toContain('The invitation is still open: nothing was used up.');
    expect(await page.locator('[data-testid="seat-invite-refused"] a').getAttribute('href')).toBe('/go?as=investor');
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(SHOTS, 'invite-4-refused-375.png'), fullPage: true });
    await page.close();
  }, 120_000);

  it('signed in with ANOTHER address: it says which address the invitation is for (masked) and offers to sign out; an unknown, cancelled or spent link says so', async () => {
    const api = defaults(); api.accessGet = { status: 200, body: { ok: true, signedInAs: 'bob@qa.test', matches: false, needsProfile: false } };
    const a = await open(1280, api, { user: true });
    await a.page.waitForSelector('[data-testid="seat-invite-mismatch"]');
    const txt = await a.page.locator('[data-testid="seat-invite-mismatch"]').innerText();
    expect(txt).toContain('You are signed in as bob@qa.test.');
    expect(txt).toContain('@gmail.com'); expect(txt).not.toContain('sherlockdeal.com+aval2');
    await a.page.locator('[data-testid="seat-invite-signout"]').click();
    await a.page.waitForFunction(() => sessionStorage.getItem('__signedOut') === '1');                  // the page reloads after signing out: the marker survives it
    await a.page.close();
    const bad = defaults(); bad.invite = { status: 404, body: { ok: false } };
    const b = await open(1280, bad);
    await b.page.waitForSelector('[data-testid="seat-invite-invalid"]');
    expect(await b.page.locator('[data-testid="seat-invite-invalid"]').innerText()).toContain('This invitation is not valid');
    await b.page.close();
    const spent = defaults(); spent.invite = { status: 200, body: { ok: true, firmName: 'ablute_ — Internal QA', email: INVITED, status: 'accepted' } };
    const c = await open(1280, spent);
    await c.page.waitForSelector('[data-testid="seat-invite-closed"]');
    expect(await c.page.locator('[data-testid="seat-invite-closed"]').innerText()).toContain('already used');
    await c.page.close();
    const cancelled = defaults(); cancelled.invite = { status: 200, body: { ok: true, firmName: 'ablute_ — Internal QA', email: INVITED, status: 'cancelled' } };
    const d = await open(1280, cancelled);
    await d.page.waitForSelector('[data-testid="seat-invite-closed"]');
    expect(await d.page.locator('[data-testid="seat-invite-closed"]').innerText()).toContain('Ask ablute_ — Internal QA to send you a new one.');
    await d.page.close();
  }, 120_000);

  it('C — the investor sign-in form: an incomplete address is stopped BEFORE a code is asked for; the provider\'s wait is counted; a sent code says the newest one replaces the previous', async () => {
    const api = defaults();
    const { page, sbCalls } = await open(375, api, { start: 'signin', otpFail: { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 3 seconds.' } });
    await page.waitForSelector('[data-testid="send-code"]');
    await page.locator('input[type="email"]').fill('sherlockdeal.com+aval1@gmail.c');
    await page.locator('[data-testid="send-code"]').click();
    expect(await page.locator('[data-testid="auth-message"]').innerText()).toBe('Check the email address — it looks incomplete.');
    expect((await sbCalls()).filter((c) => c.fn === 'signInWithOtp')).toEqual([]);                 // it never reached the provider
    await page.locator('input[type="email"]').fill('sherlockdeal.com+aval1@gmail.com');
    await page.locator('[data-testid="send-code"]').click();
    await page.waitForFunction(() => /For security, wait \d seconds? before asking/.test(document.querySelector('[data-testid="auth-message"]')?.textContent ?? ''));
    expect(await page.locator('[data-testid="send-code"]').isDisabled()).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, 'code-wait-375.png'), fullPage: true });
    await page.waitForFunction(() => !(document.querySelector('[data-testid="send-code"]') as HTMLButtonElement).disabled, null, { timeout: 8000 });
    await page.evaluate(() => { (window as unknown as { __sb: { otpFail: unknown } }).__sb.otpFail = null; });
    await page.locator('[data-testid="send-code"]').click();
    await page.waitForSelector('[data-testid="new-code-note"]');
    expect(await page.locator('[data-testid="new-code-note"]').innerText()).toContain('replaces the previous one');
    await page.close();
  }, 120_000);

  it('nothing is wider than the screen at 1280, 768 and 375 — the intro, the code and the profile steps (screenshots kept)', async () => {
    for (const width of [1280, 768, 375]) {
      const api = defaults();
      const { page, overflow } = await open(width, api);
      await page.waitForSelector('[data-testid="seat-invite-send"]');
      expect(await overflow(), `${width}px intro`).toBeLessThanOrEqual(0);
      await page.locator('[data-testid="seat-invite-send"]').click();
      await page.waitForSelector('[data-testid="seat-invite-code"]');
      expect(await overflow(), `${width}px code`).toBeLessThanOrEqual(0);
      if (width !== 1280) await page.screenshot({ path: path.join(SHOTS, `invite-2-code-${width}.png`), fullPage: true });
      await page.locator('[data-testid="seat-invite-code"]').fill('123456');
      await page.locator('[data-testid="seat-invite-verify"]').click();
      await page.waitForSelector('[data-testid="seat-invite-profile"]');
      expect(await overflow(), `${width}px profile`).toBeLessThanOrEqual(0);
      if (width !== 1280) await page.screenshot({ path: path.join(SHOTS, `invite-3-profile-${width}.png`), fullPage: true });
      await page.close();
    }
  }, 240_000);
});
