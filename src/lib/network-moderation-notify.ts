// Prompt 531 — the notification the reported startup receives when a strike
// is applied, and when its appeal is decided.
//
// Reuses lib/resend.ts (sendTransactionalEmail + transactionalTemplate),
// the same transactional infrastructure every other notification in this
// app goes through — the request is explicit that no second notification
// system should appear for this.
//
// THE RULE THAT GOVERNS THIS FILE: the recipient is the reported party. The
// email may say what SherlockDeal decided and show the content it decided
// about. It may never carry who reported it, what category or free text
// they submitted, how many people reported it, or any internal moderator
// note. That is why this module composes from a ReportedContentSnapshot and
// a strike count — it is never handed the support ticket at all, so there is
// nothing here for a reporter detail to leak out of.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTransactionalEmail, transactionalTemplate, resendConfigured } from './resend';
import { APP_URL, BRAND_NAME } from './brand';
import { strikeConsequenceLine, type ReportedContentSnapshot } from './network-moderation';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A short, unambiguous rendering of the struck content, so "which post?"
 *  is never a question the recipient has to guess at (§20) — including when
 *  the post has already been removed from the network. */
function contentBlock(snapshot: ReportedContentSnapshot | null): string {
  if (!snapshot || (!snapshot.body && !snapshot.createdAt)) {
    return '<p style="font-size:13px;color:#6B7280;">The content is shown in full on the moderation page linked below.</p>';
  }
  const when = snapshot.createdAt ? new Date(snapshot.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const excerpt = snapshot.body.length > 400 ? `${snapshot.body.slice(0, 400)}…` : snapshot.body;
  return `<div style="margin:12px 0;padding:12px;border-left:3px solid #E5E7EB;background:#F9FAFB;">`
    + (when ? `<div style="font-size:11px;color:#9CA3AF;margin-bottom:6px;">Posted ${when}</div>` : '')
    + `<div style="font-size:13px;color:#374151;white-space:pre-wrap;">${escapeHtml(excerpt)}</div></div>`;
}

/** Every address that should hear about a moderation decision against this
 *  actor: the org's members for a founder, the investor's own account for an
 *  investor profile. */
export async function resolveActorEmails(admin: SupabaseClient, actorId: string): Promise<string[]> {
  const { data: actor } = await admin.from('network_actors')
    .select('org_id, matchdeal_profile_id').eq('id', actorId).maybeSingle();
  if (!actor) return [];

  const userIds: string[] = [];
  if (actor.org_id) {
    const { data: members } = await admin.from('org_members').select('user_id').eq('org_id', actor.org_id);
    userIds.push(...(members ?? []).map((m) => m.user_id as string));
  } else if (actor.matchdeal_profile_id) {
    const { data: profile } = await admin.from('matchdeal_profiles')
      .select('membership_id, kind').eq('id', actor.matchdeal_profile_id).maybeSingle();
    if (profile?.membership_id) {
      const { data: membership } = await admin.from('matchdeal_investor_members')
        .select('user_id').eq('id', profile.membership_id).maybeSingle();
      if (membership?.user_id) userIds.push(membership.user_id as string);
    }
  }

  const emails = new Set<string>();
  await Promise.all([...new Set(userIds)].map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emails.add(data.user.email.toLowerCase());
  }));
  return [...emails];
}

export interface NotifyResult { sent: number; attempted: number }

/**
 * "A Network post of yours received a strike" — with the content, the
 * consequence, and the way to contest it.
 *
 * Never says who reported it or why they said they did.
 */
export async function notifyStrikeApplied(admin: SupabaseClient, params: {
  actorId: string; snapshot: ReportedContentSnapshot | null; activeStrikeCount: number; banned: boolean; contentRemoved: boolean;
}): Promise<NotifyResult> {
  const emails = await resolveActorEmails(admin, params.actorId);
  if (!resendConfigured || emails.length === 0) return { sent: 0, attempted: emails.length };

  const heading = 'A My Network post of yours received a strike';
  const html = transactionalTemplate({
    heading,
    body: `Our moderation team reviewed one of your My Network posts and found it in breach of the My Network rules.`
      + (params.contentRemoved ? ' The post has been removed from My Network.' : '')
      + `<br/><br/><strong>The content in question:</strong>`
      + contentBlock(params.snapshot)
      + `<strong>What this means:</strong> ${escapeHtml(strikeConsequenceLine(params.activeStrikeCount, params.banned))}`
      + `<br/><br/>If you believe this was a mistake, you can contest the decision from My Network.`,
    ctaLabel: 'Contest decision',
    ctaUrl: `${APP_URL}/network`,
    footer: `Sent by ${BRAND_NAME} moderation. Reports are confidential — we never share who raised one.`,
  });

  let sent = 0;
  await Promise.all(emails.map(async (to) => {
    const r = await sendTransactionalEmail({ to, subject: heading, html });
    if (r.sent) sent += 1;
  }));
  return { sent, attempted: emails.length };
}

/** The appeal outcome. Same rule: the decision, never the complaint behind
 *  it, and never the moderator's internal note. */
export async function notifyAppealDecided(admin: SupabaseClient, params: {
  actorId: string; outcome: 'upheld' | 'reversed'; snapshot: ReportedContentSnapshot | null;
  activeStrikeCount: number; banned: boolean;
}): Promise<NotifyResult> {
  const emails = await resolveActorEmails(admin, params.actorId);
  if (!resendConfigured || emails.length === 0) return { sent: 0, attempted: emails.length };

  const reversed = params.outcome === 'reversed';
  const heading = reversed ? 'Your strike has been reversed' : 'Your appeal has been reviewed';
  const html = transactionalTemplate({
    heading,
    body: reversed
      ? 'We reviewed your appeal and reversed the strike. It no longer counts against your account.'
        + `<br/><br/><strong>The content in question:</strong>${contentBlock(params.snapshot)}`
        + `<strong>Where this leaves you:</strong> ${escapeHtml(strikeConsequenceLine(params.activeStrikeCount, params.banned))}`
      : 'We reviewed your appeal. After a second look, the strike stands.'
        + `<br/><br/><strong>The content in question:</strong>${contentBlock(params.snapshot)}`
        + `<strong>Where this leaves you:</strong> ${escapeHtml(strikeConsequenceLine(params.activeStrikeCount, params.banned))}`,
    ctaLabel: 'Open My Network',
    ctaUrl: `${APP_URL}/network`,
    footer: `Sent by ${BRAND_NAME} moderation. Reports are confidential — we never share who raised one.`,
  });

  let sent = 0;
  await Promise.all(emails.map(async (to) => {
    const r = await sendTransactionalEmail({ to, subject: heading, html });
    if (r.sent) sent += 1;
  }));
  return { sent, attempted: emails.length };
}
