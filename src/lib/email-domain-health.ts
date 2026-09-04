// Prompt 557 §3 — the shape of a receiver-side problem, at a glance.
//
// Six guest invites to one @hotmail.com address were all recorded 'sent'
// while Gmail and Proton addresses in the same period arrived fine. That
// pattern — one receiver failing while the others don't — is invisible in a
// flat list of sends, and it is the pattern that identifies a DNS/reputation
// problem rather than an app one. Grouped by receiving domain it is one
// glance.
//
// Pure so the grouping is unit-tested without a database: the route reads
// the rows, this decides what they mean.

/** Receiving domains worth their own row. Everything else lands in 'other'
 *  — the point is to separate the big consumer receivers, which have very
 *  different tolerance for a young sending domain, not to enumerate the
 *  internet. Microsoft's are grouped together because they are one system
 *  and one reputation. */
export const EMAIL_DOMAIN_BUCKETS: { key: string; label: string; domains: string[] }[] = [
  { key: 'gmail', label: 'Gmail', domains: ['gmail.com', 'googlemail.com'] },
  { key: 'microsoft', label: 'Hotmail / Outlook', domains: ['hotmail.com', 'hotmail.co.uk', 'outlook.com', 'outlook.pt', 'live.com', 'msn.com'] },
  { key: 'proton', label: 'Proton', domains: ['proton.me', 'protonmail.com', 'pm.me'] },
];
export const OTHER_BUCKET = { key: 'other', label: 'Other' };

export function bucketForRecipient(recipient: string | null | undefined): string {
  const domain = (recipient ?? '').split('@')[1]?.trim().toLowerCase();
  if (!domain) return OTHER_BUCKET.key;
  return EMAIL_DOMAIN_BUCKETS.find((b) => b.domains.includes(domain))?.key ?? OTHER_BUCKET.key;
}

export interface EmailHealthRow { recipient: string | null; status: string }

export interface DomainHealthBucket {
  key: string; label: string;
  sent: number; delivered: number; bounced: number; complained: number; delayed: number; failed: number;
  /** Rows still sitting at 'sent' with no provider event yet. Not a failure
   *  — but a bucket where NOTHING ever advances past 'sent' is exactly what
   *  a silently-dropping receiver looks like, so it is counted separately
   *  rather than folded into `sent`. */
  awaitingProviderEvent: number;
}

/**
 * `sent` counts every row that reached the provider, whatever happened
 * afterwards — so `delivered + bounced + … ≤ sent` and the ratio between
 * them is readable. A row that never reached the provider ('failed',
 * 'not_configured', 'render_failed') is counted only in `failed`: those are
 * our own failures, not the receiver's, and mixing them in would hide the
 * very comparison this exists to make.
 */
export function summariseByDomain(rows: EmailHealthRow[]): DomainHealthBucket[] {
  const labels = [...EMAIL_DOMAIN_BUCKETS, { ...OTHER_BUCKET, domains: [] as string[] }];
  const byKey = new Map<string, DomainHealthBucket>(labels.map((b) => [b.key, {
    key: b.key, label: b.label,
    sent: 0, delivered: 0, bounced: 0, complained: 0, delayed: 0, failed: 0, awaitingProviderEvent: 0,
  }]));

  for (const row of rows) {
    const bucket = byKey.get(bucketForRecipient(row.recipient));
    if (!bucket) continue;
    switch (row.status) {
      case 'failed': case 'not_configured': case 'render_failed':
        bucket.failed += 1; break;
      case 'sent':
        bucket.sent += 1; bucket.awaitingProviderEvent += 1; break;
      case 'delivered':
        bucket.sent += 1; bucket.delivered += 1; break;
      case 'bounced':
        bucket.sent += 1; bucket.bounced += 1; break;
      case 'complained':
        bucket.sent += 1; bucket.complained += 1; break;
      case 'delayed':
        bucket.sent += 1; bucket.delayed += 1; break;
      default:
        break;
    }
  }
  return [...byKey.values()];
}

/**
 * The one sentence the card leads with. Deliberately conservative about the
 * word "problem": until the webhook is configured every row sits at 'sent'
 * forever, and reporting that as a delivery failure would be exactly the
 * false alarm this feature exists to replace.
 */
export function domainHealthDiagnosis(buckets: DomainHealthBucket[], webhookConfigured: boolean): string {
  const totalSent = buckets.reduce((n, b) => n + b.sent, 0);
  if (totalSent === 0) return 'No emails sent in this window.';
  if (!webhookConfigured) {
    return 'RESEND_WEBHOOK_SECRET is not set, so nothing here can move past "sent" — '
      + 'these counts show what the provider ACCEPTED, not what arrived. Add the webhook endpoint in Resend to make this column mean delivery.';
  }
  const suspect = buckets.filter((b) => b.sent >= 3 && b.delivered === 0 && b.bounced === 0);
  if (suspect.length > 0) {
    return `${suspect.map((b) => b.label).join(', ')}: accepted by the provider but never confirmed delivered or bounced — `
      + 'the shape of a receiver dropping mail silently. Check SPF/DKIM/DMARC for the sending domain first.';
  }
  const bouncing = buckets.filter((b) => b.bounced > 0);
  if (bouncing.length > 0) return `Bounces on ${bouncing.map((b) => b.label).join(', ')} — open the log for the provider's reason.`;
  return 'No delivery anomalies in this window.';
}
