// Prompt 922 (I3) — the evaluator's screens in a REAL browser (the real EvaluationScreen and MyEvaluations bundled with rolldown; their API answered by a small in-memory stand-in): the application and the grid side
// by side on a wide screen and in two tabs on a tablet or phone; a score changes the ring and shows the level's description; everything is SAVED BY ITSELF (no Save button) with the revision; "Submit evaluation" asks
// IN the page and says exactly what is missing; once submitted it is read-only; blind evaluation says so; "I have a conflict" and "Reopen…" are forms in the page; files open through the platform; "My evaluations"
// shows each call with its deadline and where each application stands; nothing is wider than the screen at 1280/768/375 px. Without a Chrome (set CHROME_PATH) it is skipped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EvaluationPayload, MineCall, ScoreMap } from '@/lib/calls/eval-store';
import type { Criterion } from '@/lib/calls/eval-grid';

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter((p): p is string => !!p).find((p) => fs.existsSync(p));
const ORIGIN = 'http://evaluation.test';
const SHOTS = path.join(process.cwd(), 'docs/calls/screenshots-922-i3');

const crit = (id: string, name: string, weight: number, min: number, max: number, extra: Partial<Criterion> = {}): Criterion => ({ id, section: null, position: 0, name, guidance: '', weight, format: 'scale', scaleMin: min, scaleMax: max, levels: [], commentRequired: false, minScore: null, ...extra });
const CRITERIA = [
  crit('k1', 'Team', 50, 1, 5, { guidance: 'Look at the founders and how complete the team is.', levels: [{ from: 1, to: 1, text: 'weak' }, { from: 5, to: 5, text: 'an excellent, complete team' }], minScore: 2 }),
  crit('k2', 'Market with_a_very_long_unbroken_criterion_name_that_cannot_wrap_anywhere_1234567890', 30, 1, 5, { commentRequired: true }),
  crit('k3', 'Technology', 20, 0, 10),
];
const FIELDS = [
  { id: 'f1', label: 'Company name', kind: 'short_text', page: 1, position: 0, options: [], validations: {}, required: false, instruction: '' },
  { id: 'f2', label: 'Pitch', kind: 'long_text', page: 1, position: 1, options: [], validations: {}, required: false, instruction: '' },
  { id: 'f3', label: 'Permanent Certificate', kind: 'file', page: 2, position: 0, options: [], validations: {}, required: false, instruction: '' },
] as never;

const payload = (over: Partial<EvaluationPayload> = {}): EvaluationPayload => ({
  call: { id: 'c1', name: 'Innovation call 2027', timezone: 'Europe/Lisbon', closed: false }, role: 'evaluator', canEdit: true, canReopen: false, blind: false,
  application: { id: 'a1', reference: 'REF-001', startupName: 'Acme Robotics', submittedAt: '2026-10-10T10:00:00Z', version: 1 },
  fields: FIELDS, currency: 'EUR',
  answers: { f1: 'Acme Robotics', f2: 'We build robots for health care with a_very_long_unbroken_word_that_cannot_wrap_anywhere_1234567890 and more words after it.', f3: [{ fileId: 'file-1', fileName: 'certidao.pdf', size: 2048 }] } as never,
  documents: [{ fileId: 'file-1', fieldId: 'f3', fileName: 'certidao.pdf', size: 2048, url: '/api/calls/c1/evaluations/a1/documents/file-1' }],
  grid: { version: 1, criteria: CRITERIA, commentRequiredForAll: false },
  evaluation: { id: null, status: 'not_started', scores: {}, overallComment: '', privateNote: '', revision: 0, gradePercent: null, submittedAt: null, reopenedCount: 0 },
  below: [], autos: {}, drift: [], deadline: { day: '2026-12-15', daysLeft: 3 }, colleagues: null,
  ...over,
});

