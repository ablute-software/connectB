// Prompt I-01 §C.5 / I-01b §C — the four e-mails, in English: subject, the
// incubator's brand leading, the level-1 sentence, the reason only when given.
import { describe, expect, it } from 'vitest';
import {
  escapeHtml, memberInviteEmail, relationshipEndedByFounderEmail, relationshipEndedByIncubatorEmail, startupInviteEmail,
} from './incubator-emails';
import { defaultLevelNotice } from '../incubators';

describe('incubator e-mails', () => {
  it('startup invite: subject, level-1 sentence, link', () => {
    const e = startupInviteEmail({ incubatorName: 'Startup Braga', startupName: 'Alfa', url: 'https://x/invite/incubator/T' });
    expect(e.subject).toBe('Startup Braga invited Alfa to Sherlock Deal');
    expect(e.text).toContain(defaultLevelNotice('Startup Braga'));
    expect(e.text).toContain('https://x/invite/incubator/T');
    expect(e.text).not.toContain('voucher');
  });
  it('invite without a startup name reads "your startup"; voucher names plan and duration', () => {
    const e = startupInviteEmail({ incubatorName: 'Inc', startupName: null, url: 'u', voucher: { planLabel: 'Garage', months: 12 } });
    expect(e.subject).toBe('Inc invited your startup to Sherlock Deal');
    expect(e.text).toContain('the Garage plan for 12 months');
  });
  it('member invite', () => {
    expect(memberInviteEmail({ incubatorName: 'Inc', role: 'manager', url: 'u' }).subject).toBe('Join the Inc team on Sherlock Deal');
  });
  it('ended by the incubator carries its reason to the founder', () => {
    expect(relationshipEndedByIncubatorEmail({ incubatorName: 'Inc', reason: 'Programme closed', url: 'u' }).text).toContain('Reason given: Programme closed');
  });
  it('ended by the founder: no reason line when none was given', () => {
    expect(relationshipEndedByFounderEmail({ startupName: 'Alfa', reason: null, url: 'u' }).text).not.toContain('Reason');
    expect(relationshipEndedByFounderEmail({ startupName: 'Alfa', reason: 'Moved programme', url: 'u' }).text).toContain('Reason given: Moved programme');
  });
  it('no Portuguese left in any template (I-01b §C)', () => {
    const all = [
      startupInviteEmail({ incubatorName: 'Inc', startupName: 'A', url: 'u', voucher: { planLabel: 'Garage', months: 6 } }),
      memberInviteEmail({ incubatorName: 'Inc', role: 'owner', url: 'u' }),
      relationshipEndedByIncubatorEmail({ incubatorName: 'Inc', reason: 'r', url: 'u' }),
      relationshipEndedByFounderEmail({ startupName: 'A', reason: 'r', url: 'u' }),
    ].map((e) => `${e.subject} ${e.text} ${e.heading} ${e.ctaLabel}`).join(' ');
    expect(all).not.toMatch(/\b(convid|relação|partilh|incubadora|razão|nível)\w*/i);
  });
  it('escapeHtml', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});
