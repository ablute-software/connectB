// Redeeming a seat code: at most 5 wrong tries per person per hour. The count is taken BEFORE the answer is known,
// a locked person is refused even with the right code, one submission is one try, the lock lifts by itself when the
// hour is up, and a limiter that cannot answer fails closed. (The SQL itself was proved by a dry run in production.)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addUser, fakeSeatAdmin, seatDb, type SeatDb } from '@/test/fake-seat-db';

vi.mock('./resend', () => ({
  resendConfigured: true,
  sendTransactionalEmail: async () => ({ sent: true }),
  transactionalTemplate: () => '<p>x</p>',
}));

import { makeSeatStore } from './investor-firm-seats-store';
import {
  SEAT_CODE_ATTEMPT_WINDOW_SECONDS, SEAT_CODE_MAX_ATTEMPTS, SEAT_CODE_REFUSED, createSeatCode, generateSeatCode, redeemSeatCode,
} from './investor-firm-seats';

const FIRM = 'ent-zz-test-firm';
let db: SeatDb;
let store: ReturnType<typeof makeSeatStore>;

async function owner(userId: string) {
  addUser(db, userId, `${userId}@zz-test-firm.com`);
  db.tables.investor_entity_claims.push({ id: `c-${userId}`, catalog_entity_id: FIRM, claimant_user_id: userId, claimant_email: `${userId}@zz-test-firm.com`, status: 'approved' });
  await fakeSeatAdmin(db).from('matchdeal_investor_members').insert({ user_id: userId, catalog_entity_id: FIRM, status: 'active', role: 'member' });
}
// The refusals carry a status; a success would not, and no wrong code ever succeeds.
const wrong = async (userId: string) => (await redeemSeatCode(store, { code: generateSeatCode(), userId })) as { ok: boolean; status: number; error: string };
const newCode = async () => (await createSeatCode(store, { entityId: FIRM, seats: 10, actor: 'bo', now: new Date(db.clock) }) as { code: string }).code;

beforeEach(async () => {
  db = seatDb();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', website: 'https://zz-test-firm.com', is_test: true });
  store = makeSeatStore(fakeSeatAdmin(db));
  await owner('u-owner');
});

describe('the limit', () => {
  it('is 5 tries per hour', () => {
    expect(SEAT_CODE_MAX_ATTEMPTS).toBe(5);
    expect(SEAT_CODE_ATTEMPT_WINDOW_SECONDS).toBe(3600);
  });

  it('five wrong codes are answered as always; the sixth is refused as too many attempts, with the minutes', async () => {
    for (let i = 0; i < 5; i++) expect(await wrong('u-owner'), `try ${i + 1}`).toEqual({ ok: false, status: 400, error: SEAT_CODE_REFUSED });
    const sixth = await wrong('u-owner');
    expect(sixth).toMatchObject({ ok: false, status: 429 });
    expect((sixth as { error: string }).error).toMatch(/^Too many attempts\. Try again in \d+ minutes?\.$/);
  });

  it('a locked person is refused even with the RIGHT code, and the code stays unused', async () => {
    const code = await newCode();
    for (let i = 0; i < 5; i++) await wrong('u-owner');
    expect(await redeemSeatCode(store, { code, userId: 'u-owner' })).toMatchObject({ ok: false, status: 429 });
    expect(db.tables.investor_seat_codes[0].status).toBe('active');
    expect(await store.getPlan(FIRM)).toBeNull();
  });

  it('the right code on the fifth try still works, and clears the count', async () => {
    const code = await newCode();
    for (let i = 0; i < 4; i++) await wrong('u-owner');
    expect(await redeemSeatCode(store, { code, userId: 'u-owner' })).toMatchObject({ ok: true, seats: 10 });
    expect(db.tables.seat_code_attempts).toEqual([]);
  });

  it('after a success the count starts again from zero', async () => {
    const first = await newCode();
    for (let i = 0; i < 3; i++) await wrong('u-owner');
    expect((await redeemSeatCode(store, { code: first, userId: 'u-owner' })).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect((await wrong('u-owner')).status).toBe(400);
    expect((await wrong('u-owner')).status).toBe(429);
  });

  it('the lock lifts by itself when the hour is up', async () => {
    const code = await newCode();
    for (let i = 0; i < 6; i++) await wrong('u-owner');
    expect((await wrong('u-owner')).status).toBe(429);
    db.clock += (SEAT_CODE_ATTEMPT_WINDOW_SECONDS + 1) * 1000;
    expect(await redeemSeatCode(store, { code, userId: 'u-owner' })).toMatchObject({ ok: true });
  });

  it('is per person: one person locked does not lock another', async () => {
    await owner('u-other');
    for (let i = 0; i < 6; i++) await wrong('u-owner');
    expect((await wrong('u-owner')).status).toBe(429);
    expect((await wrong('u-other')).status).toBe(400);
  });

  it('one submission is ONE try, however many spellings of it are looked up', async () => {
    await wrong('u-owner');
    expect(db.tables.seat_code_attempts).toMatchObject([{ user_id: 'u-owner', wrong_attempts: 1 }]);
    await redeemSeatCode(store, { code: 'abcd-efgh', userId: 'u-owner' }); // looked up with and without the PD prefix
    expect(db.tables.seat_code_attempts[0].wrong_attempts).toBe(2);
  });

  it('a text that cannot be a code is refused without counting as a try', async () => {
    for (const code of ['', 'PD-ABC', 'x', 'A'.repeat(60)]) expect(await redeemSeatCode(store, { code, userId: 'u-owner' })).toEqual({ ok: false, status: 400, error: SEAT_CODE_REFUSED });
    expect(db.tables.seat_code_attempts).toEqual([]);
  });

  it('fails CLOSED when the limiter cannot answer: nothing is redeemed', async () => {
    const code = await newCode();
    const broken = { ...store, reserveRedeemAttempt: async () => ({ checked: false, allowed: false, retryAfter: 0 }) };
    const r = await redeemSeatCode(broken, { code, userId: 'u-owner' });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(db.tables.investor_seat_codes[0].status).toBe('active');
  });
});
