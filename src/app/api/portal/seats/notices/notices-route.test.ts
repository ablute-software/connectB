// Prompt 904 Adenda 1 — the "You've been added to X" notice route: only the signed-in user's own CONFIRMED
// address is looked up, a notice is shown until it is dismissed, and dismissing someone else's changes nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addUser, fakeSeatAdmin, seatDb, type SeatDb } from '@/test/fake-seat-db';

let db: SeatDb;
let currentUser: { id: string; email: string | null; email_confirmed_at: string | null } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeSeatAdmin(db) }));
vi.mock('@/lib/supabase-server', () => ({
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));

import { GET, POST } from './route';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';

const json = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  db = seatDb();
  db.tables.catalog_entities.push({ id: 'ent-1', name: 'zz-test-firm' });
  addUser(db, 'u-ana', 'ana@external.com');
  const store = makeSeatStore(fakeSeatAdmin(db));
  await store.addNotice('ana@external.com', 'ent-1', 'bo-1');
  currentUser = { id: 'u-ana', email: 'Ana@External.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
});

describe('GET /api/portal/seats/notices', () => {
  it('shows the notice to the confirmed address it was left for, with the firm\'s name', async () => {
    const body = await (await GET()).json();
    expect(body).toMatchObject({ ok: true, notices: [{ firmName: 'zz-test-firm' }] });
  });

  it('shows nothing to someone else, to an unconfirmed address, or to a signed-out caller', async () => {
    currentUser = { id: 'u-bob', email: 'bob@external.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
    expect((await (await GET()).json()).notices).toEqual([]);
    currentUser = { id: 'u-ana', email: 'ana@external.com', email_confirmed_at: null };
    expect((await (await GET()).json()).notices).toEqual([]);
    currentUser = null;
    expect((await GET()).status).toBe(401);
  });
});

describe('POST /api/portal/seats/notices', () => {
  it('dismissing marks it seen, so it does not come back', async () => {
    const first = (await (await GET()).json()).notices as { id: string }[];
    expect((await (await POST(json({ ids: first.map((n) => n.id) }))).json()).ok).toBe(true);
    expect((await (await GET()).json()).notices).toEqual([]);
  });

  it('cannot dismiss another address\'s notice', async () => {
    const first = (await (await GET()).json()).notices as { id: string }[];
    currentUser = { id: 'u-bob', email: 'bob@external.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
    await POST(json({ ids: first.map((n) => n.id) }));
    currentUser = { id: 'u-ana', email: 'ana@external.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
    expect((await (await GET()).json()).notices).toHaveLength(1);
  });
});
