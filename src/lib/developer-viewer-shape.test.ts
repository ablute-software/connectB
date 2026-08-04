import { describe, expect, it } from 'vitest';
import { parseViewerCookieValue, extractCookieFromHeader } from './developer-viewer-shape';

describe('parseViewerCookieValue', () => {
  it('parses a valid "orgId:enteredAt" value', () => {
    expect(parseViewerCookieValue('org-123:2026-08-04T18:00:00.000Z')).toEqual({
      orgId: 'org-123', enteredAt: '2026-08-04T18:00:00.000Z',
    });
  });

  it('returns null for a value with no colon', () => {
    expect(parseViewerCookieValue('org-123')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseViewerCookieValue('')).toBeNull();
  });

  it('returns null when either half is empty', () => {
    expect(parseViewerCookieValue(':2026-08-04T18:00:00.000Z')).toBeNull();
    expect(parseViewerCookieValue('org-123:')).toBeNull();
  });
});

describe('extractCookieFromHeader', () => {
  it('finds the named cookie among several', () => {
    expect(extractCookieFromHeader('a=1; sd_viewer_org_id=org-123%3A2026; b=2', 'sd_viewer_org_id')).toBe('org-123:2026');
  });

  it('finds the named cookie when it is the only one', () => {
    expect(extractCookieFromHeader('sd_viewer_org_id=org-123', 'sd_viewer_org_id')).toBe('org-123');
  });

  it('returns null when the cookie is absent', () => {
    expect(extractCookieFromHeader('a=1; b=2', 'sd_viewer_org_id')).toBeNull();
  });

  // Regression: a naive unanchored regex would match a DIFFERENT cookie
  // whose name merely ends with the same characters (e.g. a hypothetical
  // "xsd_viewer_org_id"). The real anchor is "start of header, or right
  // after '; '".
  it('does not match a cookie name that is only a suffix of another', () => {
    expect(extractCookieFromHeader('xsd_viewer_org_id=wrong-value', 'sd_viewer_org_id')).toBeNull();
  });
});
