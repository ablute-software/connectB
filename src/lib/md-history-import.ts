// Real interaction-history import (ablute_historico_fundos.md) — 118
// entity sections, ~495 interactions, extracted from a color-coded OneNote
// export. Deterministic parser (no AI needed for structure — only the
// person-mention proposals in a separate module use an LLM). TWO DISTINCT
// THEMES, never mixed:
//   TEMA A — contact facts (name/emails/sites/phones): eligible for the
//     normal cross-org contributions flow if the founder chooses.
//   TEMA B — personal negotiation history (interactions, outcomes, notes):
//     ablute_-org-private, forever. Never a contribution, never catalog.
import { normalizeName, normalizeDomain } from './catalog-dedupe';
import { matchEntities, mergeFields, type MatchStatus, type MatchCandidate, type FieldDiff, type ExistingEntity } from './structured-import';

export type Desfecho = 'SEM_MARCACAO' | 'TALVEZ_FUTURO' | 'NAO_FECHADO' | 'CONTACTADO_SEM_DESFECHO';
export type Estado = '—' | 'NÃO' | 'TALVEZ' | 'RESPOSTA';

export interface MdInteraction {
  estado: Estado;
  dateRaw: string;
  occurredAt?: string; // ISO date, undefined if unparseable/implausible
  text: string;
  needsReview: boolean; // true for uncolored ('—') entries — see the file's own green-loss warning
}

export interface MdSection {
  name: string;
  aliases: string[];
  desfecho: Desfecho;
  origem?: string;
  emails: string[];
  sites: string[];
  telefones: string[];
  interactions: MdInteraction[];
}

const EMAIL_RE = /\*\*Emails:\*\*\s*(.+)/;
const SITES_RE = /\*\*Sites:\*\*\s*(.+)/;
const PHONES_RE = /\*\*Telefones:\*\*\s*(.+)/;
const DESFECHO_RE = /\*\*Desfecho:\*\*\s*`([A-Z_]+)`/;
const ORIGEM_RE = /\*\*Origem:\*\*\s*(\S+)/;
const INTERACTION_RE = /^-\s*\[([^\]]*)\]\s*(.*?)\s*—\s*(.*)$/;

// Login-portal / webmail URLs incidentally captured mid-correspondence,
// not real company sites — filtering these out of TEMA A avoids polluting
// entities.website with garbage. linkedin.com added after finding live: a
// personal LinkedIn profile URL (captured because that's who Nuno talked
// to, not the fund's own site) was landing in entities.website, AND every
// such profile shares the linkedin.com domain — meaning the domain-match
// tier would confidently propose merging unrelated funds that each simply
// happen to have a LinkedIn-profile "site" on file (found via a post-
// commit scan; see DECISIONS.md — it hadn't actually bitten this specific
// import, since matching only checks pre-existing rows, not entities newly
// created within the same batch, but would on any later re-run).
const BOGUS_SITE_PATTERNS = /roundcube|webmail|cpanel|dnscpanel|owa\.|zimbra|outlook\.office|linkedin\.com/i;

function splitList(raw: string): string[] {
  return raw.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
}

function parseDate(raw: string): { occurredAt?: string } {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    // e.g. the "1019-07-24" and "2024-26-26" OCR/typo cases — sanity-bound
    // rather than trust digit shape alone; unparseable stays unparseable.
    if (year >= 2015 && year <= 2027 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { occurredAt: `${iso[1]}-${iso[2]}-${iso[3]}` };
    }
    return {};
  }
  const bareYear = raw.match(/^(\d{4})$/);
  if (bareYear) {
    const year = Number(bareYear[1]);
    if (year >= 2015 && year <= 2027) return { occurredAt: `${bareYear[1]}-07-01` }; // mid-year placeholder, flagged via needsReview by the caller
  }
  return {};
}

