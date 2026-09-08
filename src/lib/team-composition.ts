// Prompt 613 §E — team composition: which functions this business has to
// have covered, who covers them, and what is missing.
//
// This is the useful version of the card that lies today. §B: the Knowledge
// health panel told a founder with three named founders on file, one of them
// titled CTO, that there were "only 0 named person(s)" and that "no one
// answers who leads the technical side". Both false, and both for the same
// reason — the rules counted names found inside team CLAIMS while the
// founder had entered the team in `company_people`, a different table. A
// check that asks for what the founder already gave is worse than no check:
// it teaches them to ignore the panel, and the true sentences beside it stop
// being read too.
//
// So the principle first, and it outlives this fix: every rule has to be
// able to say which table it read. This module reads the roster, and only
// the roster.
//
// §E's fourth point is what makes this a product rather than a telling-off:
// an absent function has TWO exits, assign it to someone or mark it as a
// hire. "Hiring: finance" is a normal, credible sentence for a seed company
// and says more to an investor than silence does.
import type { TeamCommitment } from './types';

export type RoleKey =
  | 'technical' | 'commercial' | 'product' | 'operations'
  | 'finance' | 'regulatory' | 'design' | 'data';

export interface RoleSpec {
  key: RoleKey;
  /** How the founder hears it. Never the key (Prompt 613 §A). */
  label: string;
  /** Why this business needs it — shown next to the gap, so the ask is arguable. */
  why: string;
}

export interface TeamMember {
  id: string;
  fullName: string;
  title: string | null;
  isFounder: boolean;
  /** §F — null until someone answers. Never assumed. */
  commitment?: TeamCommitment | null;
  /** §E.4 — a role the founder assigned by hand, overriding the title match. */
  assignedRoles?: RoleKey[];
}

export interface CompanyProfile {
  sectors?: (string | null)[] | null;
  stage?: string | null;
}

// Title matching. Deliberately generous on the technical side and cautious
// everywhere else: a false "covered" hides a real hole, which is the failure
// that costs a founder a round; a false "absent" costs one click to correct
// (§E.4 assign), which is why the assignment exit exists.
const ROLE_PATTERNS: Record<RoleKey, RegExp> = {
  technical: /\b(cto|tech(nical)?\s*(lead|director)?|engineer(ing)?|developer|architect|hardware|software|t[eé]cnic\w*|engenh\w*)\b/i,
  commercial: /\b(cco|cro|commercial|sales|business\s*development|bizdev|growth|marketing|cmo|comercial|vendas)\b/i,
  product: /\b(cpo|product|ux\s*lead|produto)\b/i,
  operations: /\b(coo|operations|ops|supply|logistics|manufactur\w*|opera[cç]\w*)\b/i,
  finance: /\b(cfo|financ\w*|controller|accounting|treasur\w*)\b/i,
  regulatory: /\b(regulatory|compliance|quality|qa\/ra|clinical|medical|cmo\b(?=.*medical)|regulament\w*)\b/i,
  design: /\b(design(er)?|creative\s*director|cdo)\b/i,
  data: /\b(data|machine\s*learning|\bml\b|\bai\b|scientist|analytics)\b/i,
};

const ROLE_LABEL: Record<RoleKey, string> = {
  technical: 'Technical', commercial: 'Commercial and go-to-market', product: 'Product',
  operations: 'Operations', finance: 'Finance', regulatory: 'Regulatory and quality',
  design: 'Design', data: 'Data and AI',
};

// A CEO covers nothing by title alone. The word says who is accountable, not
// which function they personally run — treating it as coverage is exactly
// how a one-person team reads as fully staffed.
const NON_SPECIFIC_TITLE = /^\s*(ceo|founder|co-?founder|managing\s*director|president|chair\w*|partner|s[oó]cio)\s*$/i;

// Same distinction ruleG3c already makes, and for the same reason: a
// pre-seed company has no round to manage yet, and a naive /seed/ matches
// inside "pre-seed".
const STAGE_WITH_A_ROUND = /(?<!pre[-\s]?)\bseed\b|\bseries\b/i;

const SECTOR_ROLES: { match: RegExp; roles: RoleKey[] }[] = [
  { match: /health|medical|clinic|pharma|biotech|medtech|sa[uú]de/i, roles: ['regulatory'] },
  { match: /fintech|insur|bank|payment|financ/i, roles: ['regulatory'] },
  { match: /marketplace|e-?commerce|retail|logistic|delivery|mobility|hardware|manufactur/i, roles: ['operations'] },
  { match: /\bai\b|artificial intelligence|machine learning|data|analytics/i, roles: ['data'] },
  { match: /consumer|social|media|gaming|marketplace/i, roles: ['design'] },
];

/**
 * §E.1 — which functions THIS business has to have covered. Derived from the
 * company's own profile, never a fixed list: a marketplace and a hardware
 * deeptech do not need the same thing.
 */
