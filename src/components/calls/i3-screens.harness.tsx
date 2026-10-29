// Prompt 924 (I3) — a host for the three REAL screens of this increment, bundled into a real browser by i3-screens.browser.test.ts: the applicant's contestation (ApplicantResult), the queue of whoever handles
// contestations (ContestationsPanel) and Results → Close (ClosePanel). The server is a stub of `fetch` that applies the real pure rules (parseAnswer, confirmationMatches, cleanReason, retentionState).
// Test-only: nothing in the app imports it.
import { createRoot } from 'react-dom/client';
import { cleanPostponeReason, cleanReason, parseAnswer, retentionState, type CloseView, type ContestInfo, type ContestationRow, type ContestationsView } from '@/lib/calls/contestations';
import { confirmationMatches } from '@/lib/calls/results';
import { ApplicantResult } from './applicant/ApplicantResult';
import { ClosePanel } from './ClosePanel';
import { ContestationsPanel } from './ContestationsPanel';

type Opts = { screen: 'applicant'; contest: ContestInfo } | { screen: 'contestations'; enabled?: boolean; rows: ContestationRow[] } | { screen: 'close'; close: Partial<CloseView> };
declare global { interface Window { __startI3: (o: Opts) => void; __i3Requests: { method: string; url: string; body: unknown }[] } }

const NAME = 'Seed Call 2027';
const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });

window.__startI3 = (o) => {
  window.__i3Requests = [];
  const log = (method: string, url: string, body: unknown) => window.__i3Requests.push({ method, url, body });
  if (o.screen === 'applicant') {
    let contest = o.contest;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null;
      log(method, url, body);
      if (url.endsWith('/result')) return reply(200, { ok: true, result: { label: 'Not selected', subject: `${NAME}: Not selected`, html: '<p>Dear Ana,</p><p>Thank you for applying. Blue Health was not selected this time.</p>', grade: null, kind: 'reject', publishedAt: '2026-11-01T10:00:00.000Z', movedOn: false }, contest });
      if (url.endsWith('/contest') && method === 'POST') {
        const r = cleanReason(body.reason);
        if (!r.ok) return reply(400, { ok: false, error: r.error });
        contest = { state: 'done', deadline: contest.deadline, contestation: { status: 'open', reason: r.text, response: null, answeredAt: null, hasFile: !!body.storagePath, fileName: body.fileName ?? null } };
        return reply(200, { ok: true, contestation: contest.contestation });
      }
      return reply(404, { ok: false });
    }) as typeof fetch;
    createRoot(document.getElementById('root')!).render(<div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}><ApplicantResult applicationId="app-1" orgId="org-1" timezone="Europe/Lisbon" /></div>);
    return;
  }
  if (o.screen === 'contestations') {
    const rows = o.rows.map((r) => ({ ...r }));
    const labels = { advance: 'Selected', reject: 'Not selected', waitlist: 'Waiting list' } as const;
    const view = (): ContestationsView => ({ ok: true, enabled: o.enabled !== false, days: 10, open: rows.filter((r) => r.status === 'open').length, rows, labels: { ...labels } });
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null;
      log(method, url, body);
      if (method === 'GET') return reply(200, view());
      const a = parseAnswer(body);
      if (!a.ok) return reply(400, { ok: false, error: a.error });
      const row = rows.find((r) => r.id === body.contestationId)!;
      row.status = a.answer.outcome; row.answeredAt = '2026-11-05T10:00:00.000Z'; row.response = a.answer.response || null;
      if (a.answer.outcome === 'upheld') row.newLabel = labels[a.answer.newResult];
      return reply(200, view());
    }) as typeof fetch;
    createRoot(document.getElementById('root')!).render(<div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}><ContestationsPanel callId="call-1" /></div>);
    return;
  }
  let close: CloseView = {
    ok: true, status: 'closed', blockers: [], canComplete: true, completedAt: null, summary: { total: 4, counts: { advance: 1, reject: 2, waitlist: 1 } }, contestations: { enabled: true, open: 0, total: 1 },
    retention: { ...retentionState({ purgeAfter: null, extendedAt: null, purgedAt: null, now: new Date() }), months: 24, reason: null }, timezone: 'Europe/Lisbon', callName: NAME, ...o.close,
  };
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null;
    log(method, url, body);
    if (method === 'GET') return reply(200, close);
    if (body.action === 'complete') {
      if (!confirmationMatches(body.confirmName, NAME)) return reply(400, { ok: false, error: 'Type the name of the call to confirm.' });
      close = { ...close, status: 'completed', canComplete: false, completedAt: '2026-11-20T10:00:00.000Z', retention: { ...retentionState({ purgeAfter: '2028-11-20T10:00:00.000Z', extendedAt: null, purgedAt: null, now: new Date('2026-11-20T10:00:00Z') }), months: 24, reason: null } };
      return reply(200, close);
    }
    const r = cleanPostponeReason(body.reason);
    if (!r.ok) return reply(400, { ok: false, error: r.error });
    close = { ...close, retention: { ...close.retention, purgeAfter: '2029-05-20T10:00:00.000Z', extendedAt: '2026-11-21T10:00:00.000Z', canPostpone: false, reason: r.text } };
    return reply(200, close);
  }) as typeof fetch;
  createRoot(document.getElementById('root')!).render(<div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}><ClosePanel callId="call-1" /></div>);
};
