// Prompt 538 — the regression guard for the bug that made every founder
// signup fail for a month: /api/provision-org was not in PUBLIC, so the
// unauthenticated POST that signup makes (email confirmation means
// signUp() returns no session) was redirected to /login, and the route
// never executed at all.
//
// This drives the real middleware, not a copy of its PUBLIC list — the bug
// was precisely that the list and the route's expectations disagreed, so a
// test asserting against a duplicated list would have passed throughout.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

// The middleware always calls supabase.auth.getUser(); stub the client so
// the test never touches the network. `user: null` IS the case under test —
// an unauthenticated caller.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: 'active' }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

let middleware: (req: import('next/server').NextRequest) => Promise<import('next/server').NextResponse>;
let NextRequest: typeof import('next/server').NextRequest;

beforeAll(async () => {
  // Set BEFORE importing: absent env vars are demo mode, which lets
  // everything through and would make every assertion here vacuous.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-test';
  ({ NextRequest } = await import('next/server'));
  ({ middleware } = await import('./middleware'));
});

function post(path: string) {
  return new NextRequest(new URL(path, 'https://www.sherlockdeal.com'), { method: 'POST' });
}
function get(path: string) {
  return new NextRequest(new URL(path, 'https://www.sherlockdeal.com'), { method: 'GET' });
}

describe('middleware — unauthenticated API access', () => {
  it('lets POST /api/provision-org through instead of redirecting it to /login', async () => {
    const res = await middleware(post('/api/provision-org'));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });

  // Prompt 904 Part B — the code-registration routes are called by people who have no session
  // yet (that is the point of registering). Without this entry every POST would 307 to /login,
  // the exact failure of Prompts 538/749. The page that hosts the form is NOT public.
  it('lets the unauthenticated auth-code routes through, but not the test page', async () => {
    for (const path of ['/api/auth-code/register', '/api/auth-code/resend', '/api/auth-code/verify']) {
      const res = await middleware(post(path));
      expect(res.status, path).not.toBe(307);
      expect(res.headers.get('location'), path).toBeNull();
    }
    const page = await middleware(get('/auth-code-test'));
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toContain('/login');
  });

  // Prompt 905 — the public link of a call and its header are for people with no account; the rest of Calls is not.
  it('lets the public call link through, but not the Calls API or the editor', async () => {
    for (const path of ['/call/abcdefghijklmnopqrstuv', '/api/calls/public/abcdefghijklmnopqrstuv']) {
      const res = await middleware(get(path));
      expect(res.status, path).not.toBe(307);
    }
    for (const path of ['/api/calls', '/api/calls/some-id', '/api/calls/access']) {
      const res = await middleware(get(path));
      expect(res.status, path).toBe(307);
      expect(res.headers.get('location'), path).toContain('/login');
    }
  });

  it('still redirects any other unauthenticated API POST to /login', async () => {
    const res = await middleware(post('/api/anything-else'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/login');
    expect(location).toContain('next=%2Fapi%2Fanything-else');
  });

  it('does not open the rest of the app: an unauthenticated page still redirects', async () => {
    const res = await middleware(post('/pipeline'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  // Prompt 923 (A): /go answers a signed-out visit ITSELF (it sends the person back to /login keeping the investor side and the link-failed fall-back). Behind this middleware's own redirect the visit arrived at
  // /login?next=/go with neither — the code fall-back after an expired or pre-fetched magic link was lost.
  it('lets a signed-out visit to /go through to its own handler, query and all, instead of redirecting it to /login', async () => {
    const res = await middleware(get('/go?as=investor&linkFailed=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('is an exact-path allowance, not a prefix that opens sibling routes', async () => {
    // Nothing lives under /api/provision-org today; this pins that adding
    // one later does not inherit the exemption by accident.
    const res = await middleware(post('/api/provision-org-something-else'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  // Prompt 749/750 merge — found live in production, the same class of bug
  // this file's own header describes: /api/plan-credits was built
  // specifically so the anonymous landing page could read live AI-credit
  // numbers (PricingSection.tsx), but was never added here. An anonymous
  // GET 307'd to /login instead of returning JSON, so the landing page's
  // fetch silently failed and always rendered the no-live-number fallback
  // — never wrong data, just never the live number the prompt asked for.
  it('lets GET /api/plan-credits through unauthenticated (the anonymous landing page reads it)', async () => {
    const res = await middleware(get('/api/plan-credits'));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });
});

// 22/10/2026 — the bug of Prompts 538 and 749 once more, for the one caller that has no session by definition: the platform's own cron. vercel.json calls GET /api/automations daily;
// the route was not on PUBLIC, so every call was answered 307 → /login and the daily tick (monthly delivery, reminders, purge of deleted calls, digests, re-scans) never ran on its own.
// The path is not made public — anyone could then run it. What passes is exactly one request: that path, with the header Vercel adds when the project has CRON_SECRET.
describe('middleware — the platform cron may call the daily tick, and nobody else without a session', () => {
  const SECRET = 'f3a9c1d5e7b2468a0c9d1e3f5a7b9c0d2e4f6a8b0c1d3e5f7a9b1c3d5e7f9a0b';
  const call = (path: string, authorization?: string, method = 'GET') =>
    new NextRequest(new URL(path, 'https://www.sherlockdeal.com'), { method, headers: authorization === undefined ? {} : { authorization } });
  afterEach(() => { delete process.env.CRON_SECRET; });

  it('lets Vercel\'s cron through: GET /api/automations with «Authorization: Bearer <CRON_SECRET>»', async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await middleware(call('/api/automations', `Bearer ${SECRET}`));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
  });

  it('the path is NOT public by itself: without the header it is sent to /login (this is exactly what the cron used to get)', async () => {
    process.env.CRON_SECRET = SECRET;
    const res = await middleware(call('/api/automations'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.headers.get('location')).toContain('next=%2Fapi%2Fautomations');
  });

  it.each([
    ['a wrong secret', 'Bearer 0000000000000000000000000000000000000000000000000000000000000000'],
    ['the secret without «Bearer»', SECRET],
    ['a lower-case scheme', `bearer ${SECRET}`],
    ['the secret with something appended', `Bearer ${SECRET}x`],
  ])('%s is still sent to /login', async (_label, header) => {
    process.env.CRON_SECRET = SECRET;
    const res = await middleware(call('/api/automations', header));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('FAILS CLOSED when the variable is not set — or is too short to be a secret — whatever the header says', async () => {
    delete process.env.CRON_SECRET;
    for (const header of ['Bearer undefined', 'Bearer ', 'Bearer', `Bearer ${SECRET}`]) {
      const res = await middleware(call('/api/automations', header));
      expect(res.status, header).toBe(307);
    }
    process.env.CRON_SECRET = 'short';
    const res = await middleware(call('/api/automations', 'Bearer short'));
    expect(res.status).toBe(307);
  });

  it('the secret opens THAT path only — not another API route, not the back office, not a sub-path, not a page', async () => {
    process.env.CRON_SECRET = SECRET;
    for (const path of ['/api/automations/x', '/api/pipeline-unlock', '/api/backoffice/metrics/overview', '/api/org/update', '/pipeline', '/backoffice']) {
      const res = await middleware(call(path, `Bearer ${SECRET}`));
      expect(res.status, path).toBe(307);
      expect(res.headers.get('location'), path).toContain('/login');
    }
  });
});