export function parseMdHistory(text: string): MdSection[] {
  const chunks = text.split(/\n(?=## )/).slice(1); // drop everything before the first '## '
  const sections: MdSection[] = [];

  for (const chunk of chunks) {
    if (!DESFECHO_RE.test(chunk)) continue; // the 8 intro subsections have no Desfecho — not entities
    const lines = chunk.split('\n');
    const name = lines[0].replace(/^##\s*/, '').trim();
    const desfechoMatch = chunk.match(DESFECHO_RE);
    const desfecho = (desfechoMatch?.[1] as Desfecho) ?? 'SEM_MARCACAO';
    const origem = chunk.match(ORIGEM_RE)?.[1];
    const emails = chunk.match(EMAIL_RE)?.[1] ? splitList(chunk.match(EMAIL_RE)![1]) : [];
    const sitesRaw = chunk.match(SITES_RE)?.[1] ? splitList(chunk.match(SITES_RE)![1]) : [];
    const sites = sitesRaw.filter((s) => !BOGUS_SITE_PATTERNS.test(s));
    const telefones = chunk.match(PHONES_RE)?.[1] ? splitList(chunk.match(PHONES_RE)![1]) : [];

    const interactions: MdInteraction[] = [];
    for (const line of lines) {
      const m = line.match(INTERACTION_RE);
      if (!m) continue;
      const estado = m[1].trim() as Estado;
      const dateRaw = m[2].trim();
      const rest = m[3].trim();
      const { occurredAt } = parseDate(dateRaw);
      interactions.push({
        estado, dateRaw, occurredAt, text: rest,
        needsReview: estado === '—' || !occurredAt,
      });
    }

    sections.push({ name, aliases: [], desfecho, origem, emails, sites, telefones, interactions });
  }
  return sections;
}

// The file's own "Notas de desduplicação" section, hard-coded — same
// reasoning as the CSV import's Lurdes/Murta affiliations: these are named,
// sourced facts from the file's own header, not a general NLP heuristic.
const ALIAS_GROUPS: string[][] = [
  ['3xp global', 'Grosvenor'],
  ['Busy Angels', 'Bynd'],
  ['Beresford Capital', 'Bluemint'],
  ['A2b partners', 'Blue pharma'],
  ['MSM VC', 'Mustard Seed MAZE', 'MAZE'],
  ['BrainTrust', 'Brain capital', 'Bevin CP', 'Biven CP'],
  ['Roca ventures', 'Alantra'],
];

const DESFECHO_PRIORITY: Record<Desfecho, number> = {
  NAO_FECHADO: 3, TALVEZ_FUTURO: 2, CONTACTADO_SEM_DESFECHO: 1, SEM_MARCACAO: 0,
};

function groupIndexFor(sectionName: string): number | null {
  const n = sectionName.toLowerCase();
  for (let i = 0; i < ALIAS_GROUPS.length; i++) {
    if (ALIAS_GROUPS[i].some((member) => n.includes(member.toLowerCase()))) return i;
  }
  return null;
}

// Merges sections belonging to the same real-world fund (per the file's
// own dedup notes) into one, combining interactions/contact facts and
// recording every other name as an alias. Sections outside any group pass
// through unchanged.
export function mergeAliasedSections(sections: MdSection[]): MdSection[] {
  const byGroup = new Map<number, MdSection[]>();
  const solo: MdSection[] = [];

  for (const s of sections) {
    const gi = groupIndexFor(s.name);
    if (gi === null) { solo.push(s); continue; }
    byGroup.set(gi, [...(byGroup.get(gi) ?? []), s]);
  }

  const merged: MdSection[] = [...solo];
  for (const [gi, group] of byGroup) {
    const members = ALIAS_GROUPS[gi];
    // Shortest known member name reads as the current/brand name in
    // practice across all 7 groups in this file (MAZE, Bynd, Bluemint,
    // Blue pharma, Alantra, Grosvenor, Bevin CP) — a real pattern, not a
    // coincidence, but still just a heuristic; the founder can rename in
    // the app afterward if any single case reads wrong.
    const canonical = [...members].sort((a, b) => a.length - b.length)[0];
    const aliases = [...new Set([...members.filter((m) => normalizeName(m) !== normalizeName(canonical)), ...group.map((s) => s.name).filter((n) => normalizeName(n) !== normalizeName(canonical))])];
    const sorted = [...group].sort((a, b) => DESFECHO_PRIORITY[b.desfecho] - DESFECHO_PRIORITY[a.desfecho]);
    merged.push({
      name: canonical,
      aliases,
      desfecho: sorted[0].desfecho,
      origem: sorted[0].origem,
      emails: [...new Set(group.flatMap((s) => s.emails))],
      sites: [...new Set(group.flatMap((s) => s.sites))],
      telefones: [...new Set(group.flatMap((s) => s.telefones))],
      interactions: group.flatMap((s) => s.interactions),
    });
  }
  return merged;
}

export function desfechoToStatus(d: Desfecho): 'passed' | 'dormant' | 'contacted' {
  if (d === 'NAO_FECHADO') return 'passed';
  if (d === 'TALVEZ_FUTURO') return 'dormant';
  return 'contacted'; // SEM_MARCACAO, CONTACTADO_SEM_DESFECHO
}

export function estadoToClassification(e: Estado): 'pass' | 'awaiting' | 'question' {
  if (e === 'NÃO') return 'pass';
  if (e === 'TALVEZ') return 'question';
  return 'awaiting'; // RESPOSTA, —
}

// The doctrine section names these 4 cases explicitly with sourced
// reasoning — not derived generically (see DECISIONS.md). The broader
// per-entity reopen analysis across the rest of the pipeline is IRM_SPEC
// §9e, a deliberately separate step run only after the founder approves
// this import.
// Keys are BOTH the CSV pack's full name and the .md file's own shorter
// section-header name for the same 4 entities — the doctrine text itself
// switches between them ("Indico" in the doctrine table vs "Indico Capital
// Partners" in entities.csv). An earlier version tried a containment match
// instead of listing both keys; found live that it wrongly matched
// "Pathena Family Office" (a DIFFERENT entity — Murta's angel vehicle, not
// the fund) against the 'pathena' key. Exact keys, listed twice where
// needed, has no such false-positive surface.
export const NAMED_REOPEN_TRIGGERS: Record<string, string> = {
  'bynd': 'Thesis/mandate pass ("não fazemos medtech/hardware", 2022 and 2024) — reopened by the wellness/biosphere repositioning, which removes the medtech/hardware framing the pass was about. Do not re-pitch the old framing.',
  'indico': 'Thesis/mandate pass ("medical device regulado, fora do nosso âmbito", Nov 2025) — reopened by the wellness/biosphere repositioning, same reasoning as Bynd.',
  'indico capital partners': 'Thesis/mandate pass ("medical device regulado, fora do nosso âmbito", Nov 2025) — reopened by the wellness/biosphere repositioning, same reasoning as Bynd.',
  'pathena': 'Thesis/mandate pass ("não investimos em early stage") — reopened by the wellness/biosphere repositioning; note the fund itself is separately in wind-down (see Pathena Family Office for the angel path instead).',
  'maze': 'Phase/traction pass ("risks with traction") — they explicitly invited a re-application. Reopened by new evidence: pilot metrics (Fórum Braga), the T-Prism grant, first endpoint values.',
};

export function namedReopenTrigger(entityName: string): string | undefined {
  return NAMED_REOPEN_TRIGGERS[normalizeName(entityName)];
}

// ---------- TEMA A/B plan ----------
// TEMA A (contact facts: website/email_domain) and TEMA B (status/
// reopen_trigger/interactions) are merged into the SAME entity row (they
// describe the same real-world fund), but only TEMA A fields are ever
// eligible for the normal cross-org contributions flow — see the commit
// route, which only ever queues TEMA-A-field conflicts, never TEMA B ones.
const TEMA_A_FIELDS = new Set(['website', 'email_domain']);

export interface MdEntityPlanItem {
  key: string;
  aliases: string[];
  status: MatchStatus;
  candidates: MatchCandidate[];
  chosenId?: string;
  desfecho: Desfecho;
  reopenTrigger?: string;
  patch: Record<string, unknown>;
  temaAConflicts: FieldDiff[]; // contributions-eligible
  temaBConflicts: FieldDiff[]; // ablute_-private only, never contributions
  recentCampaign: boolean;
  include: boolean;
}

export interface MdInteractionPlanItem {
  key: string;
  entityKey: string;
  status: 'new' | 'duplicate';
  estado: Estado;
  channel: string;
  direction: 'out' | 'in';
  occurredAt?: string;
  text: string;
  needsReview: boolean;
  include: boolean;
}

export interface MdImportPlan {
  entities: MdEntityPlanItem[];
  interactions: MdInteractionPlanItem[];
}

function emailDomain(email?: string): string | undefined {
  const m = email?.match(/@([^@\s]+)$/);
  return m?.[1]?.toLowerCase();
}

const CHANNEL_KEYWORDS: [RegExp, string][] = [
  [/linkedin/i, 'linkedin_dm'],
  [/reuni(a|ã)o|reuni /i, 'meeting'],
  [/ligu|telefone|tel\.|telf/i, 'call'],
  [/formul[aá]rio|website|site/i, 'web_form'],
];
function guessChannel(text: string): string {
  for (const [re, channel] of CHANNEL_KEYWORDS) if (re.test(text)) return channel;
  return 'email'; // most of this correspondence is email-based
}

const RECENT_CAMPAIGN_START = '2025-11-01';
const RECENT_CAMPAIGN_END = '2026-01-31';
const LOCK_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export function buildMdImportPlan(
  sections: MdSection[],
  existing: { entities: ExistingEntity[]; interactions: { entity_id: string; occurred_at: string; content: string }[] },
): MdImportPlan {
  const entityPlans: MdEntityPlanItem[] = sections.map((s) => {
    let { status, candidates } = matchEntities(existing.entities, { name: s.name, website: s.sites[0] });
    // A section listing MULTIPLE distinct site domains is mixed evidence —
    // e.g. "Core Capital" lists both coreangels.com (an angel-group portal
    // page) and corecapital.pt (its own domain); the domain tier alone
    // shouldn't silently decide these are the same entity as "COREangels
    // Porto". Downgrade a domain-only match (score 90, not an exact-name
    // 100) to 'conflict' so the founder confirms it explicitly, same as a
    // genuine tie.
    const distinctDomains = new Set(s.sites.map((site) => normalizeDomain(site)).filter(Boolean));
    if (status === 'matched' && candidates[0].score === 90 && distinctDomains.size > 1) status = 'conflict';
    const chosen = status === 'matched' ? candidates[0] : undefined;
    const existingRow = chosen ? existing.entities.find((e) => e.id === chosen.id) : undefined;

    const outboundDates = s.interactions
      .filter((i) => i.occurredAt && (i.estado === '—')) // '—' defaults to outbound, see direction heuristic below
      .map((i) => i.occurredAt!)
      .sort();
    const latestOutbound = outboundDates.at(-1);

    const incoming: Record<string, unknown> = {
      website: s.sites[0], email_domain: emailDomain(s.emails[0]), status: desfechoToStatus(s.desfecho),
      reopen_trigger: namedReopenTrigger(s.name),
    };
    const { patch, conflicts } = existingRow
      ? mergeFields(existingRow as unknown as Record<string, unknown>, incoming)
      : { patch: incoming, conflicts: [] as FieldDiff[] };

    const latestOutboundMs = latestOutbound ? new Date(latestOutbound).getTime() : NaN;
    if (!Number.isNaN(latestOutboundMs)) {
      const candidateLock = new Date(latestOutboundMs + LOCK_DAYS_MS).toISOString();
      const existingLock = existingRow?.contact_lock_until as string | undefined;
      if (!existingLock || candidateLock > existingLock) patch.contact_lock_until = candidateLock;
    }
    // Never blindly delete a value nobody proposed to remove.
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];

    const temaAConflicts = conflicts.filter((c) => TEMA_A_FIELDS.has(c.field));
    const temaBConflicts = conflicts.filter((c) => !TEMA_A_FIELDS.has(c.field));
    const recentCampaign = s.interactions.some((i) => i.occurredAt && i.occurredAt >= RECENT_CAMPAIGN_START && i.occurredAt <= RECENT_CAMPAIGN_END);

    return {
      key: s.name, aliases: s.aliases, status, candidates, chosenId: chosen?.id, desfecho: s.desfecho,
      reopenTrigger: namedReopenTrigger(s.name), patch, temaAConflicts, temaBConflicts, recentCampaign, include: true,
    };
  });

  const entityByKey = new Map(entityPlans.map((e) => [e.key, e]));
  const interactionPlans: MdInteractionPlanItem[] = [];
  for (const s of sections) {
    const entityPlan = entityByKey.get(s.name);
    for (let i = 0; i < s.interactions.length; i++) {
      const it = s.interactions[i];
      const direction: 'out' | 'in' = it.estado === '—' ? 'out' : 'in';
      const entityId = entityPlan?.chosenId;
      const isDuplicate = !!entityId && existing.interactions.some((ex) =>
        ex.entity_id === entityId && ex.content.trim() === it.text.trim()
        && (!it.occurredAt || (ex.occurred_at || '').slice(0, 10) === it.occurredAt));
      interactionPlans.push({
        key: `${s.name}::${i}`, entityKey: s.name, status: isDuplicate ? 'duplicate' : 'new',
        estado: it.estado, channel: guessChannel(it.text), direction, occurredAt: it.occurredAt, text: it.text,
        needsReview: it.needsReview, include: !isDuplicate,
      });
    }
  }

  return { entities: entityPlans, interactions: interactionPlans };
}
