// Prompt 918 (I1) — how the call editor is organised: four main tabs (Setup · Applications · Evaluation · Results) and, inside Setup, seven steps, each with its own state. Pure:
// what opens first, what an old link (?tab=form, ?tab=submissions…) means now, and the state of every step (✓ complete · ⚠ something is missing, with the number · not started).
import type { Call, CallPhase, CallStatus, FormField } from './types';
import type { ReadinessIssue } from './lifecycle';

export const MAIN_TABS = [
  { key: 'setup', label: 'Setup' },
  { key: 'applications', label: 'Applications' },
  { key: 'evaluation', label: 'Evaluation' },
  { key: 'results', label: 'Results' },
] as const;
export type MainTab = (typeof MAIN_TABS)[number]['key'];

export const STEPS = [
  { key: 'general', label: 'General' },
  { key: 'phases', label: 'Phases' },
  { key: 'form', label: 'Form' },
  { key: 'eligibility', label: 'Eligibility rules' },
  { key: 'team', label: 'Team & distribution' },
  { key: 'grid', label: 'Evaluation grid' },
  { key: 'review', label: 'Review & publish' },
] as const;
export type StepKey = (typeof STEPS)[number]['key'];

export interface Nav { main: MainTab; step: StepKey }

const isMain = (v: unknown): v is MainTab => MAIN_TABS.some((t) => t.key === v);
const isStep = (v: unknown): v is StepKey => STEPS.some((s) => s.key === v);

/** The links the editor had before the reorganisation: one tab per thing. They keep opening the right place. */
const LEGACY: Record<string, Nav> = {
  general: { main: 'setup', step: 'general' },
  phases: { main: 'setup', step: 'phases' },
  form: { main: 'setup', step: 'form' },
  eligibility: { main: 'setup', step: 'eligibility' },
  team: { main: 'setup', step: 'team' },
  preview: { main: 'setup', step: 'review' },
  submissions: { main: 'applications', step: 'general' },
  evaluation: { main: 'evaluation', step: 'general' },
};

/** A call being configured opens on Setup; one that was published (open, closed, archived) opens on Applications. */
export const defaultMain = (status: CallStatus): MainTab => (status === 'open' || status === 'closed' || status === 'archived' ? 'applications' : 'setup');

/**
 * Where a link points: the new `section` / `step`, or an old `tab`. Anything unknown falls back to the default for the call's state. A step named without a section
 * means Setup; an old "submissions" means Applications, whatever the state of the call.
 */
export function resolveNav(q: { tab?: string | null; section?: string | null; step?: string | null }, status: CallStatus): Nav {
  const section = q.section ?? null; const step = q.step ?? null; const tab = q.tab ?? null;
  if (isStep(step)) return { main: isMain(section) && section !== 'setup' ? section : 'setup', step };
  if (isMain(section)) return { main: section, step: 'general' };
  if (tab && Object.prototype.hasOwnProperty.call(LEGACY, tab)) return { ...LEGACY[tab] };
  if (isStep(tab)) return { main: 'setup', step: tab };
  if (isMain(tab)) return { main: tab, step: 'general' };
  return { main: defaultMain(status), step: 'general' };
}

/** The query that reaches a place (used to keep the address in step with what is shown, so a reload stays where it was). */
export const navQuery = (n: Nav): { section: MainTab; step?: StepKey } => (n.main === 'setup' ? { section: 'setup', step: n.step } : { section: n.main });

// --- The state of each step ------------------------------------------------------------------------------------

export interface StepState {
  kind: 'complete' | 'attention' | 'not_started' | 'soon';
  /** How many things are missing (kind "attention"). */
  count: number;
  icon: '✓' | '⚠' | '○' | '·';
  /** In words: "Complete", "2 to fix", "Not started", "Coming next". */
  label: string;
}

const complete = (): StepState => ({ kind: 'complete', count: 0, icon: '✓', label: 'Complete' });
const notStarted = (): StepState => ({ kind: 'not_started', count: 0, icon: '○', label: 'Not started' });
const attention = (n: number): StepState => ({ kind: 'attention', count: n, icon: '⚠', label: `${n} to fix` });
const soon = (label: string): StepState => ({ kind: 'soon', count: 0, icon: '·', label });

