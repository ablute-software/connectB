import { describe, expect, it } from 'vitest';
import { areaFromPath, SUPPORT_AREAS } from './support-area';

describe('areaFromPath (Prompt 605 §A)', () => {
  it('maps the founder app\'s main routes', () => {
    expect(areaFromPath('/pipeline')).toBe('Pipeline');
    expect(areaFromPath('/entities/abc-123')).toBe('Pipeline');
    expect(areaFromPath('/today')).toBe('Tasks & Agenda');
    expect(areaFromPath('/dashboard')).toBe('Dashboard');
    expect(areaFromPath('/vault/folder/9')).toBe('Vault Data Room');
    expect(areaFromPath('/matchdeal')).toBe('MatchDeal');
  });

  it('prefers the longest matching prefix, so billing does not read as Company', () => {
    expect(areaFromPath('/settings')).toBe('Company / Profile');
    expect(areaFromPath('/settings/billing')).toBe('Plans & billing');
    expect(areaFromPath('/settings/billing/invoices')).toBe('Plans & billing');
  });

  it('separates the back-office and the investor portal from the founder app', () => {
    expect(areaFromPath('/backoffice/suggestions')).toBe('Back-office');
    expect(areaFromPath('/metrics/usage')).toBe('Back-office');
    expect(areaFromPath('/portal/startup/x')).toBe('Investor portal');
  });

  it('falls through to Other rather than inventing a label', () => {
    expect(areaFromPath('/')).toBe('Other');
    expect(areaFromPath('/something-nobody-built')).toBe('Other');
    expect(areaFromPath(null)).toBe('Other');
    expect(areaFromPath(undefined)).toBe('Other');
    expect(areaFromPath('')).toBe('Other');
  });

  it('does not match a prefix that is only a substring of a longer segment', () => {
    // '/pipelines-report' is not '/pipeline'
    expect(areaFromPath('/pipelines-report')).toBe('Other');
  });

  it('tolerates a trailing slash, a query string and a hash', () => {
    expect(areaFromPath('/pipeline/')).toBe('Pipeline');
    expect(areaFromPath('/pipeline?tab=all')).toBe('Pipeline');
    expect(areaFromPath('/vault#top')).toBe('Vault Data Room');
  });

  it('only ever returns a label the back-office list knows', () => {
    const paths = ['/pipeline', '/settings/billing', '/backoffice', '/portal/x', '/nowhere', '/'];
    for (const p of paths) expect(SUPPORT_AREAS).toContain(areaFromPath(p));
  });
});
