// Prompt 924 (Etapa 4, I1) — the results as the applicant will be told them, as pure rules: Advance / Reject / Waitlist become Selected / Not selected / Waiting list (renameable); a "Not a fit" without a decision
// is "Not selected"; an application with neither is pending and blocks publishing; each result has one message, in the call's language, whose fields fill themselves in (and are escaped); the feedback is
// the administrator's own and appears only when written; the evaluators' comments are not an input of anything here.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, MAX_SEND_ATTEMPTS, PLACEHOLDERS, backoffMs, blockersOf, buildMessage, classifyEmailFailure, cleanFeedback, cleanGrade, confirmationMatches, defaultMessage, fillPlaceholders, formatGrade, labelOf, nextStepsText, outcomeOf, parseSettingsPatch, roundOf,
  scheduleProblem, summarise, unknownPlaceholders,
  type AppFacts, type ResultSettings,
} from './results';

const app = (over: Partial<AppFacts> = {}): AppFacts => ({ applicationId: 'a1', reference: 'REF-001', startupName: 'Blue Health', applicantUserId: 'u1', decision: null, eligibility: 'fit', eligibilityReason: null, feedback: null, grade: null, ...over });
const settings = (over: Partial<ResultSettings> = {}): ResultSettings => ({ ...DEFAULT_SETTINGS, labels: {}, messages: {}, ...over });
const input = (over: Partial<Parameters<typeof buildMessage>[0]> = {}): Parameters<typeof buildMessage>[0] => ({
  settings: settings(), call: { name: 'Seed Call 2027', contentLanguage: 'en' }, entityName: 'Portugal Ventures', app: app({ decision: 'advance' }), applicantName: 'Ana Silva', hasNextPhase: false, formatDay: (d) => `on ${d}`, ...over,
});

describe('the defaults Nuno decided (28/10/2026)', () => {
  it('feedback off, contestations off with 10 calendar days once on, the data kept 24 months after the call is completed', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ feedbackEnabled: false, contestationsEnabled: false, contestationDays: 10, retentionMonths: 24, includeEligibilityReason: false });
  });
});

describe('what the applicant is told for each decision', () => {
  it('Advance is "Selected" (or "Moves to the next phase" when the call has another phase), Reject "Not selected", Waitlist "Waiting list"', () => {
    expect(labelOf('advance', settings(), false)).toBe('Selected');
    expect(labelOf('advance', settings(), true)).toBe('Moves to the next phase');
    expect(labelOf('reject', settings(), false)).toBe('Not selected');
    expect(labelOf('waitlist', settings(), true)).toBe('Waiting list');
  });
  it('the entity may rename each one, and a blank name goes back to the default', () => {
    expect(labelOf('advance', settings({ labels: { advance: 'Accepted into the programme' } }), true)).toBe('Accepted into the programme');
    expect(labelOf('reject', settings({ labels: { reject: '   ' } }), false)).toBe('Not selected');
  });
  it('a decision wins; without one, "Not a fit" is "Not selected"; with neither the application is pending', () => {
    expect(outcomeOf({ decision: 'waitlist', eligibility: 'not_fit' })).toEqual({ result: 'waitlist', source: 'decision' });
    expect(outcomeOf({ decision: null, eligibility: 'not_fit' })).toEqual({ result: 'reject', source: 'eligibility' });
    expect(outcomeOf({ decision: null, eligibility: 'fit' })).toEqual({ result: null, source: null });
    expect(outcomeOf({ decision: null, eligibility: 'to_validate' })).toEqual({ result: null, source: null });
    expect(outcomeOf({ decision: null, eligibility: null })).toEqual({ result: null, source: null });
  });
});

