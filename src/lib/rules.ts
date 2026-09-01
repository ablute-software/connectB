// Business rules: pre-flight, message linter, caps, follow-up discipline.
// Pure functions — used by the demo store, the Supabase adapter and the automation engine alike.
import type { ActionType, Channel, Db, Entity, Interaction, Person, TaskItem } from './types';

export const LOCK_DAYS = 14;
export const LINKEDIN_DM_MAX = 900;
// LinkedIn's own connection-request note cap — distinct from LINKEDIN_DM_MAX
// (a DM to someone already connected has no such limit).
export const LINKEDIN_NOTE_MAX = 300;

// ---------- caps ----------
export function outboundCounts(db: Db, now = new Date()) {
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const day = new Date(now).getDay(); // 0 = Sunday
  const monday = new Date(now); monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((day + 6) % 7));
  const outs = db.interactions.filter((i) => i.direction === 'out');
  return {
    today: outs.filter((i) => new Date(i.occurred_at) >= startOfDay).length,
    week: outs.filter((i) => new Date(i.occurred_at) >= monday).length,
    dailyCap: db.org.daily_cap,
    weeklyCap: db.org.weekly_cap,
  };
}

// ---------- pre-flight ----------
export interface PreflightCheck {
  key: string;
  label: string;
  ok: boolean;
  reason?: string;
  overridable: boolean;
}

export function preflight(db: Db, person: Person, channel: Channel | null, now = new Date()): PreflightCheck[] {
  const entity = db.entities.find((e) => e.id === person.entity_id);
  const checks: PreflightCheck[] = [];

  // 1. do_not_contact — hard stop, no override
  checks.push({
    key: 'dnc', label: 'Not marked do-not-contact', ok: !person.do_not_contact,
    reason: person.do_not_contact ? 'Hard stop, permanent. No override.' : undefined, overridable: false,
  });

  // 2. hook researched
  checks.push({
    key: 'hook', label: 'Hook researched', ok: person.hook_status === 'researched',
    reason: person.hook_status !== 'researched' ? 'A generic message burns the contact permanently. Research first.' : undefined,
    overridable: true,
  });

  // 3. hard filter
  const hf = entity?.hard_filter_status === 'open';
  checks.push({
    key: 'hard_filter', label: 'No open hard filter on the entity', ok: !hf,
    reason: hf ? `Open filter: ${entity?.hard_filter}` : undefined, overridable: true,
  });

  // 4. contact lock (one approach per entity)
  const locked = entity?.contact_lock_until && new Date(entity.contact_lock_until) > now;
  checks.push({
    key: 'contact_lock', label: 'No one at this entity contacted in the last 14 days', ok: !locked,
    reason: locked ? `Contact lock until ${entity!.contact_lock_until!.slice(0, 10)} — partners sit in the same room.` : undefined,
    overridable: true,
  });

  // 5. seniority order — never approach a junior contact while a more
  // senior one at the same fund is still unresolved. "Unresolved" covers
  // both not-yet-contacted (approach them first) and contacted-with-no-
  // reply (don't spray in parallel); only an actual reply (any
  // classification, including a pass) resolves a senior and clears the
  // way for the junior.
  let seniorityOk = true; let seniorityReason: string | undefined;
  if (person.seniority_rank > 1 && entity) {
    const seniors = db.people.filter((p) => p.entity_id === entity.id && p.seniority_rank < person.seniority_rank && !p.do_not_contact);
    const unresolved = seniors.filter((s) => !db.interactions.some((i) => i.person_id === s.id && i.direction === 'in'));
    if (unresolved.length > 0) {
      seniorityOk = false;
      const anyContacted = unresolved.some((s) => db.interactions.some((i) => i.person_id === s.id && i.direction === 'out'));
      seniorityReason = anyContacted
        ? 'A more senior contact at this fund has not replied yet — parallel approaches read as spraying.'
        : `${unresolved[0].full_name} (rank ${unresolved[0].seniority_rank}) hasn't been approached yet — respect seniority order.`;
    }
  }
  checks.push({ key: 'seniority', label: 'Seniority order respected', ok: seniorityOk, reason: seniorityReason, overridable: true });

  // 6. email channel needs a verified, non-bounced address
  if (channel === 'email') {
    const emailOk = !!person.email_verified && person.bounce_count === 0;
    checks.push({
      key: 'email', label: 'Verified email, no bounces', ok: emailOk,
      reason: !person.email_verified
        ? 'A guess is a hypothesis, not an address. Use LinkedIn, or verify first.'
        : person.bounce_count > 0 ? `Address bounced ×${person.bounce_count} — retrying damages the sending domain.` : undefined,
      overridable: false, // never send to unverified — no override by design
    });
  }

  // 7. caps
  const caps = outboundCounts(db, now);
  const capsOk = caps.today < caps.dailyCap && caps.week < caps.weeklyCap;
  checks.push({
    key: 'caps', label: `Within volume caps (${caps.today}/${caps.dailyCap} today · ${caps.week}/${caps.weeklyCap} week)`,
    ok: capsOk,
    reason: !capsOk ? 'Volume signals desperation — a €1.3M seed closes on 15–40 conversations.' : undefined,
    overridable: true,
  });

  // 8. follow-up limit: never a third unanswered message to the same person
  const outsToPerson = db.interactions.filter((i) => i.person_id === person.id && i.direction === 'out').length;
  const insFromPerson = db.interactions.filter((i) => i.person_id === person.id && i.direction === 'in').length;
  const thirdMsg = outsToPerson >= 2 && insFromPerson === 0;
  checks.push({
    key: 'follow_up_limit', label: 'Not a third unanswered message', ok: !thirdMsg,
    reason: thirdMsg ? 'Three unanswered messages is harassment, not persistence. Mark dormant instead.' : undefined,
    overridable: false,
  });

  // 9. official channel first
  if (entity?.submission_channel && entity.submission_channel_type !== 'none') {
    const usedOfficial = db.interactions.some((i) =>
      i.entity_id === entity.id && i.direction === 'out' && (i.channel === 'web_form' || i.channel === 'email'));
    const isOfficialAttempt = channel === 'web_form' || channel === 'email';
    checks.push({
      key: 'official_first', label: 'Official submission channel used first',
      ok: usedOfficial || isOfficialAttempt || channel === null,
      reason: !usedOfficial && !isOfficialAttempt && channel !== null
        ? `This fund publishes a submission route (${entity.submission_channel}). Using it signals you read their process — submit first, then reference it.`
        : undefined,
      overridable: true,
    });
  }

  return checks;
}

