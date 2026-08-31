// Prompt 482 — the title collision that swallowed Prompt 478's whole point.
//
// market_research_items has `unique(org_id, section, title)`. The document
// pass inserts with `ignoreDuplicates: true`, so the FIRST row ever written
// under a title owns that slot forever — including a row read out of a
// COMPLETELY DIFFERENT document, months earlier, before the classifier
// existed. Confirmed in production (Nuno, 30/08): "ablute_ investor deck"
// (read 29/08, before 478) already held "Competitor: Withings", "Competitor:
// Bisu", "Competitor: Vivoo" with structured.sherlockClassification = null.
// When Competitive_Landscape_and_Moat.docx.pdf was read AFTER 478, with the
// full facets, every one of those proposals was discarded in silence — the
// model ran, the founder paid (€0.141, then €0.091, then €0.091 again), and
// not one row changed. The panel said "Already read — nothing new".
//
// So 478 fixed the schema and the parser and still could not reach any
// competitor that already had an old row under the same name. That is not a
// rare corner: it is the state ablute_ was in, and the state of any org that
// read documents before today.
//
// The fix is enrichment, never re-insertion: a proposal that arrives with a
// classification takes over the structured data of an existing row that has
// none. A proposal that arrives WITHOUT one never touches a row that has
// one — "most recent wins" would just reopen the same bug from the other
// side, with a worse reading overwriting a better one.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { backfillCompetitorTypeFromClassification, isScoredClassification } from './market-competitor-write';

// 'inserted' — a genuinely new row. 'enriched' — an existing row that had no
// classification now carries this proposal's. 'competitor_backfilled'
// (Prompt 483) — the incumbent row was already ACCEPTED, so it is left
// alone, but the org_competitors row it created had competitor_type null and
// now carries the classification. 'unchanged' — nothing moved, and nothing
// was lost: the same document being re-read. 'title_collision_cross_document'
// (Prompt 492) — nothing moved and something may well have been lost: the
// title was already owned by a row from a DIFFERENT document (or from a row
// with no document at all), and the two were never compared.
export type ProposalUpsertOutcome =
  | 'inserted' | 'enriched' | 'competitor_backfilled' | 'unchanged'
  | 'title_collision_cross_document';

// Prompt 492 — the whole of the new decision, isolated so it can be tested
// without a database.
//
// A shared title is NOT proof that two readings are the same thing; it is
// absence of distinction, which invariable 14 says is never grounds for
// treating two things as one. The unique(org_id, section, title) constraint
// nevertheless merges them, and `ignoreDuplicates` does it without a word.
// This function does not fix that — it decides only whether the swallowing
// deserves to be reported. Same document: it does not (a re-read of the same
// source producing the same title is genuinely idempotent, nothing is lost).
// Any other case: it does.
//
// A NULL incumbent document_id counts as DIFFERENT, never as "probably the
// same" — there is no evidence such a row came from the document being read
// now, and inventing that evidence to keep the quieter answer is the exact
// move this prompt exists to stop.
//
// MEASURED 31/08, correcting what an earlier draft of this comment asserted:
// the split is perfectly clean and it is NOT the pre-467 legacy rows that
// have a null document_id. All 143 web-sourced rows have one and all 56
// document-sourced rows (the pre-467 zombies included) have a real
// document_id. So this branch is reached by web incumbents only — for which
// "another document" is loose wording but the substance is exact: a
// different source, whose content was never compared with this proposal's.
export function isCrossDocumentCollision(
  existingDocumentId: string | null | undefined,
  proposalDocumentId: string,
): boolean {
  if (!existingDocumentId) return true;
  return existingDocumentId !== proposalDocumentId;
}

export interface EnrichableProposal {
  section: string;
  title: string;
  detail: string;
  documentId: string;
  page: number | null;
  structured: Record<string, unknown> | null;
}

// The four fields that together mean "Sherlock classified this candidate".
// All four, never just sherlockClassification: the prompt's own wording is
// "ou tem um `structured` visivelmente mais pobre — sem `candidateKind`/
// `candidateStage`/`relation`", and both producers write all four together
// or none of them (market-research-structured.ts's PlayerStructured for the
// web path, market-document-extract.ts's competitors branch for this one).
// Requiring all four also means a hand-written or partial `structured` can
// never masquerade as classified and block a real classification.
export function hasCompetitorClassification(structured: Record<string, unknown> | null | undefined): boolean {
  if (!structured) return false;
  if (typeof structured.sherlockClassification !== 'string' || !structured.sherlockClassification) return false;
  if (typeof structured.candidateKind !== 'string' || !structured.candidateKind) return false;
  if (typeof structured.candidateStage !== 'string' || !structured.candidateStage) return false;
  if (!structured.relation || typeof structured.relation !== 'object') return false;
  return true;
}

