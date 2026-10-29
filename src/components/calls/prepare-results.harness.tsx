// Prompt 924 — a host for the REAL PrepareResults, bundled into a real browser by prepare-results.browser.test.ts. The server is a stub of `fetch` that applies the REAL pure rules of results.ts (counts, labels,
// default messages, cleaning of a patch, the message of an application), so what the screen shows is what the routes would answer. Test-only: nothing in the app imports it.
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_SETTINGS, PLACEHOLDERS, RESULT_KEYS, blockersOf, buildMessage, cleanFeedback, defaultMessage, labelOf, messageOf, outcomeOf, parseSettingsPatch, summarise,
  type AppFacts, type PrepareView, type ResultKey, type ResultSettings,
} from '@/lib/calls/results';
import { PrepareResults } from './PrepareResults';

declare global { interface Window { __startPrepare: (o: { apps: AppFacts[]; hasNext?: boolean; status?: string }) => void; __prepareRequests: { method: string; url: string; body: unknown }[] } }

const CALL_ID = 'call-1';

window.__startPrepare = ({ apps: initial, hasNext = false, status = 'closed' }) => {
  window.__prepareRequests = [];
  let settings: ResultSettings = { ...DEFAULT_SETTINGS, labels: {}, messages: {} };
  const apps = initial.map((a) => ({ ...a }));
  const call = { name: 'Seed Call 2027', contentLanguage: 'en' };
  const view = (): PrepareView => {
    const s = summarise(apps);
    const labels = Object.fromEntries(RESULT_KEYS.map((k) => [k, labelOf(k, settings, hasNext)])) as Record<ResultKey, string>;
    return {
      ok: true, settings, labels,
      messages: Object.fromEntries(RESULT_KEYS.map((k) => [k, messageOf(k, settings, 'en', hasNext)])) as Record<ResultKey, string>,
      defaults: { labels: Object.fromEntries(RESULT_KEYS.map((k) => [k, labelOf(k, { labels: {} }, hasNext)])) as Record<ResultKey, string>, messages: Object.fromEntries(RESULT_KEYS.map((k) => [k, defaultMessage(k, 'en', hasNext)])) as Record<ResultKey, string> },
      placeholders: PLACEHOLDERS, phase: { id: 'p1', name: 'Phase 1', hasNext },
      summary: { total: s.total, counts: s.counts, byEligibility: s.byEligibility, pending: s.pending.map((p) => ({ applicationId: p.applicationId, reference: p.reference, startupName: p.startupName })) },
      blockers: blockersOf({ summary: s, callStatus: status, alreadyPublished: false }),
      applications: apps.map((a) => { const o = outcomeOf(a); return { applicationId: a.applicationId, reference: a.reference, startupName: a.startupName, result: o.result, label: o.result ? labels[o.result] : null, source: o.source, feedback: a.feedback ?? '', grade: a.grade }; }),
      callStatus: status, language: 'en', timezone: 'Europe/Lisbon', locked: false, lockedReason: null,
    };
  };
  const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    window.__prepareRequests.push({ method, url, body });
    if (url !== `/api/calls/${CALL_ID}/results`) return reply(404, { ok: false });
    if (method === 'GET') return reply(200, view());
    if (method === 'PUT') {
      const p = parseSettingsPatch(body);
      if (!p.ok) return reply(400, { ok: false, error: p.error });
      settings = { ...settings, ...p.patch };
      return reply(200, view());
    }
    const a = apps.find((x) => x.applicationId === body.applicationId);
    if (!a) return reply(404, { ok: false, error: 'That application is not in this phase of the call.' });
    if (body.action === 'feedback') { const c = cleanFeedback(body.text); if (!c.ok) return reply(400, { ok: false, error: c.error }); a.feedback = c.text || null; return reply(200, view()); }
    const message = buildMessage({ settings, call, entityName: 'Portugal Ventures', app: a, applicantName: `Founder of ${a.startupName}`, hasNextPhase: hasNext, formatDay: (d) => d });
    return message ? reply(200, { ok: true, message }) : reply(409, { ok: false, error: 'This application has no decision yet, so there is no message to preview.' });
  }) as typeof fetch;
  createRoot(document.getElementById('root')!).render(<div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}><PrepareResults callId={CALL_ID} onOpenEvaluation={() => { document.title = 'went-to-evaluation'; }} /></div>);
};
