// Prompt I-01 §C.5 — the four incubator e-mails. Plain text, English (I-01b
// §C), no elaborate HTML in this prompt: the HTML part is the shared
// transactionalTemplate shell around the same text (escaped). Pure builders
// — the sending (resend.ts + email_send_log) is incubator-email-server.ts.
import { defaultLevelNotice } from '../incubators';

export interface BuiltEmail { subject: string; text: string; heading: string; body: string; ctaLabel?: string; ctaUrl?: string }

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The incubator's name leads — it is its brand that makes the invite
// trustworthy (I-01 §C.5).
export function startupInviteEmail(v: {
  incubatorName: string; startupName: string | null; url: string;
  voucher?: { planLabel: string; months: number | null } | null;
}): BuiltEmail {
  const startup = v.startupName?.trim() || 'your startup';
  const subject = `${v.incubatorName} invited ${startup} to Sherlock Deal`;
  const voucherLine = v.voucher
    ? `The invite includes a voucher: the ${v.voucher.planLabel} plan${v.voucher.months ? ` for ${v.voucher.months} months` : ''}, offered by ${v.incubatorName}.`
    : '';
  const body = [
    `${v.incubatorName} has invited ${startup} to follow the programme on Sherlock Deal.`,
    voucherLine,
    defaultLevelNotice(v.incubatorName),
    'Nothing is linked until you accept.',
  ].filter(Boolean).join('\n\n');
  const text = `${body}\n\nOpen the invite: ${v.url}\n\nThis link is personal to the invited address and expires in 30 days.`;
  return { subject, text, heading: `${v.incubatorName} invited you`, body, ctaLabel: 'View the invite', ctaUrl: v.url };
}

export function memberInviteEmail(v: { incubatorName: string; role: 'owner' | 'manager'; url: string }): BuiltEmail {
  const subject = `Join ${v.incubatorName}'s team on Sherlock Deal`;
  const body = `You have been invited as ${v.role === 'owner' ? 'an owner' : 'a programme manager'} of ${v.incubatorName}'s Ecosystem workspace on Sherlock Deal. Sign in with this email address to accept.`;
  const text = `${body}\n\nAccept the invite: ${v.url}\n\nThis link is personal and expires in 14 days.`;
  return { subject, text, heading: `${v.incubatorName}'s team`, body, ctaLabel: 'Accept', ctaUrl: v.url };
}

// To the founder, when the incubator ends the relationship (with its reason).
export function relationshipEndedByIncubatorEmail(v: { incubatorName: string; reason: string; url: string }): BuiltEmail {
  const subject = `${v.incubatorName} ended its relationship with your startup`;
  const body = `${v.incubatorName} ended the relationship on Sherlock Deal. From now on it no longer has access to anything you shared with it.\n\nReason given: ${v.reason}`;
  const text = `${body}\n\nSee your programmes: ${v.url}`;
  return { subject, text, heading: 'Relationship ended', body, ctaLabel: 'See programmes', ctaUrl: v.url };
}

// To the incubator, when the founder ends it (no reason if none was given).
export function relationshipEndedByFounderEmail(v: { startupName: string; reason: string | null; url: string }): BuiltEmail {
  const subject = `${v.startupName} ended its relationship with the programme`;
  const body = `${v.startupName} ended the relationship on Sherlock Deal. Live access to the startup's data ended immediately; the reports and notes you have already produced stay with you.`
    + (v.reason ? `\n\nReason given: ${v.reason}` : '');
  const text = `${body}\n\nOpen the portfolio: ${v.url}`;
  return { subject, text, heading: 'Relationship ended', body, ctaLabel: 'Open the portfolio', ctaUrl: v.url };
}
