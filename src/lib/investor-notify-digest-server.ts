// Prompt 747 §B — the impure half of the daily investor notify-digest: DB
// reads, member-email resolution, the actual send, and the per-member
// watermark write. All decision-making (preference check, watermark
// comparison already applied by the query below, 8-line cap) lives in the
// pure investor-notify-digest.ts so it can be unit-tested without Supabase.
//
// Called ONLY from the daily cron (/api/automations), never from a request
// a firm's own member triggers by opening the Pipeline — see investor-
// notify-digest.ts's own header for why that decoupling is the point.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decideNotifyDigestForMember, type NewPipelineAdmission } from './investor-notify-digest';
import { sendTransactionalEmail, transactionalTemplate } from './resend';
import { isFirmTestOrInternal } from './investor-signal-events';
import { eligiblePipelineOrgIds } from './portal-access';
import { BRAND_NAME, APP_URL } from './brand';

export interface NotifyDigestSweepResult {
  membersEligible: number;
  emailsSent: number;
  emailsFailed: number;
  // The gap this closes: an admission can be genuinely `presented_at`-stamped
  // and still no longer belong in front of an investor by the time the 9am
  // digest runs — the org may have closed, been suspended (owner, platform,
  // or back-office), or been excluded from discovery outright since. Counted
  // here (a running total across every member this sweep run touches) rather
  // than silently dropped, so a spike is visible in the same log line/JSON
  // every other sweep counter already reports through. See
  // eligiblePipelineOrgIds (portal-access.ts) / filterEligibleOrgs
  // (pipeline-eligibility.ts) for the one shared "still visible today"
  // predicate this reuses — never a hand-rolled subset of its conditions
  // (that is exactly the Estojo incident pipeline-eligibility.ts's own header
  // describes).
  orgsSkippedNotVisible: number;
}

interface EligibleMemberRow {
  id: string;
  user_id: string;
  catalog_entity_id: string;
  notify_new_eligible_last_sent_at: string | null;
}

interface AdmissionRow {
  org_id: string;
  presented_at: string;
}

interface OrgRow {
  id: string;
  name: string | null;
  sectors: string[] | null;
  stage: string | null;
  country: string | null;
}

const PIPELINE_URL = `${APP_URL}/portal?tab=pipeline`;

