import { describe, expect, it } from 'vitest';
import { bucketForRecipient, domainHealthDiagnosis, summariseByDomain } from './email-domain-health';

describe('bucketForRecipient', () => {
  it('groups every Microsoft consumer domain together — one system, one reputation', () => {
    for (const d of ['hotmail.com', 'outlook.com', 'outlook.pt', 'live.com', 'msn.com', 'hotmail.co.uk']) {
      expect(bucketForRecipient(`a@${d}`)).toBe('microsoft');
    }
  });

  it('recognises Gmail and Proton, and is case- and whitespace-insensitive', () => {
    expect(bucketForRecipient('a@gmail.com')).toBe('gmail');
    expect(bucketForRecipient('a@GoogleMail.com')).toBe('gmail');
    expect(bucketForRecipient('a@proton.me ')).toBe('proton');
    expect(bucketForRecipient('a@PM.me')).toBe('proton');
  });

  it('falls back to other for anything else, including a malformed address', () => {
    expect(bucketForRecipient('a@krohnsty.com')).toBe('other');
    expect(bucketForRecipient('not-an-email')).toBe('other');
    expect(bucketForRecipient(null)).toBe('other');
    expect(bucketForRecipient('')).toBe('other');
  });
});

describe('summariseByDomain', () => {
  // The 03/09 incident, as data: Microsoft accepted six and confirmed none,
  // while Gmail and Proton went through. That contrast is the finding.
  const rows = [
    ...Array.from({ length: 6 }, () => ({ recipient: 'a@hotmail.com', status: 'sent' })),
    { recipient: 'b@gmail.com', status: 'delivered' },
    { recipient: 'c@gmail.com', status: 'delivered' },
    { recipient: 'd@proton.me', status: 'delivered' },
  ];

  it('separates a receiver that never confirms from receivers that do', () => {
    const byKey = Object.fromEntries(summariseByDomain(rows).map((b) => [b.key, b]));
    expect(byKey.microsoft).toMatchObject({ sent: 6, delivered: 0, bounced: 0, awaitingProviderEvent: 6 });
    expect(byKey.gmail).toMatchObject({ sent: 2, delivered: 2, awaitingProviderEvent: 0 });
    expect(byKey.proton).toMatchObject({ sent: 1, delivered: 1 });
  });

  it('counts an accepted send once in `sent` whatever became of it', () => {
    const [bucket] = summariseByDomain([
      { recipient: 'a@gmail.com', status: 'delivered' },
      { recipient: 'a@gmail.com', status: 'bounced' },
      { recipient: 'a@gmail.com', status: 'complained' },
      { recipient: 'a@gmail.com', status: 'delayed' },
    ]).filter((b) => b.key === 'gmail');
    expect(bucket).toMatchObject({ sent: 4, delivered: 1, bounced: 1, complained: 1, delayed: 1, awaitingProviderEvent: 0 });
  });

  // Our own failures are not the receiver's, and mixing them in would hide
  // the comparison this table exists to make.
  it('keeps sends that never reached the provider out of `sent`', () => {
    const [bucket] = summariseByDomain([
      { recipient: 'a@gmail.com', status: 'failed' },
      { recipient: 'a@gmail.com', status: 'not_configured' },
      { recipient: 'a@gmail.com', status: 'render_failed' },
    ]).filter((b) => b.key === 'gmail');
    expect(bucket).toMatchObject({ sent: 0, failed: 3 });
  });

  it('always returns every bucket, so a domain with no traffic still shows as a zero row', () => {
    expect(summariseByDomain([]).map((b) => b.key)).toEqual(['gmail', 'microsoft', 'proton', 'other']);
  });

  it('ignores a status it does not know rather than throwing', () => {
    expect(() => summariseByDomain([{ recipient: 'a@gmail.com', status: 'something_new' }])).not.toThrow();
  });
});

describe('domainHealthDiagnosis', () => {
  const microsoftSilent = summariseByDomain([
    ...Array.from({ length: 6 }, () => ({ recipient: 'a@hotmail.com', status: 'sent' })),
    { recipient: 'b@gmail.com', status: 'delivered' },
  ]);

  // The false alarm this guards against: before the webhook is configured
  // EVERY row sits at 'sent' forever, which is not evidence of anything.
  it('says the counts mean acceptance, not delivery, while the webhook is unconfigured', () => {
    const text = domainHealthDiagnosis(microsoftSilent, false);
    expect(text).toContain('RESEND_WEBHOOK_SECRET');
    expect(text).not.toContain('silently');
  });

  it('names the silent receiver once the webhook is configured', () => {
    const text = domainHealthDiagnosis(microsoftSilent, true);
    expect(text).toContain('Hotmail / Outlook');
    expect(text).toContain('SPF/DKIM/DMARC');
  });

  it('reports bounces when there are some', () => {
    const buckets = summariseByDomain([
      { recipient: 'a@gmail.com', status: 'delivered' },
      { recipient: 'b@gmail.com', status: 'bounced' },
    ]);
    expect(domainHealthDiagnosis(buckets, true)).toContain('Bounces on Gmail');
  });

  it('says nothing alarming when the window is clean or empty', () => {
    expect(domainHealthDiagnosis(summariseByDomain([]), true)).toBe('No emails sent in this window.');
    const clean = summariseByDomain([{ recipient: 'a@gmail.com', status: 'delivered' }]);
    expect(domainHealthDiagnosis(clean, true)).toBe('No delivery anomalies in this window.');
  });

  // Two sends with no news is normal; six is a pattern.
  it('does not cry wolf on a domain with fewer than three accepted sends', () => {
    const thin = summariseByDomain([
      { recipient: 'a@hotmail.com', status: 'sent' },
      { recipient: 'b@hotmail.com', status: 'sent' },
    ]);
    expect(domainHealthDiagnosis(thin, true)).toBe('No delivery anomalies in this window.');
  });
});
