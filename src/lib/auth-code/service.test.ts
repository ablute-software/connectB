// Prompt 904 Part B — the guarantees of "register with a 6-digit code", checked against a
// fake world that models (a) the SQL functions of migration 20261009120000 line by line and
// (b) the slice of Supabase Auth we rely on: ONE live code per email, which expires, which
// dies on first success.
//
// What this does NOT prove, and says so: that the REAL GoTrue invalidates the previous code
// when a new one is sent. That is a property of Supabase, modelled here as an assumption; it
// is proved against production with a real mailbox (docs/calls/ETAPA0_PARTE_B_CODIGO.md).
import { describe, expect, it } from 'vitest';
import {
  MAX_SENDS_PER_WINDOW, MAX_WRONG_ATTEMPTS, MIN_REQUEST_DURATION_MS, RESEND_MIN_INTERVAL_SECONDS,
  SEND_WINDOW_SECONDS,
} from './policy';
import { requestCode, verifyRegistrationCode, type AuthCodePorts } from './service';

const PROFILE = { fullName: 'Ana Test', startup: 'zz-test-startup', country: 'Portugal', role: 'CEO' };
const PASSWORD = 'Correct-Horse-9!';
const CODE_TTL_MS = 30 * 60 * 1000;

interface Mail { kind: 'code' | 'already-registered'; email: string; code?: string }

function world(opts: { ipLimited?: boolean; createFails?: boolean; finalizeFails?: boolean } = {}) {
  let clock = 1_700_000_000_000;
  let nextCode = 100000;
  const sendState = new Map<string, { lastSent: number | null; winStart: number | null; winCount: number; wrong: number; needsNew: boolean }>();
  const users = new Map<string, { id: string; confirmed: boolean; finalized: boolean }>();
  const otp = new Map<string, { code: string; expiresAt: number }>();
  const mails: Mail[] = [];
  const errors: string[] = [];
  const sleeps: number[] = [];
  let verifyCalls = 0;
  const calls = { reserveAttempt: 0 };

  const issue = (email: string) => {
    const code = String(nextCode++);
    otp.set(email, { code, expiresAt: clock + CODE_TTL_MS });
    mails.push({ kind: 'code', email, code });
    return code;
  };

  const ports: AuthCodePorts = {
    async ipLimited() { return opts.ipLimited === true; },
    async reserveSend(email) {
      let r = sendState.get(email);
      if (!r) { r = { lastSent: null, winStart: null, winCount: 0, wrong: 0, needsNew: true }; sendState.set(email, r); }
      if (r.lastSent !== null && r.lastSent + RESEND_MIN_INTERVAL_SECONDS * 1000 > clock) {
        return { allowed: false, reason: 'too_early', retryAfterSeconds: Math.ceil((r.lastSent + RESEND_MIN_INTERVAL_SECONDS * 1000 - clock) / 1000) };
      }
      if (r.winStart === null || r.winStart + SEND_WINDOW_SECONDS * 1000 <= clock) { r.winStart = clock; r.winCount = 0; }
      if (r.winCount >= MAX_SENDS_PER_WINDOW) {
        return { allowed: false, reason: 'hourly_cap', retryAfterSeconds: Math.ceil((r.winStart + SEND_WINDOW_SECONDS * 1000 - clock) / 1000) };
      }
      r.winCount += 1; r.lastSent = clock; r.wrong = 0; r.needsNew = false;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    async reserveAttempt(email) {
      calls.reserveAttempt += 1;
      const r = sendState.get(email);
      if (!r) return { allowed: false, reason: 'no_code', attemptsLeft: 0 };
      if (r.needsNew || r.wrong >= MAX_WRONG_ATTEMPTS) { r.needsNew = true; return { allowed: false, reason: 'locked', attemptsLeft: 0 }; }
      r.wrong += 1;
      return { allowed: true, attemptsLeft: MAX_WRONG_ATTEMPTS - r.wrong };
    },
    async markUsed(email) { const r = sendState.get(email); if (r) { r.needsNew = true; r.wrong = 0; } },
    async userState(email) { const u = users.get(email); return { exists: !!u, confirmed: !!u?.confirmed }; },
    async createAccountAndSendCode(email) {
      if (opts.createFails) throw new Error('smtp: rate limit exceeded');
      users.set(email, { id: `user-${users.size + 1}`, confirmed: false, finalized: false });
      issue(email);
    },
    async resendCode(email) { issue(email); },
    async sendAlreadyRegisteredEmail(email) { mails.push({ kind: 'already-registered', email }); },
    async verifyCode(email, code) {
      verifyCalls += 1;
      const live = otp.get(email);
      if (!live || live.code !== code || live.expiresAt <= clock) return { ok: false };
      otp.delete(email); // single-use
      const u = users.get(email)!;
      u.confirmed = true;
      return { ok: true, userId: u.id };
    },
    async finalizeAccount(userId) {
      if (opts.finalizeFails) return { ok: false, error: 'Password is too weak for this project.' };
      for (const u of users.values()) if (u.id === userId) u.finalized = true;
      return { ok: true };
    },
    now: () => clock,
    async sleep(ms) { sleeps.push(ms); clock += ms; },
    logError: (where, err) => { errors.push(`${where}: ${err instanceof Error ? err.message : String(err)}`); },
  };

  return {
    ports, users, otp, mails, errors, sleeps, calls,
    advance(ms: number) { clock += ms; },
    get verifyCalls() { return verifyCalls; },
    get clock() { return clock; },
    register: (email: string, ip = '1.1.1.1') => requestCode(ports, { email, profile: PROFILE, password: PASSWORD, ip }, { allowCreate: true }),
    resend: (email: string, ip = '1.1.1.1') => requestCode(ports, { email, profile: PROFILE, ip }, { allowCreate: false }),
    verify: (email: string, code: string, password = PASSWORD) => verifyRegistrationCode(ports, { email, code, password, profile: PROFILE, ip: '1.1.1.1' }),
    lastCode: (email: string) => [...mails].reverse().find((m) => m.email === email && m.kind === 'code')?.code ?? '',
  };
}

describe('register — sending the code', () => {
  it('creates an unconfirmed account and sends one code', async () => {
    const w = world();
    const r = await w.register('new@example.com');
    expect(r.status).toBe(200);
    expect(w.users.get('new@example.com')).toMatchObject({ confirmed: false, finalized: false });
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0].code).toMatch(/^\d{6}$/);
  });

  it('refuses malformed input without sending anything or spending a send', async () => {
    const w = world();
    const bad = await requestCode(w.ports, { email: 'not-an-email', profile: PROFILE, password: PASSWORD, ip: 'x' }, { allowCreate: true });
    const weak = await requestCode(w.ports, { email: 'a@example.com', profile: PROFILE, password: 'short', ip: 'x' }, { allowCreate: true });
    expect(bad.status).toBe(400);
    expect(weak.status).toBe(400);
    expect(w.mails).toHaveLength(0);
    // Not rate-limited either: a typo does not burn the 60 s gap for the real address.
    expect((await w.register('a@example.com')).status).toBe(200);
  });

  it('never stores or forwards the typed password at creation (it is applied only after the code)', async () => {
    const w = world();
    await w.register('new@example.com');
    expect(w.users.get('new@example.com')!.finalized).toBe(false);
  });
});