function buildDigestEmail(lines: string[], overflowText: string | null): { html: string; text: string } {
  const bullets = [...lines, ...(overflowText ? [overflowText] : [])];
  const text = bullets.map((l) => `- ${l}`).join('\n');
  const body = `New in your pipeline:</p><ul style="margin:0;padding-left:20px">${
    bullets.map((l) => `<li>${escapeHtml(l)}</li>`).join('')
  }</ul><p>`;
  const html = transactionalTemplate({
    heading: 'New startups in your pipeline',
    body,
    ctaLabel: 'Open your Pipeline', ctaUrl: PIPELINE_URL,
  });
  return { html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One digest per eligible member per day, and only when there's something to
 * say — see decideNotifyDigestForMember's own "never an empty digest" rule.
 * Best-effort throughout: one member's failed lookup/send is caught, logged,
 * and skipped; it never aborts the sweep for the remaining members (same
 * discipline as every other job in /api/automations/route.ts).
 */
export async function runInvestorNotifyDigestSweep(admin: SupabaseClient, now: Date): Promise<NotifyDigestSweepResult> {
  const { data: members, error: membersError } = await admin.from('matchdeal_investor_members')
    .select('id, user_id, catalog_entity_id, notify_new_eligible_last_sent_at')
    .eq('status', 'active').eq('notify_new_eligible_startup', true);
  if (membersError) {
    console.error('[investor-notify-digest] failed to load eligible members:', membersError.message);
    return { membersEligible: 0, emailsSent: 0, emailsFailed: 0, orgsSkippedNotVisible: 0 };
  }
  const eligible = (members ?? []) as EligibleMemberRow[];
  if (eligible.length === 0) return { membersEligible: 0, emailsSent: 0, emailsFailed: 0, orgsSkippedNotVisible: 0 };

  let emailsSent = 0;
  let emailsFailed = 0;
  let orgsSkippedNotVisible = 0;

  for (const member of eligible) {
    try {
      // "Genuinely visible to the firm" per investor_pipeline_admissions.
      // presented_at's own column comment (migration 20260922130000) — never
      // reserved_at/admitted_at, which can still be behind a locked wave the
      // member can't actually see yet (see investor-notify-digest.ts's header).
      let query = admin.from('investor_pipeline_admissions')
        .select('org_id, presented_at')
        .eq('investor_catalog_entity_id', member.catalog_entity_id)
        .not('presented_at', 'is', null);
      // Null watermark (first-ever digest for this member) intentionally
      // applies no lower bound — every currently-presented admission counts,
      // catching the member up rather than starting silent.
      if (member.notify_new_eligible_last_sent_at) {
        query = query.gt('presented_at', member.notify_new_eligible_last_sent_at);
      }
      const { data: admissionRows, error: admissionsError } = await query;
      if (admissionsError) {
        console.error(`[investor-notify-digest] admissions query failed for member=${member.id}:`, admissionsError.message);
        emailsFailed++;
        continue;
      }
      const admissions = (admissionRows ?? []) as AdmissionRow[];
      if (admissions.length === 0) continue; // Nothing new — no query for org details, no email. Common case.

      const orgIds = admissions.map((a) => a.org_id);
      const { data: orgRows, error: orgsError } = await admin.from('orgs')
        .select('id, name, sectors, stage, country').in('id', orgIds);
      if (orgsError) {
        console.error(`[investor-notify-digest] org lookup failed for member=${member.id}:`, orgsError.message);
        emailsFailed++;
        continue;
      }
      const orgById = new Map(((orgRows ?? []) as OrgRow[]).map((o) => [o.id, o]));

      // Oldest-new-first — a stable, chronological reading order for "what
      // you missed," not the DB's own arbitrary return order.
      const sortedAdmissions = [...admissions].sort((a, b) => a.presented_at.localeCompare(b.presented_at));
      const allAdmissions: NewPipelineAdmission[] = sortedAdmissions.map((a) => {
        const org = orgById.get(a.org_id);
        return {
          orgId: a.org_id,
          name: org?.name ?? 'A startup',
          sector: org?.sectors?.[0] ?? null,
          stage: org?.stage ?? null,
          country: org?.country ?? null,
        };
      });

      // Prompt 747's own explicit call: send to test/internal firms too (the
      // recipient is the team member's OWN inbox, never founder-visible).
      // isTestOrInternal is per-FIRM (keyed on catalog_entity_id, which
      // varies member to member), so it's computed once here per member and
      // reused for both the eligibility check below and the observability
      // log line further down — never a second, divergent computation of the
      // same thing. It is NOT persisted: email_send_log (migration
      // 20260902170702) has no is_test_or_internal column — that concept
      // lives only on investor_signal_events / investor_opportunity_episodes
      // / investor_reevaluation_conditions today. Adding it to email_send_log
      // would be a schema change beyond this prompt's one authorized
      // migration (the watermark column) and Nuno's own sign-off scope, so
      // this is flagged here rather than silently done or silently skipped.
      const isTestOrInternal = await isFirmTestOrInternal(admin, member.catalog_entity_id);

      // The bug this closes: `presented_at` being set only means the admission
      // WAS shown once — it says nothing about whether the org is still
      // visible today. Between presentation and this 9am sweep the startup
      // may have closed its account, been suspended (owner, platform, or
      // back-office), or been excluded from discovery outright. Reusing
      // eligiblePipelineOrgIds (portal-access.ts) — which itself reuses
      // filterEligibleOrgs, the one shared "still eligible" predicate — is
      // deliberate: a hand-rolled subset of these conditions here is exactly
      // the Estojo incident (pipeline-eligibility.ts's own header) repeating
      // itself at a new call site.
      const eligibleOrgIdSet = new Set(await eligiblePipelineOrgIds(admin, isTestOrInternal));
      const newAdmissions = allAdmissions.filter((a) => eligibleOrgIdSet.has(a.orgId));
      orgsSkippedNotVisible += allAdmissions.length - newAdmissions.length;

      const decision = decideNotifyDigestForMember({ notifyEnabled: true, newAdmissions });
      if (!decision.send) {
        // Two ways to land here: nothing was ever new (already handled by the
        // admissions.length===0 guard above, so unreachable in practice), or
        // — the case this branch actually exists for — every admission since
        // the watermark turned out to be no-longer-visible. Either way the
        // presentation already happened and has now been examined, so the
        // watermark still advances (same "processed" semantics as a
        // successful send below); what must not happen is a name that's no
        // longer real/visible leaking into an email. Never an empty digest.
        const { error: watermarkError } = await admin.from('matchdeal_investor_members')
          .update({ notify_new_eligible_last_sent_at: now.toISOString() }).eq('id', member.id);
        if (watermarkError) {
          console.error(`[investor-notify-digest] watermark advance failed (all admissions filtered as not-visible) for member=${member.id}:`, watermarkError.message);
        }
        continue;
      }

      const { data: userResult, error: userError } = await admin.auth.admin.getUserById(member.user_id);
      const email = userResult?.user?.email;
      if (userError || !email) {
        console.error(`[investor-notify-digest] could not resolve email for member=${member.id}:`, userError?.message ?? 'no email on user');
        emailsFailed++;
        continue;
      }

      const { html, text } = buildDigestEmail(decision.lines, decision.overflowText);
      const result = await sendTransactionalEmail({
        to: email, subject: decision.subject, html, text,
        context: { kind: 'other' },
      });
      console.log(`[investor-notify-digest] member=${member.id} isTestOrInternal=${isTestOrInternal} sent=${result.sent}`);

      if (!result.sent) {
        // Best-effort: logged by sendTransactionalEmail itself already
        // (email_send_log, status='failed'). Watermark is deliberately NOT
        // advanced on failure, so tomorrow's run retries this same set
        // (plus anything newer) instead of silently losing it.
        emailsFailed++;
        continue;
      }

      const { error: watermarkError } = await admin.from('matchdeal_investor_members')
        .update({ notify_new_eligible_last_sent_at: now.toISOString() }).eq('id', member.id);
      if (watermarkError) {
        // The email already went out — logging this loudly matters more
        // than retrying, since retrying now would double-send.
        console.error(`[investor-notify-digest] sent but failed to stamp watermark for member=${member.id}:`, watermarkError.message);
      }
      emailsSent++;
    } catch (e) {
      console.error(`[investor-notify-digest] threw for member=${member.id}:`, (e as Error).message);
      emailsFailed++;
    }
  }

  return { membersEligible: eligible.length, emailsSent, emailsFailed, orgsSkippedNotVisible };
}
