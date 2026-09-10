// Prompt 585 §F.2 — buildHookPack: assembles the evidence pack the model
// sees, from data the route already fetched (this function does no I/O,
// so it's testable without a database or a model). Only real fields:
// `orgs` has no single "own thesis" text column (confirmed against the
// live schema before writing this) — `introProblem`/`introSolution`
// stand in for it, and traction is the real `TractionMetric` rows, never
// a fabricated summary string.
//
// Rule 6 (the prompt's own fixed rule): "hook da entidade nunca usa
// evidência pessoal de alguém como se se dirigisse a essa pessoa. Só
// evidência profissional e pública." Entity-target evidence is filtered
// here — defensively, even though the route should only ever pass
// entity-only rows (person_id null, which by construction can never be
// is_personal) — so a caller mistake never reaches the model.
export type HookChannel = 'platform_message' | 'linkedin' | 'email' | 'form';

export const CHANNEL_CHAR_LIMITS: Record<HookChannel, number> = {
  form: 400,
  email: 900,
  linkedin: 900,
  platform_message: 900,
};

export interface HookPackEvidence {
  id: string;
  kind: string;
  title: string;
  publishedAt: string | null;
  excerpt: string | null;
  topics: string[];
  isPersonal: boolean;
}

export interface HookPackInput {
  targetKind: 'person' | 'entity';
  channel: HookChannel;
  startup: {
    name: string;
    oneLiner: string | null;
    sectors: string[];
    orgTopics: string[];
    stage: string | null;
    roundTargetEur: number | null;
    traction: { label: string; value: string }[];
    introProblem: string | null;
    introSolution: string | null;
  };
  entity: {
    name: string;
    thesis: string | null;
    sectors: string[];
    stageMin: string | null;
    stageMax: string | null;
    checkMinEur: number | null;
    checkMaxEur: number | null;
    hqCountry: string | null;
    evidence: HookPackEvidence[]; // entity-only (person_id null)
    lastInvestments: { companyName: string; investedAt: string | null; roundType: string | null }[];
  };
  person: {
    fullName: string;
    title: string | null;
    seniorityLabel: string | null;
    bioRaw: string | null;
    evidence: HookPackEvidence[];
  } | null;
  relationship: { hasPriorContact: boolean; lastPassReason: string | null };
  watchOuts: { title: string; evidenceId: string }[];
  killWords: string[];
}

export interface HookPack {
  evidencePool: HookPackEvidence[];
  charLimit: number;
  promptText: string;
}

function fmtEur(v: number | null): string {
  return v == null ? 'unspecified' : `€${v.toLocaleString('en-US')}`;
}

function renderEvidenceList(list: HookPackEvidence[]): string {
  if (list.length === 0) return '(none on file)';
  return list.map((e) =>
    `- [${e.id}] (${e.kind}${e.publishedAt ? `, ${e.publishedAt}` : ''}) "${e.title}"${e.excerpt ? ` — "${e.excerpt}"` : ''}${e.topics.length ? ` [topics: ${e.topics.join(', ')}]` : ''}`,
  ).join('\n');
}

