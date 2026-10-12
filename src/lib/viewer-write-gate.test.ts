// Prompt 904 — the backstop's verdicts. What matters here is the SHAPE of the default: a write is forbidden
// unless somebody wrote down why it may happen, so a route added next month is refused rather than forgotten.
import { describe, expect, it } from 'vitest';
import { VIEWER_IGNORED_PATHS, VIEWER_WRITE_ALLOWLIST, viewerWriteVerdict } from './viewer-write-gate';

describe('viewerWriteVerdict', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('%s is never touched', (method) => {
    expect(viewerWriteVerdict(method, '/api/market-thesis')).toBe('pass');
    expect(viewerWriteVerdict(method, '/api/anything-at-all')).toBe('pass');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s to a founder route is forbidden — including a route nobody has heard of yet', (method) => {
    for (const path of ['/api/market-thesis', '/api/blueprint/answer', '/api/network/post', '/api/org/update', '/api/a-route-added-next-month']) {
      expect(viewerWriteVerdict(method, path), `${method} ${path}`).toBe('forbid');
    }
  });

  it('pages and static paths are not the API\'s business', () => {
    expect(viewerWriteVerdict('POST', '/settings')).toBe('pass');
    expect(viewerWriteVerdict('POST', '/apiary')).toBe('pass');
  });

  it('beacons are acknowledged and dropped, not refused', () => {
    for (const path of VIEWER_IGNORED_PATHS) expect(viewerWriteVerdict('POST', path), path).toBe('ignore');
  });

  it('every allowlisted surface passes, on a segment boundary only', () => {
    for (const { prefix } of VIEWER_WRITE_ALLOWLIST) {
      expect(viewerWriteVerdict('POST', prefix), prefix).toBe('pass');
      expect(viewerWriteVerdict('POST', prefix + '/x'), prefix + '/x').toBe('pass');
    }
    // /api/portal is the investor workspace; /api/portalx is not it.
    expect(viewerWriteVerdict('POST', '/api/portalx/do-it')).toBe('forbid');
    expect(viewerWriteVerdict('POST', '/api/backofficer')).toBe('forbid');
  });

  it('the account-level writes the prompt names are NOT on the allowlist', () => {
    for (const path of ['/api/account/change-password', '/api/account/close-org', '/api/stripe/checkout', '/api/stripe/portal',
      '/api/invite/create', '/api/invite/some-token/accept', '/api/team/members/u1', '/api/promo/redeem', '/api/plan/request',
      '/api/oauth/google/disconnect', '/api/support/submit', '/api/provision-org']) {
      expect(viewerWriteVerdict('POST', path), path).toBe('forbid');
    }
  });

  it('every allowlist entry carries a reason', () => {
    for (const a of VIEWER_WRITE_ALLOWLIST) expect(a.why.length, a.prefix).toBeGreaterThan(20);
  });
});
