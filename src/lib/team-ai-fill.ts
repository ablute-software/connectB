// Prompt 357 §B — pure schema + parsing shared by "Fill with Watson" and
// "Call Sherlock". Both tools return the SAME two base fields (members[],
// team_synergy); Sherlock's tool adds a third (facts[], the web-search
// proposals). Kept as one file since the parsing discipline is identical:
// never trust a person_name the model returns — only ever accept it if it
// matches a name already on the founder's own roster (company_people),
// exactly the same "never invent a person" guardrail investor-facing
// extraction already applies to programs/named_entities.
import { removeFactSentencesFromBio, stripUnverifiedHqClaims, detectFoundedYearConflict, capConfidenceOnConflict } from './team-bio-guard';

export interface RosterMember { id: string; fullName: string; title: string | null; currentBio?: string | null }
export interface TeamBioDraft { personId: string; personName: string; bio: string }
export interface TeamFillResult { members: TeamBioDraft[]; teamSynergy: string | null }

export const TEAM_FILL_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    members: {
      type: 'array',
      description: 'One entry per team member you could identify in the provided material.',
      items: {
        type: 'object',
        properties: {
          person_name: { type: 'string', description: 'Must match one of the team member names given to you exactly.' },
          bio: { type: 'string', description: 'A factual 2-3 sentence bio, only from what the provided material actually says.' },
        },
        required: ['person_name', 'bio'],
      },
    },
    team_synergy: {
      type: 'string',
      description: 'A short synthesis of why this team works well together — complementary profiles — derived only from the provided material.',
    },
  },
  required: ['members', 'team_synergy'],
};

// Prompt 357 §B2 — Sherlock's tool adds `facts`: the SAME propose_fields
// shape (field/value/confidence/source_url) entity-enrichment.ts and
// backoffice/research already use, scoped here to `statement` instead of a
// structured entity field (there's no single column a "fact about a
// person's background" would map to) — the founder approves each one
// before it ever becomes part of a bio, never auto-inserted.
export interface TeamFactProposal { personId: string; personName: string; statement: string; confidence: number; sourceUrl: string }
// Prompt 376 §C — a web fact that disagrees with data the app already
// trusts (e.g. orgs.founded_year), surfaced as an explicit two-sided
// question — never an assumption that either side is the correct one (the
// real ablute_ case: the web said 2019, the app said 2020, and 2019 was the
// one that was actually right).
export interface TeamFactConflict { personId: string; personName: string; statement: string; sourceUrl: string; field: 'founded_year'; webValue: number; appValue: number }
export interface TeamResearchResult extends TeamFillResult { facts: TeamFactProposal[]; conflicts: TeamFactConflict[] }

export const TEAM_RESEARCH_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    ...TEAM_FILL_TOOL_SCHEMA.properties,
    facts: {
      type: 'array',
      description: 'Individual researched facts about a team member, each with a real source URL and confidence — never auto-applied, the founder reviews each one.',
      items: {
        type: 'object',
        properties: {
          person_name: { type: 'string', description: 'Must match one of the team member names given to you exactly.' },
          statement: { type: 'string' },
          confidence: { type: 'number' },
          source_url: { type: 'string' },
        },
        required: ['person_name', 'statement', 'confidence', 'source_url'],
      },
    },
  },
  required: ['members', 'team_synergy', 'facts'],
};

function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function isHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  try {
    return new URL(s).protocol === 'https:' || new URL(s).protocol === 'http:';
  } catch {
    return false;
  }
}

interface RawMember { person_name?: unknown; bio?: unknown }

function parseMembers(raw: unknown, roster: RosterMember[]): TeamBioDraft[] {
  const byNormalizedName = new Map(roster.map((m) => [normalizeName(m.fullName), m]));
  if (!Array.isArray(raw)) return [];
  const out: TeamBioDraft[] = [];
  for (const m of raw as RawMember[]) {
    if (!m || typeof m.person_name !== 'string' || typeof m.bio !== 'string' || !m.bio.trim()) continue;
    const match = byNormalizedName.get(normalizeName(m.person_name));
    if (!match) continue; // never a person outside the founder's own roster
    out.push({ personId: match.id, personName: match.fullName, bio: m.bio.trim() });
  }
  return out;
}

