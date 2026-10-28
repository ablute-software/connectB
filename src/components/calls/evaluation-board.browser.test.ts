// Prompt 922 (I4) — the evaluation board in a REAL browser (the real EvaluationBoard bundled with rolldown; its API answered by a small in-memory stand-in built on the real consolidation module): the progress bar
// and numbers, the ranking with each application's average, deviation and flags, the average of each criterion, the decision made IN the page (with a note, nothing sent to the applicant), "Close evaluation" asking
// in the page, the export links, a person who cannot decide seeing no controls, and nothing wider than the screen at 1280/768/375 px. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeBoard, type BoardEval, type Decision } from '@/lib/calls/eval-board';
import type { Criterion } from '@/lib/calls/eval-grid';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://board.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-922-i4');

const crit = (id: string, name: string, weight: number, min: number, max: number, minScore: number | null = null): Criterion => ({ id, section: null, position: 0, name, guidance: '', weight, format: 'scale', scaleMin: min, scaleMax: max, levels: [], commentRequired: false, minScore });
const CRITERIA = [crit('t', 'Team', 50, 1, 5, 2), crit('m', 'Market with_a_very_long_unbroken_criterion_name_that_cannot_wrap_anywhere_1234567890', 50, 0, 10)];
const ev = (applicationId: string, who: string, scores: Record<string, number>, grade: number, status: 'submitted' | 'in_progress' = 'submitted'): BoardEval => ({ applicationId, evaluatorUserId: who, status, gridVersion: 1, gradePercent: grade, scores });

