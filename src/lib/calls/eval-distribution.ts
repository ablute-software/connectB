// Prompt 922 (I2) — who evaluates what: the BALANCED automatic distribution, and the conflicts of interest. Pure: the route gathers the facts (the team members with "Evaluate assigned applications", the
// applications that are Fit, the assignments already made, the conflicts), this decides. Only the applications of ONE call are ever considered.
//
//   • Each application gets N evaluators (N chosen by the entity, no maximum, default 2) — or every evaluator ("All evaluators evaluate every application"). If N is more than the people available, everyone
//     available is used and the screen says so.
//   • The load stays EQUAL between evaluators: each application takes the N evaluators who currently have the least work (ties broken by user id, so the result is stable).
//   • A conflicted pair is never assigned; one that already was is removed and the application is filled in again — never the other way round (nothing is hidden or moved without being said).
import { GENERIC_EMAIL_DOMAINS, domainOf } from './duplicates';

export interface Pair { applicationId: string; userId: string }
const key = (a: string, u: string): string => `${a}:${u}`;

export interface DistributionInput {
  /** The applications to distribute (Fit and submitted), in the order they should be considered. */
  applications: { applicationId: string }[];
  /** Everyone who may evaluate (the team members with "Evaluate assigned applications"). */
  evaluators: { userId: string }[];
  /** How many evaluators per application, or all of them. */
  n: number | 'all';
  /** What is already assigned (counts as load, and is kept). */
  existing: Pair[];
  /** Pairs that must not be assigned: automatic and declared conflicts. */
  blocked: Pair[];
}

export interface DistributionResult {
  /** New assignments to make. */
  add: Pair[];
  /** Applications that could not get all the evaluators wanted, with how many they have and wanted. */
  shortfalls: { applicationId: string; wanted: number; got: number }[];
  /** The load of each evaluator after the new assignments. */
  loads: Record<string, number>;
  /** The N actually used: never more than the people available (and the screen says when it was lowered). */
  effectiveN: number;
  /** "You asked for 5 evaluators per application but only 3 people can evaluate: every application gets all 3." */
  warning: string | null;
}

export function distribute(input: DistributionInput): DistributionResult {
  const ids = [...new Set(input.evaluators.map((e) => e.userId))].sort();
  const wantedN = input.n === 'all' ? ids.length : input.n;
  const effectiveN = Math.min(wantedN, ids.length);
  const blocked = new Set(input.blocked.map((p) => key(p.applicationId, p.userId)));
  const has = new Map<string, Set<string>>();
  const loads: Record<string, number> = Object.fromEntries(ids.map((u) => [u, 0]));
  for (const p of input.existing) {
    if (!(p.userId in loads)) continue;
    (has.get(p.applicationId) ?? has.set(p.applicationId, new Set()).get(p.applicationId)!).add(p.userId);
    loads[p.userId]++;
  }
  const add: Pair[] = []; const shortfalls: DistributionResult['shortfalls'] = [];
  for (const app of input.applications) {
    const mine = has.get(app.applicationId) ?? new Set<string>();
    const wanted = input.n === 'all' ? ids.filter((u) => !blocked.has(key(app.applicationId, u))).length : effectiveN;
    const need = Math.max(0, (input.n === 'all' ? wanted : effectiveN) - mine.size);
    const candidates = ids.filter((u) => !mine.has(u) && !blocked.has(key(app.applicationId, u))).sort((a, b) => loads[a] - loads[b] || (a < b ? -1 : 1));
    const take = candidates.slice(0, need);
    for (const u of take) { add.push({ applicationId: app.applicationId, userId: u }); loads[u]++; mine.add(u); }
    has.set(app.applicationId, mine);
    if (mine.size < effectiveN || (input.n === 'all' && mine.size < wanted)) shortfalls.push({ applicationId: app.applicationId, wanted: Math.max(effectiveN, wanted), got: mine.size });
  }
  const warning = input.n !== 'all' && input.n > ids.length
    ? `${input.n} evaluators per application were asked for but only ${ids.length} ${ids.length === 1 ? 'person can' : 'people can'} evaluate: ${ids.length === 0 ? 'nobody can be assigned yet' : `every application gets ${ids.length === 1 ? 'that person' : `all ${ids.length}`}`}.`
    : null;
  return { add, shortfalls, loads, effectiveN, warning };
}

/** After a conflict (declared, or found) or a person leaving: drops the assignments in conflict and fills in the applications again, saying what changed. Nothing is applied here — it is the PREVIEW. */
export function redistribute(input: DistributionInput): { remove: Pair[]; add: Pair[]; shortfalls: DistributionResult['shortfalls']; loads: Record<string, number>; warning: string | null } {
  const blocked = new Set(input.blocked.map((p) => key(p.applicationId, p.userId)));
  const evaluators = new Set(input.evaluators.map((e) => e.userId));
  const remove = input.existing.filter((p) => blocked.has(key(p.applicationId, p.userId)) || !evaluators.has(p.userId));
  const dropped = new Set(remove.map((p) => key(p.applicationId, p.userId)));
  const kept = input.existing.filter((p) => !dropped.has(key(p.applicationId, p.userId)));
  const r = distribute({ ...input, existing: kept });
  return { remove, add: r.add, shortfalls: r.shortfalls, loads: r.loads, warning: r.warning };
}

/** The loads of a set of assignments, per evaluator. */
export function loadsOf(pairs: Pair[], evaluators: string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(evaluators.map((u) => [u, 0]));
  for (const p of pairs) if (p.userId in out) out[p.userId]++;
  return out;
}

// --- Conflicts of interest -----------------------------------------------------------------------------------------------------------------------------

export type ConflictCode = 'member_of_applicant_org' | 'same_domain' | 'also_applicant';
export const CONFLICT_TEXT: Record<ConflictCode | 'declared', string> = {
  member_of_applicant_org: 'is a member of the applying startup', same_domain: 'has the same company email domain as a member of the startup', also_applicant: 'is already in another application of the same startup, as an applicant', declared: 'declared a conflict',
};

export interface ConflictFacts {
  /** The evaluator. */
  userId: string; email: string | null;
  /** The application: its startup, the people of that startup (user ids and emails) and everyone who applied for that startup in this call. */
  application: { applicationId: string; startupOrgId: string | null; memberUserIds: string[]; memberEmails: string[]; applicantUserIds: string[] };
}

/** The automatic conflict of an evaluator with an application, if any. The first that applies is reported. */
export function autoConflict(f: ConflictFacts): { code: ConflictCode; text: string } | null {
  const a = f.application;
  if (a.memberUserIds.includes(f.userId)) return { code: 'member_of_applicant_org', text: CONFLICT_TEXT.member_of_applicant_org };
  const mine = f.email ? domainOf(f.email) : null;
  if (mine && !GENERIC_EMAIL_DOMAINS.has(mine) && a.memberEmails.some((e) => domainOf(e) === mine)) return { code: 'same_domain', text: CONFLICT_TEXT.same_domain };
  if (a.applicantUserIds.includes(f.userId)) return { code: 'also_applicant', text: CONFLICT_TEXT.also_applicant };
  return null;
}