export function rawTeamFillToResult(raw: unknown, roster: RosterMember[]): TeamFillResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { members?: unknown; team_synergy?: unknown };
  return {
    members: parseMembers(r.members, roster),
    teamSynergy: typeof r.team_synergy === 'string' && r.team_synergy.trim() ? r.team_synergy.trim() : null,
  };
}

interface RawFact { person_name?: unknown; statement?: unknown; confidence?: unknown; source_url?: unknown }

export interface TeamResearchOrgContext { hqCity?: string | null; foundedYear?: number | null }

export function rawTeamResearchToResult(raw: unknown, roster: RosterMember[], orgContext: TeamResearchOrgContext = {}): TeamResearchResult {
  const base = rawTeamFillToResult(raw, roster);
  const byNormalizedName = new Map(roster.map((m) => [normalizeName(m.fullName), m]));
  const r = (raw && typeof raw === 'object' ? raw : {}) as { facts?: unknown };
  const rawFacts: TeamFactProposal[] = [];
  if (Array.isArray(r.facts)) {
    for (const f of r.facts as RawFact[]) {
      if (!f || typeof f.person_name !== 'string' || typeof f.statement !== 'string' || !f.statement.trim()) continue;
      if (typeof f.confidence !== 'number' || !isHttpUrl(f.source_url)) continue;
      const match = byNormalizedName.get(normalizeName(f.person_name));
      if (!match) continue;
      rawFacts.push({ personId: match.id, personName: match.fullName, statement: f.statement.trim(), confidence: f.confidence, sourceUrl: f.source_url });
    }
  }

  // Prompt 376 §C — detect a fact that disagrees with orgs.founded_year
  // BEFORE deciding its final confidence; a conflicting fact is capped,
  // never left at whatever the model happened to report (the real ablute_
  // case reported 100% confidence for a claim that turned out to be right,
  // but the app had no way to know that in advance — the conflict itself is
  // what must lower the presented confidence, regardless of which side
  // later turns out correct).
  const conflicts: TeamFactConflict[] = [];
  const facts = rawFacts.map((f) => {
    const yearConflict = detectFoundedYearConflict(f.statement, orgContext.foundedYear ?? null);
    if (!yearConflict) return f;
    conflicts.push({
      personId: f.personId, personName: f.personName, statement: f.statement, sourceUrl: f.sourceUrl,
      field: 'founded_year', webValue: yearConflict.webYear, appValue: yearConflict.appYear,
    });
    return { ...f, confidence: capConfidenceOnConflict(f.confidence) };
  });

  // Prompt 376 §B/§D — every bio, cleaned the same way regardless of
  // whether it came with matching facts: (1) any sentence substantially
  // overlapping an UNAPPROVED fact is stripped (the fact stays in facts[],
  // where the founder actually reviews it) and (2) any HQ/location claim
  // that doesn't match what the org already has on file is stripped too —
  // the real ablute_ "headquarters in Porto" case had no backing fact at
  // all, so this check runs independently of §B's fact-overlap removal.
  const factStatementsByPerson = new Map<string, string[]>();
  for (const f of facts) factStatementsByPerson.set(f.personId, [...(factStatementsByPerson.get(f.personId) ?? []), f.statement]);
  const members = base.members.map((m) => {
    const afterFacts = removeFactSentencesFromBio(m.bio, factStatementsByPerson.get(m.personId) ?? []);
    const afterHq = stripUnverifiedHqClaims(afterFacts.bio, orgContext.hqCity ?? null);
    return { ...m, bio: afterHq.bio };
  });

  return { members, teamSynergy: base.teamSynergy, facts, conflicts };
}