describe.skipIf(!CHROME)('the evaluation board (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-board-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/evaluation-board.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `evaluation-board-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  function server(opts: { canDecide?: boolean; empty?: boolean } = {}) {
    const state = { decisions: {} as Record<string, { decision: Decision; note: string | null }>, closed: false, posts: [] as Record<string, unknown>[] };
    const board = () => {
      const apps = opts.empty ? [] : [{ applicationId: 'a', reference: 'REF-001', startupName: 'Acme Robotics with_a_very_long_unbroken_name_that_cannot_wrap_anywhere_1234567890' }, { applicationId: 'b', reference: 'REF-002', startupName: 'Blue Health' }, { applicationId: 'c', reference: 'REF-003', startupName: null }, { applicationId: 'd', reference: 'REF-004', startupName: 'Dark Mode' }];
      const { rows, progress } = computeBoard({
        apps, assignments: opts.empty ? [] : [{ applicationId: 'a', userId: 'u1' }, { applicationId: 'a', userId: 'u2' }, { applicationId: 'b', userId: 'u1' }, { applicationId: 'b', userId: 'u2' }, { applicationId: 'c', userId: 'u1' }],
        evaluations: opts.empty ? [] : [ev('a', 'u1', { t: 5, m: 10 }, 100), ev('a', 'u2', { t: 1, m: 4 }, 30), ev('b', 'u1', { t: 4, m: 8 }, 80), ev('b', 'u2', { t: 3 }, 0, 'in_progress')],
        criteriaByVersion: { 1: CRITERIA }, currentVersion: 1, divergence: { enabled: true, scalePct: 40, totalPct: 20 }, decisions: state.decisions,
      });
      return { ok: true, canDecide: opts.canDecide !== false, rows, progress, criteria: CRITERIA, version: 1, closed: state.closed, closedAt: state.closed ? '2026-10-25T10:00:00Z' : null };
    };
    return {
      state,
      handle: (method: string, body: Record<string, unknown> | null): { status: number; body: unknown } => {
        if (method === 'GET') return { status: 200, body: board() };
        state.posts.push(body ?? {});
        if (body?.action === 'close') state.closed = true;
        if (body?.action === 'reopen') state.closed = false;
        if (body?.action === 'decide') { if (body.decision === null) delete state.decisions[body.applicationId as string]; else state.decisions[body.applicationId as string] = { decision: body.decision as Decision, note: (body.note as string) || null }; }
        return { status: 200, body: board() };
      },
    };
  }

  async function open(width: number, srv: ReturnType<typeof server>) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 700 });
    const errors: string[] = []; const dialogs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      const raw = route.request().postData();
      const r = srv.handle(route.request().method(), raw ? JSON.parse(raw) : null);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate(() => (window as unknown as { __startBoard: () => void }).__startBoard());
    await page.waitForSelector('[data-testid="board"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { page, errors, dialogs, overflow };
  }

  it('the progress, the ranking with average, deviation and state, the flags (they flag, never exclude), the average of each criterion, the opening of the evaluations', async () => {
    const { page, errors } = await open(1280, server());
    expect((await page.locator('[data-testid="board-progress"]').innerText()).replace(/\s+/g, ' ')).toBe('3 of 5 evaluations submitted · 1 of 4 applications complete · 1 without evaluators · 0 decided');
    expect(await page.locator('[data-testid="board-bar"]').getAttribute('aria-valuenow')).toBe('60');
    expect(await page.locator('[data-testid="board-rank"]').allInnerTexts()).toEqual(['1', '2', '–', '–']);
    const first = page.locator('[data-testid="board-row"]').first();
    expect(await first.innerText()).toContain('REF-002');
    expect(await first.locator('[data-testid="board-average"]').innerText()).toContain('80 %');
    const second = page.locator('[data-testid="board-row"]').nth(1);
    expect(await second.locator('[data-testid="board-average"]').innerText()).toContain('deviation 35');
    expect(await second.locator('[data-testid="board-flag-divergence"]').count()).toBe(3);
    expect(await second.locator('[data-testid="board-flag-below"]').innerText()).toBe('Below the minimum on Team (1 evaluator)');
    await second.locator('[data-testid="board-toggle"]').click();
    expect((await second.locator('[data-testid="board-criteria"]').innerText()).replace(/\s+/g, ' ')).toContain('Team 3 · 50 % · 2 evaluations');
    expect(await page.locator('[data-testid="board-state"]').allInnerTexts()).toEqual(['In progress', 'Complete', 'Not started', 'Nobody assigned']);
    await second.locator('[data-testid="board-open"]').click();
    expect(await page.evaluate(() => (window as unknown as { __log: string[] }).__log)).toEqual(['open a']);
    await page.screenshot({ path: path.join(SHOTS, 'board-1280.png'), fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('a decision is made IN the page: choose, write a note, save; the row shows it and the count follows; change it; remove it; nothing is sent to the applicant', async () => {
    const srv = server();
    const { page, dialogs } = await open(1280, srv);
    const row = page.locator('[data-testid="board-row"]').first();
    await row.locator('[data-testid="board-decide"]').click();
    expect(await page.locator('[data-testid="decide-save"]').isDisabled()).toBe(true);                     // choose first
    await page.locator('[data-testid="decide-advance"]').click();
    await page.locator('#dn-b').fill('Strong market.');
    expect(await page.locator('[data-testid="board-decide-form"]').innerText()).toContain('Nothing is sent to the applicant now');
    await page.locator('[data-testid="decide-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="board-decide-form"]').length === 0);
    expect(srv.state.posts[0]).toEqual({ action: 'decide', applicationId: 'b', decision: 'advance', note: 'Strong market.' });
    expect(await row.locator('[data-testid="board-decision"]').innerText()).toBe('Advance');
    expect(await row.locator('[data-testid="board-decision-note"]').innerText()).toBe('Note: Strong market.');
    expect(await page.locator('[data-testid="board-progress"]').innerText()).toContain('1 decided');
    await row.locator('[data-testid="board-decide"]').click();
    await page.locator('[data-testid="decide-waitlist"]').click();
    await page.locator('[data-testid="decide-save"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="board-decision"]')?.textContent === 'Waitlist');
    await row.locator('[data-testid="board-decide"]').click();
    await page.locator('[data-testid="decide-clear"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="board-decision"]').length === 0);
    expect(srv.state.decisions).toEqual({});
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('"Close evaluation…" asks IN the page, says what it does, closes; then "Reopen the evaluation"; the export links are there for whoever may decide', async () => {
    const srv = server();
    const { page, dialogs } = await open(1280, srv);
    expect(await page.locator('[data-testid="board-export-csv"]').getAttribute('href')).toBe('/api/calls/c1/evaluation-board/export?format=csv');
    expect(await page.locator('[data-testid="board-export-xlsx"]').getAttribute('href')).toBe('/api/calls/c1/evaluation-board/export?format=xlsx');
    expect(await page.locator('[data-testid="board-actions"]').innerText()).toContain('never a comment');
    await page.locator('[data-testid="board-close"]').click();
    expect(await page.locator('[data-testid="board-confirm-close"]').innerText()).toContain('Evaluators will no longer be able to save, submit or declare a conflict');
    expect(srv.state.posts).toEqual([]);
    await page.locator('[data-testid="board-close-yes"]').click();
    await page.waitForSelector('[data-testid="board-closed"]');
    expect(srv.state.closed).toBe(true);
    await page.locator('[data-testid="board-reopen-all"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="board-closed"]').length === 0);
    expect(srv.state.closed).toBe(false);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('whoever cannot decide sees the board but no decision, close or export controls; an empty call says what to expect', async () => {
    const a = await open(1280, server({ canDecide: false }));
    expect(await a.page.locator('[data-testid="board-decide"]').count()).toBe(0);
    expect(await a.page.locator('[data-testid="board-actions"]').count()).toBe(0);
    expect(await a.page.locator('[data-testid="board-row"]').count()).toBe(4);
    await a.page.close();
    const b = await open(1280, server({ empty: true }));
    expect(await b.page.locator('[data-testid="board-empty"]').innerText()).toContain('appear here once they are distributed');
    await b.page.close();
  }, 120_000);

  it('nothing is wider than the screen at 1280, 768 and 375 — long names, flags, the criteria, the decision form open (screenshots kept)', async () => {
    for (const width of [1280, 768, 375]) {
      const { page, overflow } = await open(width, server());
      const row = page.locator('[data-testid="board-row"]').nth(1);
      await row.locator('[data-testid="board-toggle"]').click();
      await row.locator('[data-testid="board-decide"]').click();
      await page.locator('[data-testid="decide-reject"]').click();
      expect(await overflow(), `${width}px`).toBeLessThanOrEqual(0);
      const bad = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="board"]') as HTMLElement; const r = root.getBoundingClientRect(); const out: string[] = [];
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) { const b = el.getBoundingClientRect(); if (b.width === 0) continue; if (b.right > r.right + 0.5 || b.left < r.left - 0.5) out.push(`${el.tagName}.${String(el.className).slice(0, 30)}`); }
        return out;
      });
      expect(bad, `${width}px`).toEqual([]);
      if (width !== 1280) await page.screenshot({ path: path.join(SHOTS, `board-${width}.png`), fullPage: true });
      await page.close();
    }
  }, 240_000);
});
