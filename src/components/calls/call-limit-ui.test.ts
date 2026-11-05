// Prompt 929 (A) — the maximum number of applications in the screens: the General tab field (editable by whoever may configure, also after validation), "182 / 200 applications" for the team, the entry page that says
// Full (nobody new can start, whoever already has an application keeps their way in) and the places left.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GeneralTab } from './GeneralTab';
import { ctaLabelFor } from './applicant/CallHeader';
import { applicationsText, fullDraftText, fullLateText, isFullFor, placesLeftFor, placesLeftText, reopenedDraftText } from '@/lib/calls/applicant/full';
import type { Call } from '@/lib/calls/types';

const call = (over: Partial<Call> = {}) => ({ id: 'c1', name: 'Seed Call', description: null, opensAt: null, closesAt: null, timezone: 'Europe/Lisbon', visibility: 'unlisted', limitUnit: 'project', allowMultiple: false, contentLanguage: 'en', currency: 'EUR', status: 'draft', promoterKind: 'catalog_entity', promoterId: 'p', configVersion: 1, maxApplications: null, showPlacesLeft: false, fullAt: null, ...over }) as unknown as Call;
const html = (c: Call, extra: Partial<Parameters<typeof GeneralTab>[0]> = {}) => renderToStaticMarkup(createElement(GeneralTab, { call: c, promoterName: 'Firm', disabled: false, onChange: () => {}, ...extra }));

describe('the General tab field', () => {
  it('shows the maximum (empty = no limit) and the "places left" switch, which needs a maximum', () => {
    const none = html(call());
    expect(none).toContain('Maximum number of applications (optional)');
    expect(none).toContain('placeholder="No limit"');
    expect(none).toMatch(/<fieldset[^>]*disabled=""[^>]*><legend[^>]*>Places left on the call page/);
    const set = html(call({ maxApplications: 200, showPlacesLeft: true }));
    expect(set).toContain('value="200"');
    expect(set).not.toMatch(/<fieldset[^>]*disabled=""[^>]*><legend[^>]*>Places left on the call page/);
    expect(set).toMatch(/data-testid="show-places-left"[^>]*checked=""/);
    expect(set).toContain('Only submitted applications count, never drafts.');
  });
  it('stays editable once the call is validated (the rest of the tab is locked), but not for whoever may not configure it', () => {
    const validated = html(call({ status: 'validated', maxApplications: 5 }), { disabled: true, presentationDisabled: false });
    expect(validated).not.toMatch(/data-testid="call-max"[^>]*disabled=""/);
    expect(validated).toMatch(/id="call-name"[^>]*disabled=""/);
    expect(html(call({ maxApplications: 5 }), { disabled: true, presentationDisabled: true })).toMatch(/data-testid="call-max"[^>]*disabled=""/);
  });
});

describe('what each screen says', () => {
  it('the team reads "182 / 200 applications" (or just the count with no limit)', () => {
    expect(applicationsText({ maxApplications: 200 }, 182)).toBe('182 / 200 applications');
    expect(applicationsText({ maxApplications: null }, 1)).toBe('1 application');
    expect(applicationsText({ maxApplications: null }, 0)).toBe('0 applications');
  });
  it('full is counted on submitted applications only; the places left never go below 0', () => {
    expect(isFullFor({ maxApplications: 3 }, 2)).toBe(false); expect(isFullFor({ maxApplications: 3 }, 3)).toBe(true); expect(isFullFor({ maxApplications: null }, 999)).toBe(false);
    expect(placesLeftFor({ maxApplications: 200 }, 163)).toBe(37); expect(placesLeftFor({ maxApplications: 2 }, 5)).toBe(0); expect(placesLeftFor({ maxApplications: null }, 5)).toBeNull();
    expect(placesLeftText(37)).toBe('37 places left'); expect(placesLeftText(1)).toBe('1 place left');
  });
  it('the entry page: nobody new starts on a full call, but whoever has an application keeps their way in; an open call starts as always', () => {
    expect(ctaLabelFor({ phase: 'open', full: true }, null)).toBeNull();
    expect(ctaLabelFor({ phase: 'open', full: true }, { status: 'draft' })).toBe('Continue your application');
    expect(ctaLabelFor({ phase: 'open', full: true }, { status: 'submitted' })).toBe('View your application');
    expect(ctaLabelFor({ phase: 'open', full: false }, null)).toBe('Start application');
    expect(ctaLabelFor({ phase: 'closed' }, null)).toBeNull();
  });
  it('the texts: the draft holders are told by the entity, the late arrivals by Sherlock Deal (with the profile invitation)', () => {
    expect(fullDraftText('Acme Capital', 'Seed 2027').body).toContain('your draft can no longer be submitted');
    expect(reopenedDraftText('Acme Capital', 'Seed 2027').title).toBe('«Seed 2027» is accepting applications again');
    expect(fullLateText('Acme Capital', 'Seed 2027').body).toBe('«Seed 2027» by «Acme Capital» has reached its maximum number of applications, so your application could not be submitted. You can keep using Sherlock Deal: complete your startup profile to be found by investors that match your stage and sector, and to hear about new opportunities.');
  });
});