export interface StepContext { call: Pick<Call, 'name' | 'description' | 'opensAt' | 'closesAt' | 'status'>; phases: Pick<CallPhase, 'name' | 'startsOn' | 'endsOn'>[]; fields: Pick<FormField, 'id'>[]; eligibilityRules?: number; evalCriteria?: number; issues: ReadinessIssue[]; teamMembers: number }

const untitled = (name: string) => name.trim() === '' || name.trim() === 'Untitled call';

export function stepStates(c: StepContext): Record<StepKey, StepState> {
  const issuesOf = (tab: string) => c.issues.filter((i) => i.tab === tab);
  const general = (() => {
    const untouched = untitled(c.call.name) && !(c.call.description ?? '').trim() && !c.call.opensAt && !c.call.closesAt;
    if (untouched) return notStarted();
    const n = issuesOf('general').length;
    return n > 0 ? attention(n) : complete();
  })();
  const phases = (() => {
    // A call is created with one empty "Phase 1": that is not started.
    const untouched = c.phases.length === 0 || (c.phases.length === 1 && /^phase 1$/i.test(c.phases[0].name.trim()) && !c.phases[0].startsOn && !c.phases[0].endsOn);
    if (untouched) return notStarted();
    const n = issuesOf('phases').length;
    return n > 0 ? attention(n) : complete();
  })();
  const form = (() => {
    if (c.fields.length === 0) return notStarted();
    const n = issuesOf('form').length;
    return n > 0 ? attention(n) : complete();
  })();
  const total = c.issues.length;
  const review = total > 0 ? attention(total)
    : general.kind === 'complete' && phases.kind === 'complete' && form.kind === 'complete' ? complete() : notStarted();
  return {
    general, phases, form,
    // Prompt 918 (I2): optional — a call with no rule has every application Fit; ✓ once there is a rule and none of them is broken.
    eligibility: (() => { const n = issuesOf('eligibility').length; return n > 0 ? attention(n) : (c.eligibilityRules ?? 0) > 0 ? complete() : notStarted(); })(),
    // The person who created the call is on the team from the start: the step is "not started" until someone else has been added.
    team: c.teamMembers > 1 ? complete() : notStarted(),
    // Prompt 922 (I1): optional like the eligibility rules — not started without criteria, ⚠ while the weights do not add up, ✓ once they do.
    grid: (() => { const n = issuesOf('grid').length; return n > 0 ? attention(n) : (c.evalCriteria ?? 0) > 0 ? complete() : notStarted(); })(),
    review,
  };
}

/** Which step an issue belongs to ("What is missing" leads there). The editor's old tab names map one to one. */
export const stepOfIssue = (i: ReadinessIssue): StepKey => (i.tab === 'general' || i.tab === 'phases' || i.tab === 'form' || i.tab === 'eligibility' || i.tab === 'grid' || i.tab === 'team' ? i.tab : i.tab === 'preview' ? 'review' : 'general');

export const stepIndex = (s: StepKey): number => STEPS.findIndex((x) => x.key === s);
export const stepLabel = (s: StepKey): string => STEPS[stepIndex(s)].label;
export const neighbourStep = (s: StepKey, dir: -1 | 1): StepKey | null => STEPS[stepIndex(s) + dir]?.key ?? null;

/**
 * What the address says about where to be: the new `section` and `step`, and the old `tab` — but the old one only when the address names THIS call (`call=`), because other
 * pages use `?tab=` for themselves.
 */
export function parseLinkQuery(search: string, callId: string): { tab?: string; section?: string; step?: string } {
  const p = new URLSearchParams(search);
  const out: { tab?: string; section?: string; step?: string } = {};
  const section = p.get('section'); const step = p.get('step'); const tab = p.get('tab');
  if (section) out.section = section;
  if (step) out.step = step;
  if (tab && p.get('call') === callId) out.tab = tab;
  return out;
}