describe('no oracle — an email with an account looks exactly like one without', () => {
  it('returns the identical body for a new, an unconfirmed and a confirmed email', async () => {
    const w = world();
    // confirmed account
    await w.register('known@example.com');
    await w.verify('known@example.com', w.lastCode('known@example.com'));
    w.advance(61_000);
    // unconfirmed account
    await w.register('pending@example.com');

    const clean = (r: Awaited<ReturnType<typeof w.register>>, email: string) => JSON.parse(JSON.stringify(r).replaceAll(email, '<EMAIL>'));
    const brandNew = clean(await w.register('brand-new@example.com'), 'brand-new@example.com');
    const confirmed = clean(await w.register('known@example.com'), 'known@example.com');
    w.advance(61_000);
    const unconfirmed = clean(await w.register('pending@example.com'), 'pending@example.com');

    expect(confirmed).toEqual(brandNew);
    expect(unconfirmed).toEqual(brandNew);
    expect(brandNew.body.message).toBe('We sent a code to <EMAIL>.');
  });

  it('tells the holder of a confirmed account, by email, that they already have one — and creates nothing', async () => {
    const w = world();
    await w.register('known@example.com');
    await w.verify('known@example.com', w.lastCode('known@example.com'));
    w.advance(61_000);
    const usersBefore = w.users.size;
    await w.register('known@example.com');
    expect(w.mails.at(-1)).toEqual({ kind: 'already-registered', email: 'known@example.com' });
    expect(w.users.size).toBe(usersBefore);
    expect(w.mails.filter((m) => m.kind === 'code')).toHaveLength(1); // no second code issued
  });

  it('answers every branch no faster than the floor, so timing does not tell them apart', async () => {
    const w = world();
    await w.register('known@example.com');
    await w.verify('known@example.com', w.lastCode('known@example.com'));
    w.advance(61_000);
    for (const email of ['known@example.com', 'someone-new@example.com']) {
      const before = w.clock;
      await w.register(email);
      expect(w.clock - before).toBeGreaterThanOrEqual(MIN_REQUEST_DURATION_MS);
    }
  });

  it('resend for an email with no account answers like a real one and sends nothing', async () => {
    const w = world();
    const real = await w.register('real@example.com');
    const ghost = await w.resend('ghost@example.com');
    const strip = (r: unknown, e: string) => JSON.parse(JSON.stringify(r).replaceAll(e, '<E>'));
    expect(strip(ghost, 'ghost@example.com')).toEqual(strip(real, 'real@example.com'));
    expect(w.mails.filter((m) => m.email === 'ghost@example.com')).toHaveLength(0);
  });

  it('the "too early" answer is the same for an email with no account', async () => {
    const w = world();
    await w.resend('ghost@example.com');
    const again = await w.resend('ghost@example.com');
    expect(again.status).toBe(429);
    expect(again.body).toMatchObject({ code: 'too_early' });
  });

  it('a provider failure does not change what the person is told (and is logged for us)', async () => {
    const ok = world();
    const failing = world({ createFails: true });
    const a = await ok.register('x@example.com');
    const b = await failing.register('x@example.com');
    expect(b).toEqual(a);
    expect(failing.errors).toEqual(['requestCode: smtp: rate limit exceeded']);
  });
});