describe('the counts, and not publishing while anything is pending', () => {
  const apps = [app({ applicationId: 'a', decision: 'advance' }), app({ applicationId: 'b', decision: 'reject' }), app({ applicationId: 'c', decision: 'waitlist' }), app({ applicationId: 'd' }), app({ applicationId: 'e', eligibility: 'not_fit' })];
  it('counts per result, how many "Not selected" come from eligibility, and who is pending', () => {
    const s = summarise(apps);
    expect(s.total).toBe(5);
    expect(s.counts).toEqual({ advance: 1, reject: 2, waitlist: 1 });
    expect(s.byEligibility).toBe(1);
    expect(s.pending.map((p) => p.applicationId)).toEqual(['d']);
  });
  it('every reason it cannot be published yet is said: a pending application, a call still open, nothing submitted, already published, a completed call', () => {
    const s = summarise(apps);
    expect(blockersOf({ summary: s, callStatus: 'closed', alreadyPublished: false }).map((b) => b.code)).toEqual(['pending']);
    expect(blockersOf({ summary: s, callStatus: 'open', alreadyPublished: false }).map((b) => b.code)).toEqual(['call_not_closed', 'pending']);
    expect(blockersOf({ summary: summarise([]), callStatus: 'closed', alreadyPublished: false }).map((b) => b.code)).toEqual(['no_applications']);
    expect(blockersOf({ summary: summarise(apps.slice(0, 3)), callStatus: 'closed', alreadyPublished: true }).map((b) => b.code)).toEqual(['already_published']);
    expect(blockersOf({ summary: summarise(apps.slice(0, 3)), callStatus: 'completed', alreadyPublished: false }).map((b) => b.code)).toEqual(['call_completed']);
    expect(blockersOf({ summary: summarise(apps.slice(0, 3)), callStatus: 'closed', alreadyPublished: false })).toEqual([]);
  });
  it('the pending sentence names how many', () => {
    expect(blockersOf({ summary: summarise([app()]), callStatus: 'closed', alreadyPublished: false })[0].text).toBe('1 application has no decision yet. Every application needs one before the results can be published.');
    expect(blockersOf({ summary: summarise([app(), app({ applicationId: 'z' })]), callStatus: 'closed', alreadyPublished: false })[0].text).toContain('2 applications have no decision yet');
  });
});

describe('the phases: which one is being prepared, and whether "Selected" moves on', () => {
  it('the first phase not yet published; the last one never has a next', () => {
    const phases = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    expect(roundOf(phases, [])).toEqual({ phaseId: 'p1', hasNextPhase: true, allPublished: false });
    expect(roundOf(phases, ['p1'])).toEqual({ phaseId: 'p2', hasNextPhase: true, allPublished: false });
    expect(roundOf(phases, ['p1', 'p2'])).toEqual({ phaseId: 'p3', hasNextPhase: false, allPublished: false });
    expect(roundOf(phases, ['p1', 'p2', 'p3']).allPublished).toBe(true);
    expect(roundOf([{ id: 'only' }], [])).toEqual({ phaseId: 'only', hasNextPhase: false, allPublished: false });
    expect(roundOf([], [])).toEqual({ phaseId: null, hasNextPhase: false, allPublished: false });
    expect(roundOf([], [''])).toMatchObject({ allPublished: true });
  });
});

describe('the fields of a message fill themselves in', () => {
  it('applicant_name, startup_name, call_title, entity_name, next_steps and reference — all six exist', () => {
    expect(PLACEHOLDERS.map((p) => p.key)).toEqual(['applicant_name', 'startup_name', 'call_title', 'entity_name', 'next_steps', 'reference']);
    const html = '<p>{applicant_name} / {startup_name} / {call_title} / {entity_name} / {next_steps} / {reference}</p>';
    expect(fillPlaceholders(html, { applicant_name: 'Ana', startup_name: 'Blue', call_title: 'Call', entity_name: 'Fund', next_steps: 'Soon', reference: 'R-1' })).toBe('<p>Ana / Blue / Call / Fund / Soon / R-1</p>');
  });
  it('a value is text, never markup; a field that does not exist is left as it was; a paragraph left empty disappears', () => {
    expect(fillPlaceholders('<p>{applicant_name}</p>', { applicant_name: '<img src=x onerror=alert(1)> & "co"' })).toBe('<p>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;co&quot;</p>');
    expect(fillPlaceholders('<p>{nope}</p>', {})).toBe('<p>{nope}</p>');
    expect(fillPlaceholders('<p>Hello</p><p>{next_steps}</p><p>Bye</p>', { next_steps: '' })).toBe('<p>Hello</p><p>Bye</p>');
  });
  it('a typo is caught when the message is written', () => {
    expect(unknownPlaceholders('<p>{applicant_name} {startup} {Call_Title} {foo}</p>')).toEqual(['startup', 'Call_Title', 'foo']);   // the names are exact: {Call_Title} would not be filled either
  });
  it('the next steps are the date and the text; either alone is fine; nothing is nothing', () => {
    const fmt = (d: string) => `14 Nov 2026`;
    expect(nextStepsText({ nextStepsText: 'Pitch day at our office', nextStepsDate: '2026-11-14' }, fmt)).toBe('14 Nov 2026: Pitch day at our office');
    expect(nextStepsText({ nextStepsText: 'Pitch day', nextStepsDate: null }, fmt)).toBe('Pitch day');
    expect(nextStepsText({ nextStepsText: '', nextStepsDate: '2026-11-14' }, fmt)).toBe('14 Nov 2026');
    expect(nextStepsText({ nextStepsText: '  ', nextStepsDate: null }, fmt)).toBe('');
  });
});

