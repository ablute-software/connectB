// Prompt 929 (B) — the applicant's choice about Sherlock Deal's tips is offered where the applicant actually is: on the call's own page (for a signed-in person, new or existing account), in the Calls area and in
// the account settings. Source-level pins, like the other placement tests, so that moving the page cannot silently drop the box.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
describe('where the tips choice is offered', () => {
  it('the call page shows it to anyone signed in who is not on the team', () => {
    const s = read('src/app/call/[token]/page.tsx');
    expect(s).toContain("import { TipsPreference }");
    expect(s).toMatch(/session\?\.authenticated && !session\.onTeam && <TipsPreference/);
  });
  it('the Calls area and the account settings show it too', () => {
    expect(read('src/components/calls/applicant/ApplicantCalls.tsx')).toContain('<TipsPreference');
    expect(read('src/app/settings/page.tsx')).toContain('<TipsPreference');
  });
  it('it is one preference on the account (the same route everywhere), saved at once', () => {
    const c = read('src/components/calls/applicant/TipsPreference.tsx');
    expect(c).toContain('/api/calls/apply/preferences');
    expect(c).toContain("I don’t want to receive feedback from Sherlock Deal about my evaluations");
  });
});