// Prompt 482 §1/§2 — the whole decision, in one place, with no "newer wins"
// anywhere in it:
//   proposed classified + existing not  -> enrich   (§1, the bug being fixed)
//   both classified                     -> unchanged (§2, first-come stays)
//   neither classified                  -> unchanged (§2, first-come stays)
//   existing classified, proposed not    -> unchanged (§2, never downgrade)
export function shouldEnrichExistingItem(
  proposed: Record<string, unknown> | null | undefined,
  existing: Record<string, unknown> | null | undefined,
): boolean {
  return hasCompetitorClassification(proposed) && !hasCompetitorClassification(existing);
}

// Prompt 482 — insert if the title is free; otherwise enrich the incumbent
// if (and only if) this proposal carries a classification it lacks.
//
// THREE guards, each one measured rather than assumed:
//
// 1. `hasCompetitorClassification(p.structured)` — the proposal has nothing
//    to give, so nothing below can change anything (shouldEnrichExistingItem
//    requires it).
//
//    PROMPT 492 MOVED THIS GUARD BEHIND THE READ, deliberately reversing
//    482's own optimisation, and the old comment here ("first, before any
//    read... keeps the extra round-trip off every non-players proposal")
//    is deleted rather than left standing, because it is no longer true and
//    a stale comment is worse than the round-trip it was defending. The
//    reason for the reversal: returning 'unchanged' without ever looking at
//    the incumbent made a collision with a COMPLETELY DIFFERENT document
//    indistinguishable from an idempotent re-read of the same one — for
//    segments/trends/regulatory, which never carry a classification, that
//    was every collision they can have.
//
//    THE COST, stated rather than waved away: one extra select per COLLIDING
//    proposal. Not per proposal — a free title still returns 'inserted'
//    straight off the upsert with no read at all. So the extra round-trips
//    are bounded by exactly the set of proposals that were being swallowed
//    in silence, which is the set this prompt exists to account for. On a
//    route whose budget is dominated by the model call (485: ~40s of a 60s
//    ceiling), that is the right trade.
//
// 2. `source_kind = 'document'`. The collision this prompt fixes is
//    document-against-document, and so is every collision that can actually
//    happen: the document path templates its titles (`Competitor: ${name}`)
//    while the web path stores the model's own free-text title. Measured in
//    production on 30/08: all 10 document `players` rows use the template,
//    and 0 of the 26 web ones do. The restriction matters because a web row
//    carries a whole verdict derived FROM ITS OWN `structured` by
//    computeVerdict — fact_status, change_class, delta_type,
//    comparison_baseline, implication_code/scope/direction,
//    insight_confidence, promoted_to_insight — plus confidence, source_url,
//    source_accessed_at and hypothesis_id. Replacing `structured` underneath
//    those would leave nine columns describing data the row no longer holds:
//    a quieter and larger lie than the one being fixed, and recomputing them
//    means the hypothesis baseline and a fact-status run, which is the web
//    pipeline, not this one.
//
// 3. `status = 'pending'`, in the read and again in the update's own `.eq`
//    (the founder can accept between the two). /api/market-data/route.ts
//    serves ONLY pending items, and an accepted item has already produced
//    its org_competitors row through research/respond: rewriting the
//    evidence under it would change nothing the founder can see, would not
//    update competitor_type (§4 keeps the acceptance flow untouched), and
//    would leave the item citing one document while the competitor row it
//    created cites another. A rejected row is a decision already made.
//    Measured 30/08: 7 of the 10 document `players` rows are pending.
//
// Within those guards everything the winning row shows comes from the
// document that supplied the classification — detail, document_id, page.
// §3 asks for document_id/page "não ficar presos ao primeiro documento",
// and spells out why: "a proveniência mostrada ao founder tem de
// corresponder aos dados realmente guardados."
//
// run_signature moves too, so an unchanged selection of the same documents
// stops re-paying: the extraction cache keys on (org, source_kind='document',
// run_signature), and a run whose entire output was enrichment leaves no
// trace there at all today — which is exactly why the same pass was charged
// three times over in production for zero rows.
export async function upsertOrEnrichResearchItem(
  admin: SupabaseClient,
  orgId: string,
  runSignature: string,
  p: EnrichableProposal,
): Promise<ProposalUpsertOutcome> {
  const nowIso = new Date().toISOString();
  const { data: inserted } = await admin.from('market_research_items').upsert({
    org_id: orgId, run_signature: runSignature, section: p.section, title: p.title, detail: p.detail,
    source_kind: 'document', document_id: p.documentId, page: p.page, structured: p.structured ?? null,
    status: 'pending', updated_at: nowIso,
  }, { onConflict: 'org_id,section,title', ignoreDuplicates: true }).select('id');
  if ((inserted ?? []).length > 0) return 'inserted';

  // The insert was swallowed: some row already owns this (org, section,
  // title). Read the incumbent — this is the read the pass never did before,
  // and the reason a whole class of proposals vanished without a trace.
  const { data: existing } = await admin.from('market_research_items')
    .select('id, status, source_kind, structured, document_id')
    .eq('org_id', orgId).eq('section', p.section).eq('title', p.title)
    .maybeSingle();
  // The upsert said a row owns this title, and now the read cannot find it —
  // it was deleted in between, or the constraint matched on something these
  // filters do not. Reported as 'unchanged', NOT as a cross-document
  // collision: there is no incumbent to compare against, so claiming one
  // came from another document would be asserting exactly the thing that
  // could not be checked (invariable 7 — better empty than invented).
  if (!existing) return 'unchanged';

  // Prompt 492 — the outcome for every path below that leaves the incumbent
  // alone WITHOUT having compared the two readings' content. Computed once,
  // here, from the row that was actually read.
  const swallowed: ProposalUpsertOutcome = isCrossDocumentCollision(existing.document_id, p.documentId)
    ? 'title_collision_cross_document'
    : 'unchanged';

  // Guard 1 — the proposal itself has nothing to give. This is where
  // segments/trends/regulatory always land, and unclassified players with
  // them; before 492 it returned a flat 'unchanged' from above the read.
  if (!hasCompetitorClassification(p.structured)) return swallowed;

  if (existing.source_kind !== 'document') return 'unchanged'; // guard 2
  if (!shouldEnrichExistingItem(p.structured, existing.structured as Record<string, unknown> | null)) return 'unchanged';

  // Guard 3, and Prompt 483's one change to it: WHY the row is not pending
  // now matters. Rejected is a decision the founder made and stays
  // untouched, exactly as before. Accepted is the case 482 had no landing
  // place for — the row already produced an org_competitors row through
  // research/respond, and if that happened before the classifier existed,
  // its competitor_type is null with no path to ever be filled. That path
  // is here, and only here: the item row itself is still NOT rewritten
  // (482's reasoning holds — it is archived, served to nobody, and its
  // status must not move), so the only thing this can change is one null
  // column on one competitor.
  if (existing.status === 'accepted') return await backfillAcceptedCompetitor(admin, orgId, p);
  if (existing.status !== 'pending') return 'unchanged';

  const { error } = await admin.from('market_research_items').update({
    structured: p.structured ?? null,
    detail: p.detail,
    document_id: p.documentId,
    page: p.page,
    run_signature: runSignature,
    updated_at: nowIso,
  }).eq('id', existing.id).eq('status', 'pending');
  // A failed update is reported as 'unchanged', never as 'enriched': the
  // count this feeds is shown to the founder as a statement of fact about
  // what just happened, and an optimistic count is the same lie Prompt 463
  // removed from this screen.
  if (error) return 'unchanged';
  return 'enriched';
}

// Prompt 483 §2/§3/§5 — no model call, no cost: this is database work over
// what was already extracted. Returns 'competitor_backfilled' only when a
// row really changed.
async function backfillAcceptedCompetitor(
  admin: SupabaseClient, orgId: string, p: EnrichableProposal,
): Promise<ProposalUpsertOutcome> {
  const s = p.structured ?? {};
  // The same name rule research/respond/route.ts uses to create the
  // competitor in the first place (`structured?.name ?? structured?.company`)
  // — the document path writes `name`, the web path writes `company`.
  const name = typeof s.name === 'string' && s.name.trim()
    ? s.name.trim()
    : (typeof s.company === 'string' && s.company.trim() ? s.company.trim() : null);
  if (!name) return 'unchanged';
  if (!isScoredClassification(s.sherlockClassification)) return 'unchanged';
  const filled = await backfillCompetitorTypeFromClassification(admin, orgId, name, s.sherlockClassification);
  return filled ? 'competitor_backfilled' : 'unchanged';
}