describe('the message one applicant receives', () => {
  it('Selected: the default text with every field filled in, the entity at the end, and a subject with the call and the result', () => {
    const m = buildMessage(input())!;
    expect(m).toMatchObject({ result: 'advance', label: 'Selected', subject: 'Seed Call 2027: Selected' });
    expect(m.html).toContain('Dear Ana Silva,');
    expect(m.html).toContain('Blue Health has been selected in “Seed Call 2027”');
    expect(m.html).toContain('Portugal Ventures');
    expect(m.html).not.toMatch(/\{[a-z_]+\}/);
    expect(m.text).toContain('Dear Ana Silva');
  });
  it('"Moves to the next phase" with the next steps, only for those who advance', () => {
    const s = settings({ nextStepsText: 'Pitch day at our office.', nextStepsDate: '2026-11-14' });
    const adv = buildMessage(input({ settings: s, hasNextPhase: true }))!;
    expect(adv.label).toBe('Moves to the next phase');
    expect(adv.html).toContain('moves to the next phase of “Seed Call 2027”');
    expect(adv.html).toContain('on 2026-11-14: Pitch day at our office.');
    const rej = buildMessage(input({ settings: s, hasNextPhase: true, app: app({ decision: 'reject' }) }))!;
    expect(rej.html).not.toContain('Pitch day');
  });
  it('the three results each have a message of their own, and an application without a result has none', () => {
    expect(buildMessage(input({ app: app({ decision: 'reject' }) }))!.html).toContain('was not selected this time');
    expect(buildMessage(input({ app: app({ decision: 'waitlist' }) }))!.html).toContain('waiting list');
    expect(buildMessage(input({ app: app() }))).toBeNull();
  });
  it('the entity\'s own message and name replace the default ones', () => {
    const m = buildMessage(input({ settings: settings({ labels: { advance: 'Welcome aboard' }, messages: { advance: '<p>Hi {applicant_name}, {startup_name} is in! <script>alert(1)</script></p>' } }) }))!;
    expect(m.label).toBe('Welcome aboard');
    expect(m.html).toContain('Hi Ana Silva, Blue Health is in!');
    expect(m.html).not.toContain('script');
  });
  it('in the language of the call (Portuguese, Spanish, French, German, Italian), English for any other', () => {
    expect(buildMessage(input({ call: { name: 'Chamada', contentLanguage: 'pt' } }))!.html).toContain('Caro(a) Ana Silva,');
    expect(defaultMessage('reject', 'es', false)).toContain('no ha sido seleccionada');
    expect(defaultMessage('reject', 'fr', false)).toContain('n’a pas été sélectionnée');
    expect(defaultMessage('reject', 'de', false)).toContain('nicht ausgewählt');
    expect(defaultMessage('reject', 'it', false)).toContain('non è stata selezionata');
    expect(defaultMessage('reject', 'ja', false)).toContain('was not selected this time');
  });
  it('the feedback appears only when the call has it on AND an administrator wrote it; off, or empty, nothing is added', () => {
    const withFb = (over: Partial<ResultSettings>, fb: string | null) => buildMessage(input({ settings: settings(over), app: app({ decision: 'reject', feedback: fb }) }))!;
    expect(withFb({ feedbackEnabled: true }, 'Your financial plan lacked a second year.').html).toContain('<h3>Feedback</h3><p>Your financial plan lacked a second year.</p>');
    expect(withFb({ feedbackEnabled: true }, '   ').html).not.toContain('Feedback');
    expect(withFb({ feedbackEnabled: true }, null).html).not.toContain('Feedback');
    expect(withFb({ feedbackEnabled: false }, 'written but the option is off').html).not.toContain('written but');
    expect(withFb({ feedbackEnabled: true }, '<b>x</b>\nsecond line').html).toContain('&lt;b&gt;x&lt;/b&gt;<br>second line');
  });
  it('the eligibility reason is added only for a "Not a fit" without a decision, and only if the entity asked for it', () => {
    const notFit = app({ eligibility: 'not_fit', eligibilityReason: 'The company was founded after 2024.' });
    expect(buildMessage(input({ app: notFit }))!.html).not.toContain('founded after');
    expect(buildMessage(input({ settings: settings({ includeEligibilityReason: true }), app: notFit }))!.html).toContain('<strong>Reason:</strong> The company was founded after 2024.');
    expect(buildMessage(input({ settings: settings({ includeEligibilityReason: true }), app: { ...notFit, decision: 'reject' } }))!.html).not.toContain('founded after');
  });
});

