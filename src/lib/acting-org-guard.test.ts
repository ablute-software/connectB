// Prompt 904 — the static half of the proof. These tests read the route sources and fail the build when the
// class of bug this prompt closed can be reopened by an edit nobody thinks twice about:
//
//   1. A founder route reads org_members to find "the current org" again (the exact line that made a Developer
//      Viewer session show the CALLER's org inside another startup's shell).
//   2. A route that writes is added without the viewer wrapper, so a viewer session could write through it.
//   3. A route resolves the acting org but forgets to wrap its GET (no viewer_read audit, no uniform rule).
//   4. Somebody lets a write through a viewer session, or ignores a beacon, without the reason being written
//      down where a reviewer will look: HERE.
//
// Every exception below is a decision with a reason. Adding one is a change to this file, in the diff.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const API = path.resolve(__dirname, '../app/api');

function routeFiles(dir = API, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

const rel = (file: string) => path.relative(API, file).split(path.sep).join('/').replace(/\/?route\.ts$/, '');
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const FILES = routeFiles().map((file) => ({ file, route: rel(file), src: read(file) }));

const HANDLER = /^export (?:async function|const) (GET|HEAD|POST|PUT|PATCH|DELETE)\b([^\n]*)/gm;
const WRAPPED = /=\s*(withActingOrg|withoutViewer)\(/;

function handlers(src: string): { method: string; wrapped: boolean }[] {
  return [...src.matchAll(HANDLER)].map((m) => ({ method: m[1], wrapped: WRAPPED.test(m[0]) }));
}

// ─── 1. no route finds "the current org" by reading org_members ─────────────────────────────────────────────
// The files that still mention `from('org_members')`, and why. The prompt's list, plus three per-user routes that
// answer about the CALLER's own membership row (a flag on it, or whether it exists) rather than about "the org".
const ORG_MEMBERS_EXCEPTIONS: Record<string, string> = {
  'backoffice/org-members': 'platform-admin tool, takes an explicit orgId (own gate: requirePlatformAdmin)',
  'backoffice/startups': 'platform-admin tool over every org (own gate: requirePlatformAdmin)',
  'account/change-password': 'the caller\'s own account — withoutViewer',
  'account/close-org': 'closes the caller\'s own org — withoutViewer',
  'account/owner-password-reset': 'an owner resetting a member\'s password — withoutViewer',
  'account/security': 'the caller\'s own security settings — withoutViewer',
  'invite/[token]/accept': 'accepting an invitation as the caller — withoutViewer',
  'provision-org': 'creates the caller\'s org and membership at sign-up — withoutViewer',
  'oauth/google/callback': 'links the caller\'s own mailbox — withoutViewer',
  'team/members': 'the roster IS the membership table; WHICH org it lists is resolveActingOrg\'s answer (read-only)',
  'team/members/[userId]': 'role changes / removals of a member — withoutViewer',
  'promo/redeem': 'billing of the caller\'s own org — withoutViewer',
  'promo/referrals': 'billing of the caller\'s own org — withoutViewer',
  'promo/status': 'billing of the caller\'s own org — withoutViewer',
  'stripe/checkout': 'billing of the caller\'s own org — withoutViewer',
  'stripe/portal': 'billing of the caller\'s own org — withoutViewer',
  'plan/request': 'a plan change of the caller\'s own org — withoutViewer',
  'commitments/seen': 'a flag on the CALLER\'s own membership row (not org data) — withoutViewer',
  'commitments/status': 'a flag on the CALLER\'s own membership row (not org data) — withoutViewer',
  'auth-code/status': 'does the signed-in CALLER own a startup yet (sign-up flow) — withoutViewer',
};

describe('no founder route resolves "the current org" from the caller\'s membership', () => {
  const offenders = FILES.filter((f) => f.src.includes("from('org_members')") && !(f.route in ORG_MEMBERS_EXCEPTIONS));

  it('zero from(\'org_members\') in src/app/api outside the documented exceptions', () => {
    expect(offenders.map((f) => f.route)).toEqual([]);
  });

  it('every exception is still real (no stale entries to hide behind)', () => {
    for (const route of Object.keys(ORG_MEMBERS_EXCEPTIONS)) {
      const f = FILES.find((x) => x.route === route);
      expect(f, `${route} no longer exists`).toBeDefined();
      expect(f!.src.includes("from('org_members')"), `${route} no longer reads org_members: drop it from the list`).toBe(true);
    }
  });

  it('every exception answers 403 viewer_read_only for every write (withoutViewer) — or is the read-only roster / an admin tool', () => {
    const READ_ONLY_OR_ADMIN = new Set(['backoffice/org-members', 'backoffice/startups', 'team/members']);
    for (const route of Object.keys(ORG_MEMBERS_EXCEPTIONS)) {
      if (READ_ONLY_OR_ADMIN.has(route)) continue;
      const f = FILES.find((x) => x.route === route)!;
      const hs = handlers(f.src);
      expect(hs.length, `${route} exports no handler`).toBeGreaterThan(0);
      for (const h of hs) expect(h.wrapped && /=\s*withoutViewer\(/.test(f.src), `${route} ${h.method} must be wrapped in withoutViewer()`).toBe(true);
    }
  });

  it('team/members lists the ACTING org (the one resolver), not whatever the caller belongs to', () => {
    const f = FILES.find((x) => x.route === 'team/members')!;
    expect(f.src).toMatch(/resolveActingOrg\(/);
    expect(f.src).toMatch(/=\s*withActingOrg\(/);
  });
});

// ─── 2. every write is behind the viewer wrapper ────────────────────────────────────────────────────────────
// A write handler outside these surfaces must be wrapped. src/lib/viewer-write-gate.ts (middleware) is the
// independent net under this list; a route here is either a different role's workspace or has no session.
const EXEMPT_WRITES: { match: RegExp; why: string }[] = [
  { match: /^backoffice(\/|$)/, why: 'platform-admin tools: each route runs requirePlatformAdmin(); they take explicit ids, and are how a viewer session is entered and left' },
  { match: /^portal(\/|$)/, why: 'the investor workspace — a different role; Prompt 904 §D: do not touch it' },
  { match: /^incubator(\/|$)/, why: 'the ecosystem-organisation workspace (incubator_members identity) — never the founder org being viewed' },
  { match: /^calls(\/|$)/, why: 'Calls belong to an investor firm or an ecosystem organisation' },
  { match: /^stripe\/(webhook|investor-checkout|investor-portal)$/, why: 'signed provider webhook / investor-firm billing' },
  { match: /^resend\/webhook$/, why: 'signed provider webhook' },
  { match: /^auth-code\/(register|resend|verify)$/, why: 'sign-in by code: the caller has no session yet' },
  { match: /^gdpr\/request$/, why: 'public privacy request' },
  { match: /^investor-access-request$/, why: 'public lead form' },
  { match: /^plan\/private-detective$/, why: 'public lead form' },
  { match: /^matchdeal\/pairing\/consume$/, why: 'one-time device token; the token is the authorisation' },
  { match: /^invite\/incubator\/(member\/)?\[token\]\/check-email$/, why: 'pre-session invitation check; changes nothing' },
  { match: /^terms\/accept$/, why: 'the caller\'s own legal acceptance, written to no organisation' },
];

describe('every write handler is wrapped by withActingOrg / withoutViewer', () => {
  const unwrapped = FILES.flatMap((f) =>
    handlers(f.src).filter((h) => h.method !== 'GET' && h.method !== 'HEAD' && !h.wrapped).map((h) => ({ route: f.route, method: h.method })),
  ).filter((x) => !EXEMPT_WRITES.some((e) => e.match.test(x.route)));

  it('no founder-side write is left unwrapped', () => {
    expect(unwrapped.map((x) => `${x.method} ${x.route}`)).toEqual([]);
  });

  it('every exempt pattern still matches something (no stale entries)', () => {
    for (const e of EXEMPT_WRITES) {
      const hit = FILES.some((f) => e.match.test(f.route) && handlers(f.src).some((h) => h.method !== 'GET' && h.method !== 'HEAD'));
      expect(hit, `${e.match} matches no write handler: drop it`).toBe(true);
      expect(e.why.length).toBeGreaterThan(15);
    }
  });
});

// ─── 3. a route that resolves the acting org wraps ALL its handlers ─────────────────────────────────────────
describe('a route that resolves the acting org is wrapped end to end', () => {
  const RESOLVES = /\b(resolveActingOrg|authorizeActingOrg|isViewerRequest|actingReader)\(/;
  const users = FILES.filter((f) => RESOLVES.test(f.src));

  it('there are many (the migration is real)', () => {
    expect(users.length).toBeGreaterThan(100);
  });

  it('every exported handler of those routes is wrapped (GET included: one audit point, one rule)', () => {
    const loose = users.flatMap((f) => handlers(f.src).filter((h) => !h.wrapped).map((h) => `${h.method} ${f.route}`));
    expect(loose).toEqual([]);
  });

  it('none of them still reads the viewer cookie by hand', () => {
    const ALLOWED = new Set(['me', 'backoffice/viewer/enter', 'backoffice/viewer/exit']);
    const hand = FILES.filter((f) => /\b(readVerifiedViewerOrgId|readViewerSession)\(/.test(f.src) && !ALLOWED.has(f.route));
    expect(hand.map((f) => f.route)).toEqual([]);
  });
});

// ─── 3b. My Network: the actor is the acting org's ────────────────────────────────────────────────────────────
describe('My Network resolves the actor of the acting org', () => {
  it('no route calls resolveActorId(admin, user.id) without passing the acting org — a viewer would get the developer\'s own actor', () => {
    const offenders = FILES.filter((f) => /resolveActorId\(\s*\w+\s*,\s*[\w.]+\s*\)/.test(f.src)).map((f) => f.route);
    expect(offenders).toEqual([]);
  });
});

// ─── 4. the two ways to bend the rule are visible here ──────────────────────────────────────────────────────
describe('the exceptions to "a viewer session cannot write" are exactly these', () => {
  it('allowViewerWrite: none today — a write through a viewer session needs Nuno\'s decision and an entry here', () => {
    const ALLOWED_VIEWER_WRITES: Record<string, string> = {};
    const used = FILES.filter((f) => /allowViewerWrite\s*:\s*true/.test(f.src)).map((f) => f.route).sort();
    expect(used).toEqual(Object.keys(ALLOWED_VIEWER_WRITES).sort());
  });

  it('ignoreInViewer: only the three beacons', () => {
    const used = FILES.filter((f) => /ignoreInViewer\s*:\s*true/.test(f.src)).map((f) => f.route).sort();
    expect(used).toEqual(['events/page-view', 'product-events', 'usage/heartbeat']);
  });
});
