// Prompt 357 §B — pure schema + parsing shared by "Fill with Watson" and
// "Call Sherlock". Both tools return the SAME two base fields (members[],
// team_synergy); Sherlock's tool adds a third (facts[], the web-search
// proposals). Kept as one file since the parsing discipline is identical:
// never trust a person_name the model returns — only ever accept it if it
// matches a name already on the founder's own roster (company_people),
// exactly the same "never invent a person" guardrail investor-facing
// extraction already applies to programs/named_entities.
export interface RosterMember { id: string; fullName: string; title: string | null }
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
export interface TeamResearchResult extends TeamFillResult { facts: TeamFactProposal[] }

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

export function rawTeamResearchToResult(raw: unknown, roster: RosterMember[]): TeamResearchResult {
  const base = rawTeamFillToResult(raw, roster);
  const byNormalizedName = new Map(roster.map((m) => [normalizeName(m.fullName), m]));
  const r = (raw && typeof raw === 'object' ? raw : {}) as { facts?: unknown };
  const facts: TeamFactProposal[] = [];
  if (Array.isArray(r.facts)) {
    for (const f of r.facts as RawFact[]) {
      if (!f || typeof f.person_name !== 'string' || typeof f.statement !== 'string' || !f.statement.trim()) continue;
      if (typeof f.confidence !== 'number' || !isHttpUrl(f.source_url)) continue;
      const match = byNormalizedName.get(normalizeName(f.person_name));
      if (!match) continue;
      facts.push({ personId: match.id, personName: match.fullName, statement: f.statement.trim(), confidence: f.confidence, sourceUrl: f.source_url });
    }
  }
  return { ...base, facts };
}
