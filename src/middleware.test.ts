// Prompt 538 — the regression guard for the bug that made every founder
// signup fail for a month: /api/provision-org was not in PUBLIC, so the
// unauthenticated POST that signup makes (email confirmation means
// signUp() returns no session) was redirected to /login, and the route
// never executed at all.
//
// This drives the real middleware, not a copy of its PUBLIC list — the bug
// was precisely that the list and the route's expectations disagreed, so a
// test asserting against a duplicated list would have passed throughout.
import { describe, it, expect, vi, beforeAll } from 'vitest';

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

describe('middleware — unauthenticated API access', () => {
  it('lets POST /api/provision-org through instead of redirecting it to /login', async () => {
    const res = await middleware(post('/api/provision-org'));
    expect(res.status).not.toBe(307);
    expect(res.headers.get('location')).toBeNull();
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

  it('is an exact-path allowance, not a prefix that opens sibling routes', async () => {
    // Nothing lives under /api/provision-org today; this pins that adding
    // one later does not inherit the exemption by accident.
    const res = await middleware(post('/api/provision-org-something-else'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});