describe('writing the settings', () => {
  it('only what is sent changes; names are trimmed and bounded; a blank one is the default', () => {
    expect(parseSettingsPatch({ labels: { advance: '  Accepted ', reject: '', waitlist: 'W'.repeat(60) } })).toEqual({ ok: true, patch: { labels: { advance: 'Accepted', waitlist: 'W'.repeat(60) } } });
    expect(parseSettingsPatch({ labels: { advance: 'W'.repeat(61) } })).toMatchObject({ ok: false });
  });
  it('a message is rebuilt from the closed list of tags and may use only the fields that exist', () => {
    const ok = parseSettingsPatch({ messages: { advance: '<p onclick="x()">Hi {applicant_name}<script>bad()</script></p>' } });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok && ok.patch.messages?.advance).toBe('<p>Hi {applicant_name}</p>');
    const bad = parseSettingsPatch({ messages: { reject: '<p>{applicant}</p>' } });
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.error).toContain('{applicant} does not exist');
  });
  it('the options: booleans only; 1–90 days of contestation; 1–120 months of retention; a real date for the next phase', () => {
    expect(parseSettingsPatch({ feedbackEnabled: true, contestationsEnabled: true, contestationDays: 10, retentionMonths: 24, nextStepsText: ' Pitch ', nextStepsDate: '2026-11-14' }))
      .toEqual({ ok: true, patch: { feedbackEnabled: true, contestationsEnabled: true, contestationDays: 10, retentionMonths: 24, nextStepsText: 'Pitch', nextStepsDate: '2026-11-14' } });
    for (const bad of [{ feedbackEnabled: 'yes' }, { contestationDays: 0 }, { contestationDays: 91 }, { contestationDays: 2.5 }, { retentionMonths: 0 }, { retentionMonths: 121 }, { nextStepsDate: '14/11/2026' }, { nextStepsDate: '2026-13-45' }, {}, null]) {
      expect(parseSettingsPatch(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    expect(parseSettingsPatch({ nextStepsDate: null })).toEqual({ ok: true, patch: { nextStepsDate: null } });
  });
  it('the feedback: text up to 2000 characters, empty clears it', () => {
    expect(cleanFeedback('  good  ')).toEqual({ ok: true, text: 'good' });
    expect(cleanFeedback(null)).toEqual({ ok: true, text: '' });
    expect(cleanFeedback('x'.repeat(2001))).toMatchObject({ ok: false });
    expect(cleanFeedback(5)).toMatchObject({ ok: false });
  });
});

describe('the evaluators\' comments can never be in a message', () => {
  const ROOT = process.cwd();
  const sources = ['src/lib/calls/results.ts', 'src/lib/calls/results-store.ts', 'src/components/calls/PrepareResults.tsx', 'src/app/api/calls/[id]/results/route.ts'];
  it('nothing that builds, stores or shows a result reads an evaluation, a score, a comment or a private note', () => {
    for (const rel of sources) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      for (const forbidden of ['call_evaluations', 'call_eval_scores', 'overall_comment', 'private_note', 'grade_percent', 'eval-store', 'loadBoard']) expect(src, `${rel} must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });
});


// --- Prompt 924, I2 -------------------------------------------------------------------------------------------------------------------------------------

describe('the validated grade (Nuno, 28/10/2026): an option per call, off by default; only what an administrator validated', () => {
  it('off by default', () => { expect(DEFAULT_SETTINGS.shareGrade).toBe(false); });
  it('a grade is 0–100 with up to two decimals, a comma is fine, empty clears it, anything else is refused', () => {
    expect(cleanGrade('91,5')).toEqual({ ok: true, grade: 91.5 });
    expect(cleanGrade(' 70.25 ')).toEqual({ ok: true, grade: 70.25 });
    expect(cleanGrade(0)).toEqual({ ok: true, grade: 0 });
    expect(cleanGrade('100')).toEqual({ ok: true, grade: 100 });
    for (const empty of ['', '   ', null, undefined]) expect(cleanGrade(empty)).toEqual({ ok: true, grade: null });
    for (const bad of ['101', '-1', '12.345', 'high', '1e2', '10%', {}]) expect(cleanGrade(bad), String(bad)).toMatchObject({ ok: false });
  });
  it('it is written "82%" / "82.5%" / "7.25%"', () => { expect(formatGrade(82)).toBe('82%'); expect(formatGrade(82.5)).toBe('82.5%'); expect(formatGrade(7.25)).toBe('7.25%'); });
  it('the message carries the validated grade only when the call shares it, and only for a result that comes from a decision', () => {
    const base = input({ app: app({ decision: 'reject', grade: 48 }) });
    expect(buildMessage(base)!.html).not.toContain('Score');                                                        // option off: never
    const on = buildMessage({ ...base, settings: settings({ shareGrade: true }) })!;
    expect(on.html).toContain('<strong>Score:</strong> 48%');
    expect(on.grade).toBe(48);
    expect(buildMessage({ ...base, settings: settings({ shareGrade: true }), app: app({ decision: 'reject', grade: null }) })!.html).not.toContain('Score');
    // a "Not a fit" was never evaluated: whatever is stored, no score
    expect(buildMessage({ ...base, settings: settings({ shareGrade: true }), app: app({ eligibility: 'not_fit', grade: 99 }) })!.html).not.toContain('Score');
  });
  it('in the language of the call', () => {
    const m = buildMessage({ ...input({ app: app({ decision: 'advance', grade: 80 }), call: { name: 'Chamada', contentLanguage: 'pt' } }), settings: settings({ shareGrade: true }) })!;
    expect(m.html).toContain('<strong>Pontuação:</strong> 80%');
  });
  it('with the option on, every evaluated application needs its grade before publishing; an eligibility "Not a fit" does not', () => {
    const apps = [app({ applicationId: 'a', decision: 'advance', grade: 90 }), app({ applicationId: 'b', decision: 'reject' }), app({ applicationId: 'c', eligibility: 'not_fit' })];
    const s = summarise(apps);
    expect(s.needGrade.map((x) => x.applicationId)).toEqual(['b']);
    expect(blockersOf({ summary: s, callStatus: 'closed', alreadyPublished: false }).map((b) => b.code)).toEqual([]);                      // off: not asked for
    expect(blockersOf({ summary: s, callStatus: 'closed', alreadyPublished: false, shareGrade: true }).map((b) => b.code)).toEqual(['missing_grade']);
    expect(blockersOf({ summary: summarise([apps[0], apps[2]]), callStatus: 'closed', alreadyPublished: false, shareGrade: true })).toEqual([]);
  });
  it('the option is a boolean like the others', () => {
    expect(parseSettingsPatch({ shareGrade: true })).toEqual({ ok: true, patch: { shareGrade: true } });
    expect(parseSettingsPatch({ shareGrade: 'yes' })).toMatchObject({ ok: false });
  });
});

describe('scheduling, confirming and retrying', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  it('a schedule is a real moment, at least two minutes ahead, within a year', () => {
    expect(scheduleProblem('2026-10-30T09:00:00Z', now)).toBeNull();
    expect(scheduleProblem('2026-10-29T12:01:00Z', now)).toBe('Choose a time at least 2 minutes from now.');
    expect(scheduleProblem('2026-10-29T11:00:00Z', now)).toBe('Choose a time at least 2 minutes from now.');
    expect(scheduleProblem('2028-01-01T00:00:00Z', now)).toBe('Choose a date within the next year.');
    for (const bad of ['', 'tomorrow', null, undefined, 5]) expect(scheduleProblem(bad, now), String(bad)).toBe('Choose a date and a time.');
  });
  it('the name of the call is typed to confirm: capitals and spaces do not matter, the name does', () => {
    expect(confirmationMatches('seed   call 2027 ', 'Seed Call 2027')).toBe(true);
    expect(confirmationMatches('Seed Call 2028', 'Seed Call 2027')).toBe(false);
    expect(confirmationMatches('', '')).toBe(false);
    expect(confirmationMatches(undefined, 'Seed Call 2027')).toBe(false);
  });
  it('an email is tried five times, waiting 5 minutes, 30 minutes, 2 hours and 6 hours between tries', () => {
    expect(MAX_SEND_ATTEMPTS).toBe(5);
    expect([1, 2, 3, 4, 5].map((n) => backoffMs(n) / 60_000)).toEqual([5, 30, 120, 360, 360]);
  });
  it('a provider answer about the address is permanent ("bounced"); a timeout or a rate limit is temporary', () => {
    for (const m of ['Invalid recipient address', 'The email address is not a valid address', 'mailbox does not exist', 'Message rejected', 'recipient is on the suppression list']) expect(classifyEmailFailure(m), m).toBe('permanent');
    for (const m of ['provider timeout', 'rate limit exceeded', '503 Service Unavailable', '', null, undefined]) expect(classifyEmailFailure(m), String(m)).toBe('temporary');
  });
});
