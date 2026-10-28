// Prompt 923 — a host for the REAL CallEditor, bundled into a real browser by call-editor-access.browser.test.ts. The server is a stub of `fetch`: the call's state says what the person may do
// (configure / view all applications / evaluate), and every other request is answered 403, as the server does for what the person may not do. Test-only: nothing in the app imports it.
import { createRoot } from 'react-dom/client';
import { CallEditor } from './CallEditor';

declare global { interface Window { __startEditor: (o: { configure: boolean; viewApplications: boolean; evaluate: boolean; status: string }) => void; __requests: string[] } }

const CALL_ID = 'call-1';

window.__startEditor = ({ configure, viewApplications, evaluate, status }) => {
  window.__requests = [];
  const call = {
    id: CALL_ID, promoterKind: 'catalog_entity', promoterId: 'firm-1', name: 'Seed Call', description: null, opensAt: null, closesAt: null, timezone: 'Europe/Lisbon', visibility: 'public', limitUnit: 'per_startup',
    allowMultiple: false, contentLanguage: 'en', currency: 'EUR', status, linkToken: null, configVersion: 1, validatedAt: null, publishedAt: null, closedAt: null, archivedAt: null, duplicatedFrom: null,
    createdBy: 'ana', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
  const state = {
    ok: true, call, effectiveStatus: status, promoterName: 'zz-test-firm', canManage: configure, canManageTeam: configure, canViewApplications: viewApplications, canEvaluate: evaluate,
    phases: [], fields: [], issues: [], teamMembers: 1, eligibilityRules: 0, evalCriteria: 0, branding: { coverUrl: null, logoUrl: null, logoSource: null, profileLogoUrl: null },
    summary: { phases: 0, pages: 0, fields: 0, questions: 0, documents: 0, required: 0, mapped: 0 },
    actions: { canDelete: true, canArchive: false, status }, applications: { submitted: 0, total: 0 }, events: [],
  };
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    window.__requests.push(`${init?.method ?? 'GET'} ${url}`);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
    if ((init?.method ?? 'GET') === 'GET' && url === `/api/calls/${CALL_ID}`) return reply(200, state);
    return reply(403, { ok: false, error: 'You do not have the permission on this call.' });
  }) as typeof fetch;
  createRoot(document.getElementById('root')!).render(<CallEditor callId={CALL_ID} onBack={() => {}} />);
};