export function preflightSummary(checks: PreflightCheck[]) {
  const failed = checks.filter((c) => !c.ok);
  return {
    green: failed.length === 0,
    blocked: failed.some((c) => !c.overridable),
    failed,
  };
}

// ---------- linter ----------
export interface LintFinding {
  severity: 'error' | 'warning' | 'info';
  message: string;
}


// Prompt 525 — quote fidelity. Watson shortened Dr. Golnaz Borghei's real,
// correctly-sourced screening question and kept the quotation marks around
// the result: the hook says «Is there a clear path to market? Is there an
// exit strategy that makes sense within our time horizon?» and the draft said
// «clear path to market? exit strategy within our time horizon?». The source
// was right; the attribution was not. If she had read it she would have
// recognised that the quoted words were not hers — the exact opposite of what
// the line was trying to prove.
//
// Two layers, the same shape kill words already use: an instruction in the
// compose prompt, and this — a deterministic check that does not depend on
// the model behaving. The model already had a general ground-truth
// instruction and cut the quote anyway, so this is the one that counts.

/** Below this, a quoted span is a term-in-scare-quotes, not attributed speech. */
export const QUOTE_MIN_WORDS = 5;

// Typography is normalised, wording is NOT. A source written with a curly
// apostrophe and a draft with a straight one are the same words and must not
// be flagged; "that makes sense" going missing is a different matter.
// Deliberately no lowercasing beyond nothing — case is part of the wording.
function canonicalQuoteText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The quoted spans in a draft that are long enough to read as attributed
 * speech. Straight and curly DOUBLE quotes only — single quotes and
 * apostrophes are excluded on purpose, because contractions and possessives
 * ("the founder's deck", "don't") would produce constant false positives.
 */
export function extractQuotedSpans(draft: string): string[] {
  const spans: string[] = [];
  for (const re of [/"([^"]+)"/g, /\u201C([^\u201D]+)\u201D/g]) {
    for (const m of draft.matchAll(re)) {
      const inner = m[1].trim();
      if (inner.split(/\s+/).filter(Boolean).length >= QUOTE_MIN_WORDS) spans.push(inner);
    }
  }
  return spans;
}

/** Quoted spans that do NOT appear verbatim in any source given. */
export function unsourcedQuotes(draft: string, sources: (string | null | undefined)[]): string[] {
  const haystacks = sources.filter((s): s is string => !!s && s.trim().length > 0).map(canonicalQuoteText);
  return extractQuotedSpans(draft).filter((q) => {
    const needle = canonicalQuoteText(q);
    return !haystacks.some((h) => h.includes(needle));
  });
}

