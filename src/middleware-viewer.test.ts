// Prompt 904 — the viewer write gate, driven through the REAL middleware (src/middleware.test.ts's approach: a
// copy of the rule would have passed while the wiring was wrong).
//
// Fixture: a signed-in session whose is_ablute_developer() answer the test controls, a request that may or may
// not carry the (unsigned, untrusted) viewer cookie.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ isDeveloper: true, rpcCalls: [] as string[] }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'dev@ablute.pt' } } }) },
    rpc: async (name: string) => {
      h.rpcCalls.push(name);
      if (name === 'is_ablute_developer') return { data: h.isDeveloper };
      return { data: 'active' };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'u1' } }), limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
  }),
}));

let middleware: (req: import('next/server').NextRequest) => Promise<import('next/server').NextResponse>;
let NextRequest: typeof import('next/server').NextRequest;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-test';
  ({ NextRequest } = await import('next/server'));
  ({ middleware } = await import('./middleware'));
});

beforeEach(() => { h.isDeveloper = true; h.rpcCalls = []; });

const COOKIE = 'sd_viewer_org_id=b0b0b0b0-0000-0000-0000-00000000000b:2026-10-12T10:00:00.000Z';
function call(method: string, path: string, withCookie = true) {
  return new NextRequest(new URL(path, 'https://www.sherlockdeal.com'), { method, headers: withCookie ? { cookie: COOKIE } : {} });
}

describe('middleware — Developer Viewer is read-only for the whole API', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s /api/<founder route> from a verified viewer session answers 403 viewer_read_only', async (method) => {
    const res = await middleware(call(method, '/api/market-thesis'));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: 'viewer_read_only' });
  });

  it('a route nobody wrapped is refused all the same', async () => {
    const res = await middleware(call('POST', '/api/a-route-added-next-month'));
    expect(res.status).toBe(403);
  });

  it('reads pass, and cost no is_ablute_developer round-trip', async () => {
    const res = await middleware(call('GET', '/api/market-thesis'));
    expect(res.status).not.toBe(403);
    expect(h.rpcCalls).not.toContain('is_ablute_developer');
  });

  it('a request without the cookie is not a viewer request: no check, no refusal', async () => {
    const res = await middleware(call('POST', '/api/market-thesis', false));
    expect(res.status).not.toBe(403);
    expect(h.rpcCalls).not.toContain('is_ablute_developer');
  });

  it('a forged cookie on a NON-developer session changes nothing', async () => {
    h.isDeveloper = false;
    const res = await middleware(call('POST', '/api/market-thesis'));
    expect(res.status).not.toBe(403);
    expect(h.rpcCalls).toContain('is_ablute_developer');
  });

  it('beacons are acknowledged and dropped', async () => {
    for (const path of ['/api/events/page-view', '/api/usage/heartbeat', '/api/product-events']) {
      const res = await middleware(call('POST', path));
      expect(res.status, path).toBe(200);
      expect(await res.json(), path).toEqual({ ok: true, ignored: 'viewer' });
    }
  });

  it('the surfaces on the allowlist still work inside a viewer session (entering/leaving it, the investor portal, webhooks)', async () => {
    for (const path of ['/api/backoffice/viewer/exit', '/api/backoffice/viewer/enter', '/api/portal/anything', '/api/terms/accept']) {
      const res = await middleware(call('POST', path));
      expect(res.status, path).not.toBe(403);
    }
  });
});
