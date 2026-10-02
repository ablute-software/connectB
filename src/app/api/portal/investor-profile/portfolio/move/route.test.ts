// Prompt AL759 §C — the move route, driven through its real handler with the
// four boundary modules mocked (session, viewer guard, firm membership, the
// Supabase client) and an in-memory table behind the fake client, so the
// assertions are about what the route actually writes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  id: string; investor_catalog_entity_id: string; status: 'current' | 'past'; company_name: string;
  exit_at: string | null; exit_type: string | null; source: string; created_at: string; updated_at: string;
  linked_org_id: string | null; link_status: string;
};

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  viewerBlocked: false,
  member: { catalog_entity_id: 'firm-A' } as { catalog_entity_id: string } | null,
  rows: [] as Row[],
  lastPatch: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase-server', () => ({
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));
vi.mock('@/lib/developer-viewer', async () => {
  const { NextResponse } = await import('next/server');
  return { assertNotViewer: async () => (h.viewerBlocked ? NextResponse.json({ ok: false, error: 'read-only' }, { status: 403 }) : null) };
});
vi.mock('@/lib/investor-membership', () => ({ resolveActiveInvestorMember: async () => h.member }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      let patch: Record<string, unknown> | null = null;
      let cols: string[] | null = null;
      const pick = (r: Row) => (cols ? Object.fromEntries(cols.map((c) => [c, (r as unknown as Record<string, unknown>)[c]])) : r);
      const b = {
        select(c?: string) { cols = c ? c.split(',').map((x) => x.trim()) : null; return b; },
        update(p: Record<string, unknown>) { patch = p; h.lastPatch = p; return b; },
        in(col: string, vals: string[]) { filters.push((r) => vals.includes((r as unknown as Record<string, string>)[col])); return b; },
        eq(col: string, v: string) { filters.push((r) => (r as unknown as Record<string, string>)[col] === v); return b; },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          const matched = h.rows.filter((r) => filters.every((f) => f(r)));
          if (patch) for (const r of matched) Object.assign(r, patch);
          return Promise.resolve({ data: matched.map(pick), error: null }).then(resolve);
        },
      };
      return b;
    },
  }),
}));

import { POST } from './route';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CREATED = '2026-09-01T10:00:00.000Z';

function row(n: number, over: Partial<Row> = {}): Row {
  return {
    id: uuid(n), investor_catalog_entity_id: 'firm-A', status: 'current', company_name: `Co ${n}`, exit_at: null, exit_type: null,
    source: 'import', created_at: CREATED, updated_at: CREATED, linked_org_id: null, link_status: 'unlinked', ...over,
  };
}

function call(body: unknown) {
  return POST(new Request('http://x/api/portal/investor-profile/portfolio/move', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  h.user = { id: 'user-1' };
  h.viewerBlocked = false;
  h.member = { catalog_entity_id: 'firm-A' };
  h.lastPatch = null;
  h.rows = [];
});

describe('POST /portfolio/move — Prompt AL759 §C', () => {
  it('moves 3 ids from Current to Past: status changes, source/created_at/link columns do not', async () => {
    h.rows = [row(1), row(2), row(3), row(4)];
    const res = await call({ ids: [uuid(1), uuid(2), uuid(3)], to: 'past' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, moved: 3, clearedExitData: 0 });
    expect(h.rows.map((r) => r.status)).toEqual(['past', 'past', 'past', 'current']);
    for (const r of h.rows) {
      expect(r.source).toBe('import');
      expect(r.created_at).toBe(CREATED);
      expect(r.linked_org_id).toBeNull();
      expect(r.link_status).toBe('unlinked');
    }
    expect(h.rows[0].updated_at).not.toBe(CREATED);
    expect(h.rows[3].updated_at).toBe(CREATED);
    // Moving to Past never touches the exit columns.
    expect(h.lastPatch).not.toHaveProperty('exit_at');
  });

  it('moves Past to Current: exit_at/exit_type are cleared, and clearedExitData counts only rows that had some', async () => {
    h.rows = [
      row(1, { status: 'past', exit_at: '2023-09-01', exit_type: 'acquisition' }),
      row(2, { status: 'past', exit_type: 'ipo' }),
      row(3, { status: 'past' }),
    ];
    const res = await call({ ids: [uuid(1), uuid(2), uuid(3)], to: 'current' });
    expect(await res.json()).toEqual({ ok: true, moved: 3, clearedExitData: 2 });
    for (const r of h.rows) {
      expect(r.status).toBe('current');
      expect(r.exit_at).toBeNull();
      expect(r.exit_type).toBeNull();
    }
  });

  it('ignores ids that belong to another investor: not moved, not counted, not an error', async () => {
    h.rows = [row(1), row(2, { investor_catalog_entity_id: 'firm-B' }), row(3)];
    const res = await call({ ids: [uuid(1), uuid(2), uuid(3)], to: 'past' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, moved: 2, clearedExitData: 0 });
    expect(h.rows.find((r) => r.id === uuid(2))?.status).toBe('current');
  });

  it('a request made only of foreign or unknown ids answers exactly like "moved nothing" (200, moved 0), never 403/404', async () => {
    h.rows = [row(2, { investor_catalog_entity_id: 'firm-B', status: 'past', exit_at: '2024-01-01' })];
    const res = await call({ ids: [uuid(2), uuid(99)], to: 'current' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, moved: 0, clearedExitData: 0 });
    // And the other firm's exit data is untouched.
    expect(h.rows[0].exit_at).toBe('2024-01-01');
    expect(h.rows[0].status).toBe('past');
  });

  it('a developer viewer is blocked before anything is written', async () => {
    h.viewerBlocked = true;
    h.rows = [row(1)];
    const res = await call({ ids: [uuid(1)], to: 'past' });
    expect(res.status).toBe(403);
    expect(h.rows[0].status).toBe('current');
  });

  it('no session -> 401', async () => {
    h.user = null;
    h.rows = [row(1)];
    expect((await call({ ids: [uuid(1)], to: 'past' })).status).toBe(401);
    expect(h.rows[0].status).toBe('current');
  });

  it('no linked investor firm -> 403 (same as every other Portfolio route)', async () => {
    h.member = null;
    expect((await call({ ids: [uuid(1)], to: 'past' })).status).toBe(403);
  });

  it('501 ids -> 400; exactly 500 is accepted', async () => {
    const many = Array.from({ length: 501 }, (_, i) => uuid(i + 1));
    expect((await call({ ids: many, to: 'past' })).status).toBe(400);
    h.rows = many.slice(0, 500).map((_, i) => row(i + 1));
    const ok = await call({ ids: many.slice(0, 500), to: 'past' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).moved).toBe(500);
  });

  it('empty ids, missing ids, an invalid "to", and non-uuid ids are all 400', async () => {
    expect((await call({ ids: [], to: 'past' })).status).toBe(400);
    expect((await call({ to: 'past' })).status).toBe(400);
    expect((await call({ ids: [uuid(1)], to: 'archived' })).status).toBe(400);
    expect((await call({ ids: [uuid(1)] })).status).toBe(400);
    expect((await call({ ids: ['not-a-uuid'], to: 'past' })).status).toBe(400);
    expect((await call({ ids: [uuid(1), 7], to: 'past' })).status).toBe(400);
  });

  it('an unparseable body is a 400, not a crash', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });
});