export function lintMessage(
  draft: string, person: Person, entity: Entity | undefined, channel: Channel,
  // Prompt 525 — extra verbatim sources beyond the person's own fields. The
  // compose route passes the prior thread's snippets, which are already
  // treated as third-party data there (Prompt 305 §B); callers that have none
  // simply omit it and the person's own fields are the only sources.
  sources?: { threadSnippets?: string[] },
): LintFinding[] {
  const findings: LintFinding[] = [];
  const lower = draft.toLowerCase();

  for (const kw of person.kill_words) {
    if (lower.includes(kw.toLowerCase())) {
      findings.push({ severity: 'error', message: `Contains a kill word for this person: “${kw}”.` });
    }
  }

  if (channel === 'linkedin_dm' && draft.length > LINKEDIN_DM_MAX) {
    findings.push({ severity: 'warning', message: `${draft.length}/${LINKEDIN_DM_MAX} characters — LinkedIn DMs over ${LINKEDIN_DM_MAX} get skimmed and dropped.` });
  }

  if (channel === 'linkedin_note' && draft.length > LINKEDIN_NOTE_MAX) {
    findings.push({ severity: 'error', message: `${draft.length}/${LINKEDIN_NOTE_MAX} characters — LinkedIn connection-request notes are hard-capped at ${LINKEDIN_NOTE_MAX}.` });
  }

  if (/\/edit/.test(draft)) {
    findings.push({ severity: 'error', message: 'Contains an editable link (/edit) — only view-only links leave the building.' });
  }

  // Line-1-hook heuristic: first line should mention something specific to this person
  const firstLine = draft.split('\n').find((l) => l.trim().length > 0) ?? '';
  const specificTerms = [
    ...(person.hook ? person.hook.split(/\W+/).filter((w) => w.length > 5) : []),
    ...person.full_name.split(' '),
    ...(entity ? entity.name.split(' ') : []),
  ].map((t) => t.toLowerCase());
  const hasSpecific = specificTerms.some((t) => t.length > 3 && firstLine.toLowerCase().includes(t));
  if (draft.trim().length > 0 && !hasSpecific) {
    findings.push({ severity: 'warning', message: 'Line 1 doesn’t mention anything specific to this person — line 1 is the hook: specific, recent, true.' });
  }

  // Prompt 525 — same severity as a kill word, because the risk is the same
  // kind: it burns the contact. Someone who reads words attributed to them
  // that they did not write stops reading.
  for (const q of unsourcedQuotes(draft, [
    person.hook, person.background, person.watch_outs, ...(sources?.threadSnippets ?? []),
  ])) {
    findings.push({
      severity: 'error',
      message: `Quoted text doesn’t match any sourced field verbatim — this misattributes altered wording to ${person.full_name}: “${q}”.`,
    });
  }

  if (entity?.the_ask) {
    findings.push({ severity: 'info', message: `One ask, keep it small. This entity’s ask: “${entity.the_ask}”` });
  }

  return findings;
}

// ---------- pass-reason pattern alert ----------
export function passReasonAlert(db: Db): { category: string; count: number } | null {
  const byCat = new Map<string, Set<string>>();
  for (const i of db.interactions) {
    if (i.classification === 'pass' && i.pass_reason_category) {
      const set = byCat.get(i.pass_reason_category) ?? new Set<string>();
      set.add(i.entity_id);
      byCat.set(i.pass_reason_category, set);
    }
  }
  for (const [category, entities] of byCat) {
    if (entities.size >= 3) return { category, count: entities.size };
  }
  return null;
}

// ---------- follow-up discipline helpers ----------
export function outboundsAwaitingFollowUp(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - LOCK_DAYS * 24 * 3600 * 1000);
  const result: { interaction: Interaction; person?: Person; entity?: Entity; isSecondSilence: boolean }[] = [];
  const byEntity = new Map<string, Interaction[]>();
  for (const i of db.interactions) {
    const list = byEntity.get(i.entity_id) ?? [];
    list.push(i);
    byEntity.set(i.entity_id, list);
  }
  for (const [entityId, list] of byEntity) {
    const sorted = [...list].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const lastIn = [...sorted].reverse().find((i) => i.direction === 'in');
    const outs = sorted.filter((i) => i.direction === 'out');
    const lastOut = outs[outs.length - 1];
    if (!lastOut) continue;
    const noReplySince = !lastIn || lastIn.occurred_at < lastOut.occurred_at;
    if (noReplySince && new Date(lastOut.occurred_at) < cutoff) {
      const unansweredOuts = outs.filter((o) => !lastIn || o.occurred_at > lastIn.occurred_at).length;
      result.push({
        interaction: lastOut,
        person: db.people.find((p) => p.id === lastOut.person_id),
        entity: db.entities.find((e) => e.id === entityId),
        isSecondSilence: unansweredOuts >= 2, // follow-up already sent → propose dormant, never a third message
      });
    }
  }
  return result;
}

export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

// The one follow-up-commitment shape every outbound logInteraction creates
// (store-demo.tsx and store-supabase.tsx each had their own copy of this
// object literal, byte-identical) — extracted so it's tested once instead
// of twice, and so batch 2's "Confirmo que enviei" button (which is just
// another caller of the same existing logInteraction path) doesn't need any
// new scheduling logic of its own.
export function buildFollowUpTask(
  entityId: string, personId: string | undefined, entityName: string, personName: string | undefined, occurredAt: string,
): Omit<TaskItem, 'id' | 'done'> {
  const due_at = new Date(new Date(occurredAt).getTime() + LOCK_DAYS * 24 * 3600 * 1000).toISOString();
  const action_type: ActionType = 'follow_up_no_reply';
  return {
    kind: 'follow_up', action_type, due_at,
    title: `Follow up ${personName ?? ''} (${entityName})`.trim(),
    entity_id: entityId, person_id: personId,
  };
}