export function requiredRoles(profile: CompanyProfile): RoleSpec[] {
  const keys = new Set<RoleKey>(['technical', 'commercial', 'product']);

  if (profile.stage && STAGE_WITH_A_ROUND.test(profile.stage)) keys.add('finance');

  const sectorText = (profile.sectors ?? []).filter(Boolean).join(' ');
  for (const rule of SECTOR_ROLES) {
    if (rule.match.test(sectorText)) for (const r of rule.roles) keys.add(r);
  }

  const why: Record<RoleKey, string> = {
    technical: 'Someone has to own what you are building.',
    commercial: 'Someone has to own who buys it and how they hear about it.',
    product: 'Someone has to decide what gets built next, and what does not.',
    operations: 'This business runs on execution outside the product — supply, fulfilment, or the physical side.',
    finance: `At ${profile.stage ?? 'this stage'} there is a real round to manage, and investors ask who manages it.`,
    regulatory: 'This sector is regulated; an investor will ask who owns approval and quality before they ask about growth.',
    design: 'The customer meets this product through its interface before they meet anything else.',
    data: 'The claim rests on data or models, so someone has to be accountable for both.',
  };

  return [...keys].map((key) => ({ key, label: ROLE_LABEL[key], why: why[key] }));
}

export type CoverageState = 'covered' | 'thin' | 'absent';

export interface RoleCoverage {
  role: RoleSpec;
  state: CoverageState;
  owners: { id: string; name: string; title: string | null; commitment: TeamCommitment | null }[];
  /** One sentence a founder can act on. Never contains an internal id. */
  note: string;
}

function matchesRole(member: TeamMember, key: RoleKey): boolean {
  if (member.assignedRoles?.includes(key)) return true;
  const title = member.title ?? '';
  if (!title.trim() || NON_SPECIFIC_TITLE.test(title)) return false;
  return ROLE_PATTERNS[key].test(title);
}

/** Every role this member covers — used to detect one person carrying several. */
export function rolesOf(member: TeamMember, roles: RoleSpec[]): RoleKey[] {
  return roles.filter((r) => matchesRole(member, r.key)).map((r) => r.key);
}

/**
 * §E.2/§E.3 — the roster against the required functions, three states.
 *
 * `thin` is the state that earns this feature its keep: a function with an
 * owner who is also carrying two others, or whose only owner is part-time, is
 * not the same as one that is genuinely covered — and an investor reads that
 * difference whether or not the founder said it first.
 */
export function analyseTeamComposition(members: TeamMember[], profile: CompanyProfile): RoleCoverage[] {
  const roles = requiredRoles(profile);
  const loadByMember = new Map(members.map((m) => [m.id, rolesOf(m, roles).length]));

  return roles.map((role) => {
    const owners = members.filter((m) => matchesRole(m, role.key));
    if (owners.length === 0) {
      return {
        role, state: 'absent' as const, owners: [],
        note: `No one on the team is named for this. ${role.why}`,
      };
    }

    const ownerRows = owners.map((m) => ({
      id: m.id, name: m.fullName, title: m.title ?? null, commitment: m.commitment ?? null,
    }));
    const names = owners.map((m) => m.fullName).join(' and ');

    const stretched = owners.filter((m) => (loadByMember.get(m.id) ?? 0) >= 3);
    if (stretched.length === owners.length) {
      const who = stretched.map((m) => m.fullName).join(' and ');
      return {
        role, state: 'thin' as const, owners: ownerRows,
        note: `${who} covers this as well as ${(loadByMember.get(stretched[0].id) ?? 1) - 1} other functions.`,
      };
    }

    // A commitment nobody has answered is NOT read as part-time — an unknown
    // is unknown (§F: never assume full-time either).
    const declared = owners.filter((m) => m.commitment);
    if (declared.length === owners.length && declared.every((m) => m.commitment === 'part_time')) {
      return {
        role, state: 'thin' as const, owners: ownerRows,
        note: `${names} covers this part-time. Investors read that; saying it first is better than being caught by it.`,
      };
    }

    return { role, state: 'covered' as const, owners: ownerRows, note: `${names} owns this.` };
  });
}

/** The one-line summary the Knowledge health card shows instead of a count. */
export function compositionSummary(coverage: RoleCoverage[]): string {
  const absent = coverage.filter((c) => c.state === 'absent');
  const thin = coverage.filter((c) => c.state === 'thin');
  if (absent.length === 0 && thin.length === 0) return 'Every function this business needs has a named owner.';
  const parts: string[] = [];
  if (absent.length) parts.push(`${absent.map((c) => c.role.label.toLowerCase()).join(', ')} ${absent.length === 1 ? 'has' : 'have'} no owner`);
  if (thin.length) parts.push(`${thin.map((c) => c.role.label.toLowerCase()).join(', ')} ${thin.length === 1 ? 'is' : 'are'} covered thinly`);
  return `${parts.join('; ')}.`;
}
