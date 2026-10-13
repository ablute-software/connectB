// Prompt 900 — what the side panel of each action in Startups › "Closed & deleted" says and sends. Pure and separate from the
// component so the wording that matters (what a Release does to the LAST member; what Reopen restores) is testable text, not
// something only a screenshot can check.
import { liveHatNames, type ClosedAccount, type ClosedAccountMember } from './closed-accounts';

export type PanelRequest =
  | { kind: 'release'; account: ClosedAccount; member: ClosedAccountMember }
  | { kind: 'reopen'; account: ClosedAccount }
  | { kind: 'owner_reopen'; account: ClosedAccount };

export interface PanelSpec {
  title: string;
  name: string;
  lead: string;
  heading: string;
  lines: string[];
  confirmLabel: string;
  /** The written confirmation: the e-mail being released, or the account being reopened. */
  confirmPhrase: string;
  reasonPlaceholder: string;
  tone: 'danger' | 'restore';
  url: string;
  body: (reason: string) => Record<string, unknown>;
  /** The line shown after the request succeeded. `result` is whatever the route answered. */
  success: (result: Record<string, unknown> | null | undefined) => string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function panelSpec(req: PanelRequest): PanelSpec {
  const a = req.account;
  const reasonPlaceholder = 'Who asked, through which channel, and why?';

  if (req.kind === 'release') {
    const m = req.member;
    const state = a.moderationStatus === 'deleted' ? 'deleted' : 'closed';
    const hats = liveHatNames(m.hats);
    const lastMember = a.members.length === 1 && !a.closedAt;
    return {
      title: 'Release email',
      name: m.email,
      lead: `${m.email} — ${m.role ?? 'member'} of “${a.name}”, an account that is ${state}.`,
      heading: 'This will:',
      lines: [
        `Remove ${m.email} from “${a.name}”. The account itself stays ${state}.`,
        'Keep the person: the sign-in (auth user) and the blocked list are not touched.',
        hats.length > 0
          ? `After this, ${m.email} resolves by what it still holds — today: ${hats.join(' · ')}.`
          : `After this, ${m.email} holds nothing else yet — an ecosystem-organisation invitation or an investor claim gives it a place to land.`,
        ...(lastMember
          ? ['This is the last member, so the product’s existing rule closes the account as well: closed_at is set, the platform suspension and the MatchDeal-profile suspension are added, and its data-room grants are revoked.']
          : []),
        'Recorded in the audit log, with your reason.',
      ],
      confirmLabel: 'Confirm release',
      confirmPhrase: m.email,
      reasonPlaceholder,
      tone: 'danger',
      url: '/api/backoffice/closed-accounts/release-email',
      body: (reason) => ({ orgId: a.orgId, userId: m.userId, reason }),
      success: (r) => `Released ${m.email} from “${a.name}”.${r?.closedByThisRelease === true ? ' It was the last member, so the account was also closed.' : ''} The e-mail can now be used in another capacity.`,
    };
  }

  if (req.kind === 'reopen') {
    const n = a.members.length;
    return {
      title: 'Reopen account',
      name: a.name,
      lead: `“${a.name}” — deleted by moderation${day(a.deleted?.at ?? null) ? ` on ${day(a.deleted?.at ?? null)}` : ''}, ${n} ${plural(n, 'member', 'members')}.`,
      heading: 'This will:',
      lines: [
        `Set “${a.name}” back to active.`,
        'Clear its quarantine and suspension dates.',
        `Put it back in investor discovery and MatchDeal${n > 0 ? `, and let its ${n} ${plural(n, 'member', 'members')} sign in to it again` : ''}.`,
        'Recorded in the moderation history and the audit log, with your reason.',
      ],
      confirmLabel: 'Confirm reopen',
      confirmPhrase: a.name,
      reasonPlaceholder,
      tone: 'restore',
      url: '/api/backoffice/closed-accounts/reopen',
      body: (reason) => ({ orgId: a.orgId, reason }),
      success: () => `Reopened “${a.name}”. It is active again.`,
    };
  }

  const left = a.daysToPurge ?? 0;
  return {
    title: 'Reopen account',
    name: a.name,
    lead: `“${a.name}” — closed by its owner${day(a.closedAt) ? ` on ${day(a.closedAt)}` : ''}, ${left} ${plural(left, 'day', 'days')} left in the retention window.`,
    heading: 'This will:',
    lines: [
      'Reverse the closure: closed_at, the platform suspension it added and the MatchDeal-profile suspension.',
      'Leave the data-room grants revoked — the founder re-grants them.',
      'Recorded in the audit log and the account’s security events, with your reason.',
    ],
    confirmLabel: 'Confirm reopen',
    confirmPhrase: a.name,
    reasonPlaceholder,
    tone: 'restore',
    url: '/api/backoffice/reopen-org',
    body: (reason) => ({ orgId: a.orgId, reason }),
    success: () => `Reopened “${a.name}” inside its retention window.`,
  };
}