describe.skipIf(!CHROME)('the evaluator screens (real browser)', () => {
  let bundle = ''; let css = '';
  let browser: import('playwright').Browser;
  beforeAll(async () => {
    const bundler = 'rolldown';
    const { build } = (await import(/* @vite-ignore */ bundler)) as { build: (o: Record<string, unknown>) => Promise<unknown> };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-screen-'));
    await build({
      input: path.join(process.cwd(), 'src/components/calls/evaluation-screen.harness.tsx'), cwd: process.cwd(), platform: 'browser',
      resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
      transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"development"' } },
      output: { dir: outDir, format: 'iife', entryFileNames: 'bundle.js' }, logLevel: 'silent',
    });
    bundle = fs.readFileSync(path.join(outDir, 'bundle.js'), 'utf8');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { spawnSync } = await import('node:child_process');
    const cssOut = path.join(os.tmpdir(), `evaluation-screen-${process.pid}.css`);
    const r = spawnSync('npx', ['tailwindcss', '--content', 'src/components/calls/**/*.tsx', '-i', 'src/app/globals.css', '-o', cssOut], { cwd: process.cwd(), shell: true, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    css = fs.readFileSync(cssOut, 'utf8'); fs.rmSync(cssOut, { force: true });
    fs.mkdirSync(SHOTS, { recursive: true });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  }, 240_000);
  afterAll(async () => { await browser?.close(); }, 60_000);

  /** A small in-memory stand-in for the routes: it keeps the scores, counts revisions, refuses an incomplete submit with the list, and turns "submitted" into read-only. */
  function server(initial: EvaluationPayload = payload(), opts: { mine?: MineCall[]; failSave?: 'conflict' } = {}) {
    const state = { p: initial, rev: initial.evaluation.revision, puts: [] as Record<string, unknown>[], submits: 0, conflicts: [] as unknown[], reopens: [] as unknown[] };
    const handle = (method: string, url: string, body: Record<string, unknown> | null): { status: number; body: unknown } => {
      if (url === '/api/calls/my-evaluations') return { status: 200, body: { ok: true, calls: opts.mine ?? [], remaining: (opts.mine ?? []).reduce((n, c) => n + c.remaining, 0) } };
      if (url.endsWith('/conflict')) { state.conflicts.push(body); return { status: 200, body: { ok: true } }; }
      if (url.endsWith('/reopen')) { state.reopens.push(body); state.p = { ...state.p, colleagues: [], evaluation: { ...state.p.evaluation, status: 'in_progress' } }; return { status: 200, body: { ok: true } }; }
      if (url.endsWith('/submit')) {
        const sc = state.p.evaluation.scores;
        const missing: { criterionId: string; name: string; problem: 'score' | 'comment' }[] = [];
        for (const c of state.p.grid.criteria) { const x = sc[c.id]; if (!x || x.score === null) missing.push({ criterionId: c.id, name: c.name, problem: 'score' }); else if (c.commentRequired && !x.comment.trim()) missing.push({ criterionId: c.id, name: c.name, problem: 'comment' }); }
        if (missing.length) return { status: 422, body: { ok: false, code: 'incomplete', missing, error: `Before submitting: ${missing.length} thing${missing.length === 1 ? '' : 's'} missing.` } };
        state.submits++; state.p = { ...state.p, canEdit: false, evaluation: { ...state.p.evaluation, status: 'submitted', submittedAt: '2026-10-20T09:00:00Z', gradePercent: 80 } };
        return { status: 200, body: { ok: true, gradePercent: 80, submittedAt: '2026-10-20T09:00:00Z' } };
      }
      if (method === 'GET') return { status: 200, body: { ok: true, ...state.p } };
      state.puts.push(body ?? {});
      if (opts.failSave === 'conflict') return { status: 409, body: { ok: false, code: 'conflict', error: 'This evaluation was changed in another window. Reload to continue.', revision: 9 } };
      const scores: ScoreMap = { ...state.p.evaluation.scores };
      for (const [id, s] of Object.entries((body?.scores ?? {}) as Record<string, { score?: number | null; comment?: string }>)) {
        const prev = scores[id] ?? { score: null, comment: '' };
        scores[id] = { score: s.score === undefined ? prev.score : s.score, comment: typeof s.comment === 'string' ? s.comment : prev.comment };
      }
      state.rev += 1;
      state.p = { ...state.p, evaluation: { ...state.p.evaluation, id: 'ev1', status: 'in_progress', scores, revision: state.rev, overallComment: typeof body?.overallComment === 'string' ? body.overallComment : state.p.evaluation.overallComment, privateNote: typeof body?.privateNote === 'string' ? body.privateNote : state.p.evaluation.privateNote } };
      return { status: 200, body: { ok: true, revision: state.rev, gradePercent: null } };
    };
    return { state, handle };
  }

  async function open(width: number, srv: ReturnType<typeof server>, start: 'evaluation' | 'mine' = 'evaluation') {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: width < 700 });
    const errors: string[] = []; const dialogs: string[] = []; const requests: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      requests.push(`${route.request().method()} ${url.pathname}`);
      if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="root"></div></body></html>` });
      const raw = route.request().postData();
      const r = srv.handle(route.request().method(), url.pathname, raw ? JSON.parse(raw) : null);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.addScriptTag({ content: bundle });
    await page.evaluate((s) => (window as unknown as Record<string, () => void>)[s === 'mine' ? '__startMine' : '__startEvaluation'](), start);
    await page.waitForSelector(start === 'mine' ? '[data-testid="my-evaluations"]' : '[data-testid="evaluation"]');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const log = () => page.evaluate(() => (window as unknown as { __log: string[] }).__log);
    const saved = () => page.waitForFunction(() => document.querySelector('[data-testid="eval-save-state"]')?.textContent === 'All changes saved', null, { timeout: 8000 });
    return { page, errors, dialogs, requests, overflow, log, saved };
  }
  const level = (page: import('playwright').Page, criterion: number, n: number) => page.locator('[data-testid="eval-criterion"]').nth(criterion).getByRole('radio', { name: String(n), exact: true });

  it('wide screen: the application on the left and the grid on the right, side by side; the files open through the platform; a score changes the ring and shows the level\'s description', async () => {
    const srv = server();
    const { page, errors, dialogs } = await open(1280, srv);
    const a = await page.locator('[data-testid="eval-application"]').boundingBox(); const s = await page.locator('[data-testid="eval-score"]').boundingBox();
    expect(a && s && a.x + a.width <= s.x + 1).toBe(true);
    expect(await page.locator('[data-testid="eval-tab-application"]').isVisible()).toBe(false);          // tabs only on smaller screens
    expect(await page.locator('[data-testid="eval-answer"]').count()).toBe(3);
    const href = await page.locator('[data-testid="answer-files"] a').getAttribute('href');
    expect(href).toBe('/api/calls/c1/evaluations/a1/documents/file-1');
    expect(href).not.toContain('supabase');
    expect(await page.locator('[data-testid="eval-title"]').innerText()).toBe('REF-001 · Acme Robotics');
    expect(await page.locator('[data-testid="eval-deadline"]').innerText()).toContain('3 days left');
    const before = await page.locator('[data-testid="grade-ring-text"]').innerText();
    await level(page, 0, 5).click();
    expect(await page.locator('[data-testid="eval-level-text"]').first().innerText()).toBe('an excellent, complete team');
    await level(page, 1, 3).click(); await level(page, 2, 10).click();
    expect(await page.locator('[data-testid="grade-ring-text"]').innerText()).not.toBe(before);
    expect(await page.locator('[data-testid="eval-grade"]').innerText()).toContain('3 of 3 criteria scored');
    await level(page, 0, 1).click();
    expect(await page.locator('[data-testid="eval-below"]').innerText()).toContain('Team (1 < 2)');
    expect(await page.getByRole('button', { name: /^save/i }).count()).toBe(0);                          // nothing to press: it saves by itself
    await page.screenshot({ path: path.join(SHOTS, 'evaluation-1280.png'), fullPage: true });
    expect(errors).toEqual([]);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('autosave: a moment after the change it is sent with the revision it was based on, only what changed; the state says so; a comment is saved too', async () => {
    const srv = server();
    const { page, saved } = await open(1280, srv);
    await level(page, 0, 4).click();
    expect(await page.locator('[data-testid="eval-save-state"]').innerText()).toBe('Not saved yet…');
    await saved();
    expect(srv.state.puts[0]).toEqual({ scores: { k1: { score: 4 } }, revision: 0 });
    await page.locator('[data-testid="eval-criterion"]').nth(0).locator('[data-testid="eval-add-comment"]').click();
    await page.locator('#cc-k1').fill('Strong founders.');
    await page.locator('#eval-overall').fill('A solid candidate.');
    await page.locator('#eval-note').fill('Ask about the cap table.');
    await saved();
    const last = srv.state.puts.at(-1)!;
    expect(last).toMatchObject({ scores: { k1: { comment: 'Strong founders.' } }, overallComment: 'A solid candidate.', privateNote: 'Ask about the cap table.', revision: 1 });
    expect(srv.state.p.evaluation.scores.k1).toEqual({ score: 4, comment: 'Strong founders.' });
    // reload: what was typed is what comes back
    await page.close();
  }, 120_000);

  it('submit says exactly what is missing; once complete it asks IN the page, then the evaluation is read-only', async () => {
    const srv = server();
    const { page, dialogs, saved } = await open(1280, srv);
    await level(page, 0, 4).click(); await level(page, 1, 3).click();
    await page.locator('[data-testid="eval-submit"]').click();
    await page.locator('[data-testid="eval-confirm-yes"]').click();
    await page.waitForSelector('[data-testid="eval-error"]');
    expect(await page.locator('[data-testid="eval-error"]').innerText()).toContain('Before submitting: 2 things missing.');
    expect(await page.locator('[data-testid="eval-criterion"][data-missing="comment"]').count()).toBe(1);
    expect(await page.locator('[data-testid="eval-criterion"][data-missing="score"]').count()).toBe(1);
    expect(srv.state.submits).toBe(0);
    await page.locator('#cc-k2').fill('Crowded but growing.');
    await level(page, 2, 8).click();
    await saved();
    await page.locator('[data-testid="eval-submit"]').click();
    expect(await page.locator('[data-testid="eval-confirm"]').innerText()).toContain('After this you cannot change it');
    await page.locator('[data-testid="eval-confirm-no"]').click();
    expect(srv.state.submits).toBe(0);
    await page.locator('[data-testid="eval-submit"]').click();
    await page.locator('[data-testid="eval-confirm-yes"]').click();
    await page.waitForSelector('[data-testid="eval-submitted"]');
    expect(srv.state.submits).toBe(1);
    expect(await page.locator('[data-testid="eval-submitted"]').innerText()).toContain('It is read-only');
    expect(await level(page, 0, 4).isDisabled()).toBe(true);
    expect(await page.locator('#eval-overall').isDisabled()).toBe(true);
    expect(await page.locator('[data-testid="eval-submit"]').count()).toBe(0);
    expect(dialogs).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, 'submitted-1280.png'), fullPage: true });
    await page.close();
  }, 120_000);

  it('blind: the screen says who applied is hidden and shows the application exactly as the server masked it', async () => {
    const srv = server(payload({ blind: true, application: { id: 'a1', reference: 'REF-001', startupName: null, submittedAt: '2026-10-10T10:00:00Z', version: 1 }, answers: { f1: '[hidden]', f2: '[hidden] builds robots.', f3: [{ fileId: 'file-1', fileName: 'Permanent Certificate — document 1.pdf', size: 2048 }] } as never,
      documents: [{ fileId: 'file-1', fieldId: 'f3', fileName: 'Permanent Certificate — document 1.pdf', size: 2048, url: '/api/calls/c1/evaluations/a1/documents/file-1' }] }));
    const { page } = await open(1280, srv);
    expect(await page.locator('[data-testid="eval-blind"]').innerText()).toContain('who applied is hidden');
    expect(await page.locator('[data-testid="eval-title"]').innerText()).toBe('REF-001');
    expect(await page.locator('[data-testid="answer-files"] a').innerText()).toBe('Permanent Certificate — document 1.pdf');
    expect(await page.locator('[data-testid="eval-application"]').innerText()).not.toContain('Acme');
    await page.close();
  }, 120_000);

  it('"I have a conflict" is a form in the page with an optional reason; confirming records it and returns to the list', async () => {
    const srv = server();
    const { page, log, dialogs } = await open(1280, srv);
    await page.locator('[data-testid="eval-conflict"]').click();
    expect(await page.locator('[data-testid="eval-conflict-form"]').innerText()).toContain('only administrators see it');
    await page.locator('#conflict-note').fill('I advised them last year.');
    await page.locator('[data-testid="eval-conflict-yes"]').click();
    await page.waitForFunction(() => (window as unknown as { __log: string[] }).__log.includes('back'));
    expect(srv.state.conflicts).toEqual([{ note: 'I advised them last year.' }]);
    expect(await log()).toContain('back');
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('a save refused because it was changed in another window says so and offers "Reload"; nothing typed is thrown away', async () => {
    const srv = server(payload(), { failSave: 'conflict' });
    const { page } = await open(1280, srv);
    await level(page, 0, 4).click();
    await page.waitForSelector('[data-testid="eval-error"]');
    expect(await page.locator('[data-testid="eval-save-state"]').innerText()).toBe('Changed in another window');
    expect(await page.locator('[data-testid="eval-error"] button').innerText()).toBe('Reload');
    expect(await level(page, 0, 4).getAttribute('aria-checked')).toBe('true');                           // still showing what was chosen
    await page.close();
  }, 120_000);

  it('an administrator sees the submitted evaluations with the private notes, and reopens one with a reason, in the page', async () => {
    const srv = server(payload({ role: 'admin', canEdit: false, canReopen: true, colleagues: [{ userId: 'u9', evaluator: 'Rita Almeida', scores: { k1: { score: 5, comment: 'great' }, k2: { score: 4, comment: 'ok' }, k3: { score: 9, comment: '' } }, overallComment: 'Impressive.', gradePercent: 90, privateNote: 'Secret remark' }] }));
    const { page, dialogs } = await open(1280, srv);
    expect(await page.locator('[data-testid="eval-colleague"]').innerText()).toContain('Rita Almeida · 90 %');
    expect(await page.locator('[data-testid="eval-colleague-note"]').innerText()).toContain('Secret remark');
    await page.locator('[data-testid="eval-reopen"]').click();
    expect(await page.locator('[data-testid="eval-reopen-yes"]').isDisabled()).toBe(true);               // a reason is required
    await page.locator('#reopen-reason').fill('The market score was a typo.');
    await page.locator('[data-testid="eval-reopen-yes"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="eval-reopen-form"]').length === 0);
    expect(srv.state.reopens).toEqual([{ evaluatorUserId: 'u9', reason: 'The market score was a typo.' }]);
    expect(dialogs).toEqual([]);
    await page.close();
  }, 120_000);

  it('tablet and phone: two tabs — only one pane at a time; nothing is wider than the screen at 1280, 768 and 375 (screenshots kept)', async () => {
    for (const width of [1280, 768, 375]) {
      const srv = server();
      const { page, overflow } = await open(width, srv);
      if (width < 1024) {
        expect(await page.locator('[data-testid="eval-application"]').isVisible()).toBe(true);
        expect(await page.locator('[data-testid="eval-score"]').isVisible()).toBe(false);
        expect(await overflow(), `${width}px, application`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: path.join(SHOTS, `evaluation-${width}-application.png`), fullPage: true });
        await page.locator('[data-testid="eval-tab-score"]').click();
        expect(await page.locator('[data-testid="eval-application"]').isVisible()).toBe(false);
        expect(await page.locator('[data-testid="eval-score"]').isVisible()).toBe(true);
      }
      await level(page, 0, 5).click();
      await page.locator('[data-testid="eval-criterion"]').nth(2).locator('[data-testid="eval-add-comment"]').click();
      expect(await overflow(), `${width}px, score`).toBeLessThanOrEqual(0);
      const bad = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="evaluation"]') as HTMLElement; const r = root.getBoundingClientRect(); const out: string[] = [];
        for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) { const b = el.getBoundingClientRect(); if (b.width === 0) continue; if (b.right > r.right + 0.5 || b.left < r.left - 0.5) out.push(`${el.tagName}.${String(el.className).slice(0, 30)}`); }
        return out;
      });
      expect(bad, `${width}px`).toEqual([]);
      if (width < 1024) await page.screenshot({ path: path.join(SHOTS, `evaluation-${width}-score.png`), fullPage: true });
      await page.close();
    }
  }, 240_000);

  const MINE: MineCall[] = [
    { callId: 'c1', callName: 'Innovation call 2027 with_a_very_long_unbroken_call_name_that_cannot_wrap_anywhere_1234567890', timezone: 'Europe/Lisbon', blind: false, closed: false, deadline: { day: '2026-12-15', daysLeft: 1 }, total: 3, notStarted: 1, inProgress: 1, submitted: 1, remaining: 2,
      items: [{ applicationId: 'a1', reference: 'REF-001', startupName: 'Acme Robotics', state: 'submitted', gradePercent: 82.5, updatedAt: null }, { applicationId: 'a2', reference: 'REF-002', startupName: 'Blue Health', state: 'in_progress', gradePercent: null, updatedAt: null }, { applicationId: 'a3', reference: 'REF-003', startupName: null, state: 'not_started', gradePercent: null, updatedAt: null }] },
    { callId: 'c2', callName: 'Seed call', timezone: 'Europe/Lisbon', blind: true, closed: true, deadline: null, total: 1, notStarted: 0, inProgress: 0, submitted: 1, remaining: 0, items: [{ applicationId: 'b1', reference: 'REF-010', startupName: null, state: 'submitted', gradePercent: 70, updatedAt: null }] },
  ];

  it('"My evaluations": each call with its deadline and progress, each application with where it stands and the right button; empty says what to expect; nothing is wider than the screen', async () => {
    for (const width of [1280, 768, 375]) {
      const { page, log, overflow } = await open(width, server(payload(), { mine: MINE }), 'mine');
      await page.waitForSelector('[data-testid="mine-call"]');
      expect(await page.locator('[data-testid="mine-call"]').count()).toBe(2);
      expect(await page.locator('[data-testid="mine-progress"]').first().innerText()).toBe('1 of 3 submitted · 2 remaining');
      expect(await page.locator('[data-testid="mine-deadline"]').first().innerText()).toContain('1 day left');
      expect(await page.locator('[data-testid="mine-state"]').allInnerTexts()).toEqual(['Submitted', 'In progress', 'Not started', 'Submitted']);
      expect(await page.locator('[data-testid="mine-open"]').allInnerTexts()).toEqual(['View', 'Continue', 'Start', 'View']);
      expect(await overflow(), `${width}px`).toBeLessThanOrEqual(0);
      if (width === 375) await page.screenshot({ path: path.join(SHOTS, 'mine-375.png'), fullPage: true });
      if (width === 1280) await page.screenshot({ path: path.join(SHOTS, 'mine-1280.png'), fullPage: true });
      await page.locator('[data-testid="mine-open"]').nth(2).click();
      expect(await log()).toEqual(expect.arrayContaining(['open c1/a3', 'count 2']));
      await page.close();
    }
    const empty = await open(1280, server(payload(), { mine: [] }), 'mine');
    await empty.page.waitForSelector('[data-testid="mine-empty"]');
    expect(await empty.page.locator('[data-testid="mine-empty"]').innerText()).toContain('you get an email');
    await empty.page.close();
  }, 240_000);
});