describe('resend — the server enforces the gap and the cap', () => {
  it('refuses a resend before 60 s, with the wait, and allows it after', async () => {
    const w = world();
    await w.register('a@example.com');
    w.advance(30_000);
    const early = await w.resend('a@example.com');
    expect(early.status).toBe(429);
    // The fake clock also ran through the response-time floor (1.5 s), so ~28.5 s remain.
    expect(early.body).toMatchObject({ code: 'too_early' });
    expect((early.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(20);
    expect((early.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(w.mails).toHaveLength(1); // nothing sent while refused
    w.advance(31_000);
    expect((await w.resend('a@example.com')).status).toBe(200);
    expect(w.mails).toHaveLength(2);
  });

  it('refuses a register immediately after a register too (the gap is per email, not per button)', async () => {
    const w = world();
    await w.register('a@example.com');
    expect((await w.register('a@example.com')).status).toBe(429);
  });

  it('caps the codes per email per hour', async () => {
    const w = world();
    await w.register('a@example.com');
    for (let i = 1; i < MAX_SENDS_PER_WINDOW; i++) { w.advance(61_000); expect((await w.resend('a@example.com')).status).toBe(200); }
    w.advance(61_000);
    const capped = await w.resend('a@example.com');
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({ code: 'hourly_cap' });
    w.advance(SEND_WINDOW_SECONDS * 1000);
    expect((await w.resend('a@example.com')).status).toBe(200);
  });

  it('answers 429 when the network is over its limit, before sending anything', async () => {
    const w = world({ ipLimited: true });
    const r = await w.register('a@example.com');
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: 'ip_limited' });
    expect(w.mails).toHaveLength(0);
  });
});

describe('verify — wrong, expired, used, replaced', () => {
  it('a correct code confirms, applies the typed password and succeeds', async () => {
    const w = world();
    await w.register('a@example.com');
    const r = await w.verify('a@example.com', w.lastCode('a@example.com'));
    expect(r).toEqual({ status: 200, body: { ok: true, passwordSet: true } });
    expect(w.users.get('a@example.com')).toMatchObject({ confirmed: true, finalized: true });
  });

  it('a wrong code never confirms and says how many attempts are left', async () => {
    const w = world();
    await w.register('a@example.com');
    const r = await w.verify('a@example.com', '000000');
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, code: 'wrong_code', attemptsLeft: 4 });
    expect(w.users.get('a@example.com')!.confirmed).toBe(false);
  });

  it('an expired code never confirms', async () => {
    const w = world();
    await w.register('a@example.com');
    const code = w.lastCode('a@example.com');
    w.advance(CODE_TTL_MS + 1000);
    const r = await w.verify('a@example.com', code);
    expect(r.body).toMatchObject({ ok: false, code: 'wrong_code' });
    expect(w.users.get('a@example.com')!.confirmed).toBe(false);
  });

  it('a code works once: the same code again is refused', async () => {
    const w = world();
    await w.register('a@example.com');
    const code = w.lastCode('a@example.com');
    expect((await w.verify('a@example.com', code)).status).toBe(200);
    const again = await w.verify('a@example.com', code);
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ code: 'new_code_required' });
  });

  it('asking for a new code invalidates the previous one', async () => {
    const w = world();
    await w.register('a@example.com');
    const first = w.lastCode('a@example.com');
    w.advance(61_000);
    await w.resend('a@example.com');
    const second = w.lastCode('a@example.com');
    expect(second).not.toBe(first);
    expect((await w.verify('a@example.com', first)).body).toMatchObject({ code: 'wrong_code' });
    expect((await w.verify('a@example.com', second)).status).toBe(200);
  });

  it('five wrong attempts force a new code — even the right code is then refused', async () => {
    const w = world();
    await w.register('a@example.com');
    const right = w.lastCode('a@example.com');
    const answers = [];
    for (let i = 0; i < MAX_WRONG_ATTEMPTS; i++) answers.push(await w.verify('a@example.com', '000000'));
    expect(answers.slice(0, 4).map((a) => a.body)).toMatchObject([
      { code: 'wrong_code', attemptsLeft: 4 }, { attemptsLeft: 3 }, { attemptsLeft: 2 }, { attemptsLeft: 1 },
    ]);
    expect(answers[4].body).toMatchObject({ code: 'new_code_required' });

    const sixth = await w.verify('a@example.com', right);
    expect(sixth.body).toMatchObject({ code: 'new_code_required' });
    expect(w.users.get('a@example.com')!.confirmed).toBe(false);
    expect(w.verifyCalls).toBe(MAX_WRONG_ATTEMPTS); // the 6th never even reached Supabase
  });

  it('the fifth attempt may still be the right one', async () => {
    const w = world();
    await w.register('a@example.com');
    const right = w.lastCode('a@example.com');
    for (let i = 0; i < MAX_WRONG_ATTEMPTS - 1; i++) await w.verify('a@example.com', '000000');
    expect((await w.verify('a@example.com', right)).status).toBe(200);
  });

  it('a new code gives a fresh set of five attempts', async () => {
    const w = world();
    await w.register('a@example.com');
    for (let i = 0; i < MAX_WRONG_ATTEMPTS; i++) await w.verify('a@example.com', '000000');
    w.advance(61_000);
    await w.resend('a@example.com');
    const r = await w.verify('a@example.com', '000000');
    expect(r.body).toMatchObject({ code: 'wrong_code', attemptsLeft: 4 });
    expect((await w.verify('a@example.com', w.lastCode('a@example.com'))).status).toBe(200);
  });

  it('parallel guesses each spend an attempt: no more than five reach Supabase', async () => {
    const w = world();
    await w.register('a@example.com');
    await Promise.all(Array.from({ length: 12 }, () => w.verify('a@example.com', '000000')));
    expect(w.verifyCalls).toBe(MAX_WRONG_ATTEMPTS);
  });

  it('an email nobody asked a code for gets the same "new code" answer, whatever the account', async () => {
    const w = world();
    const r = await w.verify('never-asked@example.com', '123456');
    expect(r.body).toMatchObject({ ok: false, code: 'new_code_required' });
    expect(w.verifyCalls).toBe(0);
  });

  it('malformed input is refused without spending an attempt', async () => {
    const w = world();
    await w.register('a@example.com');
    expect((await w.verify('a@example.com', '12ab56')).status).toBe(400);
    expect((await w.verify('a@example.com', '12345')).status).toBe(400);
    expect((await w.verify('a@example.com', w.lastCode('a@example.com'), 'weak')).status).toBe(400);
    expect(w.calls.reserveAttempt).toBe(0);
  });

  it('when the code is right but the password step fails, the person is told, not logged out of the truth', async () => {
    const w = world({ finalizeFails: true });
    await w.register('a@example.com');
    const r = await w.verify('a@example.com', w.lastCode('a@example.com'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, passwordSet: false, warning: 'Password is too weak for this project.' });
    expect(w.users.get('a@example.com')!.confirmed).toBe(true);
  });

  it('answers 429 when the network is over its verify limit, before counting an attempt', async () => {
    const w = world();
    await w.register('a@example.com');
    const limited = { ...w.ports, ipLimited: async () => true };
    const r = await verifyRegistrationCode(limited, { email: 'a@example.com', code: '123456', password: PASSWORD, profile: PROFILE, ip: 'x' });
    expect(r.status).toBe(429);
    expect(w.calls.reserveAttempt).toBe(0);
  });
});
