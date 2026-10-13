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

async function loginDestination(): Promise<string> {
  const res = await middleware(new NextRequest(new URL('/login', 'https://www.sherlockdeal.com'), { method: 'GET' }));
  expect(res.status).toBe(307);
  return new URL(res.headers.get('location') ?? '', 'https://www.sherlockdeal.com').pathname;
}

describe('middleware /login — a signed-in person with a dead startup org (Prompt 900)', () => {
  it('a live org → /pipeline, exactly as before', async () => {
    expect(await loginDestination()).toBe('/pipeline');
  });

  it('deleted org + ecosystem membership → /ecosystem, not the founder app of the dead org', async () => {
    h.tables = world({ org: { closed_at: null, moderation_status: 'deleted' } });
    h.ecosystem = true;
    expect(await loginDestination()).toBe('/ecosystem');
  });

  it('deleted org + active investor seat → /portal', async () => {
    h.tables = world({ org: { closed_at: null, moderation_status: 'deleted' }, investorSeat: true });
    expect(await loginDestination()).toBe('/portal');
  });

  it('deleted org and nothing else (if the door ever let them through) → the public landing, never /pipeline', async () => {
    h.tables = world({ org: { closed_at: null, moderation_status: 'deleted' } });
    expect(await loginDestination()).toBe('/');
  });

  it('a closed org (closed_at) is dead too', async () => {
    h.tables = world({ org: { closed_at: '2026-09-30T10:00:00Z', moderation_status: 'active' } });
    h.ecosystem = true;
    expect(await loginDestination()).toBe('/ecosystem');
  });

  it('suspended org keeps the founder hat at this layer — the door is what blocks it', async () => {
    h.tables = world({ org: { closed_at: null, moderation_status: 'suspended' } });
    h.ecosystem = true;
    expect(await loginDestination()).toBe('/pipeline');
  });

  it('and the door still wins over every redirect: a suspended answer sends /login to /suspended', async () => {
    h.door = 'suspended';
    h.tables = world({ org: { closed_at: null, moderation_status: 'suspended' } });
    h.ecosystem = true;
    expect(await loginDestination()).toBe('/suspended');
  });
});
