// Prompt 900, Part C — the /login branch of the REAL middleware: a signed-in person whose startup org is dead is sent
// to the hat they still hold, never to the founder app of the org that ended.
//
// Same approach as middleware.test.ts / middleware-viewer.test.ts: drive the real middleware over a mocked Supabase
// client whose answers the test controls, rather than a copy of the rule. The door (account_access_state) is a
// controlled answer here — what it ANSWERS is SQL and is proved in scripts/verify-closed-deleted-900.sql; what this file
// proves is the wiring on this side of it: the redirect after the door has let the person through.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Rows = Record<string, Record<string, unknown>[]>;
const h = vi.hoisted(() => ({
  door: 'active' as string,
  ecosystem: false,
  tables: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => {
    // select().eq()…maybeSingle() → first row; awaiting the chain → all rows. Filters are not needed: one person per fixture.
    const chain = (table: string) => {
      const rows = () => h.tables[table] ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = {
        select: () => c, eq: () => c, in: () => c, limit: () => c,
        maybeSingle: async () => ({ data: rows()[0] ?? null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows() }).then(res),
      };
      return c;
    };
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'alexandrameira.ablute@example.test' } } }) },
      rpc: async (name: string) => {
        if (name === 'account_access_state') return { data: h.door };
        if (name === 'has_active_incubator_membership') return { data: h.ecosystem, error: null };
        return { data: null };
      },
      from: (table: string) => chain(table),
    };
  },
}));

let middleware: (req: import('next/server').NextRequest) => Promise<import('next/server').NextResponse>;
let NextRequest: typeof import('next/server').NextRequest;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-test';
  ({ NextRequest } = await import('next/server'));
  ({ middleware } = await import('./middleware'));
});

function world(over: { org?: Record<string, unknown> | null; investorSeat?: boolean }): Rows {
  return {
    platform_admins: [],
    org_members: over.org === null ? [] : [{ org_id: 'o1' }],
    orgs: over.org === null ? [] : [over.org ?? { closed_at: null, moderation_status: 'active' }],
    matchdeal_investor_members: over.investorSeat ? [{ id: 'seat' }] : [],
    access_grants: [],
    investor_entity_claims: [],
  };
}

beforeEach(() => { h.door = 'active'; h.ecosystem = false; h.tables = world({}); });

async function loginTarget(path = '/login'): Promise<string> {
  const res = await middleware(new NextRequest(new URL(path, 'https://www.sherlockdeal.com'), { method: 'GET' }));
  expect(res.status).toBe(307);
  const to = new URL(res.headers.get('location') ?? '', 'https://www.sherlockdeal.com');
  return to.pathname + to.search;
}

// Prompt 923 (A) — the decision of WHERE a signed-in person goes moved out of the middleware, which used to carry a lighter copy of the rule (and sent every founder to /pipeline and everybody else to /portal), into
// /go and src/lib/areas.ts (areas.test.ts, src/app/go/go-route.test.ts: a deleted or closed org is no founder area there, a firm member lands in the firm, ...). This file proves the wiring on THIS side:
// every signed-in visit to /login or /signup goes through /go, whatever the person is, and the door still wins over it.
describe('middleware /login and /signup — a signed-in person goes through /go (Prompt 923)', () => {
  it.each([
    ['a live org', { org: { closed_at: null, moderation_status: 'active' } }, false],
    ['a deleted org and an ecosystem membership', { org: { closed_at: null, moderation_status: 'deleted' } }, true],
    ['a deleted org and an investor seat', { org: { closed_at: null, moderation_status: 'deleted' }, investorSeat: true }, false],
    ['a closed org', { org: { closed_at: '2026-09-30T10:00:00Z', moderation_status: 'active' } }, true],
    ['nothing at all', { org: null }, false],
  ])('%s → /go', async (_name, w, ecosystem) => {
    h.tables = world(w as { org?: Record<string, unknown> | null; investorSeat?: boolean }); h.ecosystem = ecosystem;
    expect(await loginTarget('/login')).toBe('/go');
    expect(await loginTarget('/signup')).toBe('/go');
  });

  it('the choice made on the investor sign-in page travels with the person: /login?as=investor → /go?as=investor', async () => {
    expect(await loginTarget('/login?as=investor')).toBe('/go?as=investor');
    expect(await loginTarget('/signup?as=investor')).toBe('/go?as=investor');
    expect(await loginTarget('/login?as=anything-else')).toBe('/go');
  });

  it('and the door still wins over every redirect: a suspended answer sends /login to /suspended', async () => {
    h.door = 'suspended';
    h.tables = world({ org: { closed_at: null, moderation_status: 'suspended' } });
    h.ecosystem = true;
    expect(await loginTarget('/login')).toBe('/suspended');
  });
});