export function buildHookPack(input: HookPackInput): HookPack {
  const charLimit = CHANNEL_CHAR_LIMITS[input.channel] ?? 900;

  // Rule 6, enforced here regardless of what the caller passed.
  const entityEvidence = input.entity.evidence.filter((e) => !e.isPersonal);
  const personEvidence = input.targetKind === 'person' ? (input.person?.evidence ?? []) : [];
  const evidencePool = [...entityEvidence, ...personEvidence];

  const startupLines = [
    `Startup: ${input.startup.name}`,
    input.startup.oneLiner ? `One-liner: ${input.startup.oneLiner}` : null,
    input.startup.sectors.length ? `Sectors: ${input.startup.sectors.join(', ')}` : null,
    input.startup.orgTopics.length ? `Topics: ${input.startup.orgTopics.join(', ')}` : null,
    input.startup.stage ? `Stage: ${input.startup.stage}` : null,
    input.startup.roundTargetEur != null ? `Raising: ${fmtEur(input.startup.roundTargetEur)}` : null,
    input.startup.introProblem ? `Problem: ${input.startup.introProblem}` : null,
    input.startup.introSolution ? `Solution: ${input.startup.introSolution}` : null,
    input.startup.traction.length ? `Traction: ${input.startup.traction.map((t) => `${t.label}: ${t.value}`).join('; ')}` : null,
  ].filter(Boolean).join('\n');

  const entityLines = [
    `Fund: ${input.entity.name}`,
    input.entity.thesis ? `Thesis: ${input.entity.thesis}` : null,
    input.entity.sectors.length ? `Sectors: ${input.entity.sectors.join(', ')}` : null,
    (input.entity.stageMin || input.entity.stageMax) ? `Stage range: ${input.entity.stageMin ?? '?'} - ${input.entity.stageMax ?? '?'}` : null,
    (input.entity.checkMinEur != null || input.entity.checkMaxEur != null)
      ? `Ticket: ${fmtEur(input.entity.checkMinEur)} - ${fmtEur(input.entity.checkMaxEur)}` : null,
    input.entity.hqCountry ? `HQ: ${input.entity.hqCountry}` : null,
    input.entity.lastInvestments.length
      ? `Recent investments: ${input.entity.lastInvestments.map((i) => `${i.companyName}${i.investedAt ? ` (${i.investedAt})` : ''}`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
  const entityEvidenceBlock = `Fund evidence (institutional only):\n${renderEvidenceList(entityEvidence)}`;

  const personBlock = input.targetKind === 'person' && input.person ? [
    `Person: ${input.person.fullName}`,
    input.person.title ? `Title: ${input.person.title}` : null,
    input.person.seniorityLabel ? `Seniority: ${input.person.seniorityLabel}` : null,
    input.person.bioRaw ? `Bio: ${input.person.bioRaw.slice(0, 1500)}` : null,
    `Person evidence:\n${renderEvidenceList(personEvidence)}`,
  ].filter(Boolean).join('\n') : null;

  const relationshipLines = [
    `Prior contact: ${input.relationship.hasPriorContact ? 'yes' : 'no'}`,
    input.relationship.lastPassReason ? `Last pass reason: ${input.relationship.lastPassReason}` : null,
  ].filter(Boolean).join('\n');

  const watchOutLines = input.watchOuts.length
    ? input.watchOuts.map((w) => `- [${w.evidenceId}] ${w.title}`).join('\n') : '(none)';

  const sections = [
    `=== STARTUP ===\n${startupLines}`,
    `=== FUND ===\n${entityLines}\n${entityEvidenceBlock}`,
    personBlock ? `=== PERSON ===\n${personBlock}` : null,
    `=== RELATIONSHIP ===\n${relationshipLines}`,
    `=== CHANNEL ===\n${input.channel}, max ${charLimit} characters`,
    `=== WATCH OUTS ===\n${watchOutLines}`,
    input.killWords.length ? `=== KILL WORDS (never use) ===\n${input.killWords.join(', ')}` : null,
  ].filter(Boolean);

  return { evidencePool, charLimit, promptText: sections.join('\n\n') };
}

export function buildHookSystemPrompt(targetKind: 'person' | 'entity', charLimit: number): string {
  const addressing = targetKind === 'entity'
    ? 'The hook is addressed to the FUND, never to a named person — do not name or address any individual, even if fund evidence happens to mention one.'
    : 'The hook is addressed to the named PERSON — use evidence about them specifically, not generic fund evidence.';
  return [
    'You write a single short outreach opening line ("hook") for a founder reaching out to an investor or a person at an investor firm.',
    'You may ONLY use facts present in the pack below, and every factual claim you make must cite the evidence id(s) it came from.',
    'Never invent a fact, a number, or a connection that isn\'t in the pack. If there is nothing genuinely specific to say, return verdict "none" with a reason — do not force a generic hook.',
    addressing,
    `The hook_text must fit in ${charLimit} characters.`,
    'Never write anything that could be read as knowing a private/medical/family fact — only public, professional evidence.',
  ].join(' ');
}
