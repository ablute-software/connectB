import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasCompetitorClassification,
  isCrossDocumentCollision,
  shouldEnrichExistingItem,
  upsertOrEnrichResearchItem,
  type EnrichableProposal,
} from './market-research-item-upsert';

interface Row {
  id: string; org_id: string; section: string; title: string; detail: string;
  source_kind: string; document_id: string | null; page: number | null;
  structured: Record<string, unknown> | null; status: string;
  source_url: string | null; run_signature: string | null;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'row-existing', org_id: 'org-1', section: 'players', title: 'Competitor: Withings',
    detail: 'France · growth', source_kind: 'document', document_id: 'doc-deck', page: 4,
    structured: { name: 'Withings' }, status: 'pending', source_url: null, run_signature: 'sig-old',
    ...overrides,
  };
}

const FULL_CLASSIFICATION = {
  name: 'Withings',
  candidateKind: 'company',
  candidateStage: 'launched',
  relation: { sameBuyer: { state: 'MATCH', note: null, sourceUrl: null } },
  sherlockClassification: 'DIRECT',
};

function proposal(overrides: Partial<EnrichableProposal> = {}): EnrichableProposal {
  return {
    section: 'players', title: 'Competitor: Withings', detail: 'France · growth · scales',
    documentId: 'doc-landscape', page: 2, structured: { ...FULL_CLASSIFICATION },
    ...overrides,
  };
}

// Same hand-rolled fake-SupabaseClient pattern as reconciliation.test.ts —
// an in-memory table that actually enforces unique(org_id, section, title)
// under ignoreDuplicates, which is the whole mechanism this prompt is about.
function makeFakeAdmin(initial: Row[] = [], opts: { updateError?: boolean } = {}) {
  const rows = [...initial];
  const counts = { selects: 0, updates: 0 };
  let nextId = 1;
  const admin = {
    from: (table: string) => {
      if (table !== 'market_research_items') throw new Error(`unexpected table in this fixture: ${table}`);
      return {
        upsert: (payload: Record<string, unknown>, options?: { ignoreDuplicates?: boolean }) => ({
          select: () => {
            const clash = rows.find((r) => r.org_id === payload.org_id && r.section === payload.section && r.title === payload.title);
            // ignoreDuplicates: the insert is silently dropped and the
            // RETURNING clause comes back empty. That empty array is the
            // only signal the route ever had, and the reason a colliding
            // proposal disappeared without a trace.
            if (clash && options?.ignoreDuplicates) return Promise.resolve({ data: [], error: null });
            const inserted = { id: `row-new-${nextId++}`, source_url: null, ...payload } as unknown as Row;
            rows.push(inserted);
            return Promise.resolve({ data: [{ id: inserted.id }], error: null });
          },
        }),
        select: () => {
          counts.selects++;
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(col: string, val: unknown) { filters[col] = val; return chain; },
            maybeSingle() {
              const found = rows.find((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
              return Promise.resolve({ data: found ?? null, error: null });
            },
          };
          return chain;
        },
        update: (payload: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {};
          const apply = () => {
            counts.updates++;
            if (opts.updateError) return { data: null, error: { message: 'simulated update failure' } };
            for (const r of rows) {
              if (Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)) Object.assign(r, payload);
            }
            return { data: null, error: null };
          };
          const chain = {
            eq(col: string, val: unknown) { filters[col] = val; return chain; },
            then(onFulfilled: (v: unknown) => unknown) { return Promise.resolve(apply()).then(onFulfilled); },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, rows, counts };
}

describe('hasCompetitorClassification', () => {
  it('needs all four fields, not just sherlockClassification', () => {
    expect(hasCompetitorClassification(FULL_CLASSIFICATION)).toBe(true);
    expect(hasCompetitorClassification({ ...FULL_CLASSIFICATION, relation: undefined })).toBe(false);
    expect(hasCompetitorClassification({ ...FULL_CLASSIFICATION, candidateKind: undefined })).toBe(false);
    expect(hasCompetitorClassification({ ...FULL_CLASSIFICATION, candidateStage: undefined })).toBe(false);
    expect(hasCompetitorClassification({ ...FULL_CLASSIFICATION, sherlockClassification: undefined })).toBe(false);
  });

  it('is false for the shapes production actually holds today', () => {
    // Measured 30/08: 36 `players` rows, 0 with a classification, 0 with the
    // facets. These two are what those rows look like.
    expect(hasCompetitorClassification(null)).toBe(false);
    expect(hasCompetitorClassification({ name: 'Withings', country: 'France' })).toBe(false);
    expect(hasCompetitorClassification({ company: 'Withings' })).toBe(false);
  });
});

describe('shouldEnrichExistingItem — Prompt 482 §1/§2', () => {
  it('enriches when the proposal is classified and the incumbent is not (§1)', () => {
    expect(shouldEnrichExistingItem(FULL_CLASSIFICATION, { name: 'Withings' })).toBe(true);
    expect(shouldEnrichExistingItem(FULL_CLASSIFICATION, null)).toBe(true);
  });

  it('leaves the incumbent alone when both are classified — no "newest wins" (§2)', () => {
    expect(shouldEnrichExistingItem(FULL_CLASSIFICATION, { ...FULL_CLASSIFICATION, sherlockClassification: 'ADJACENT' })).toBe(false);
  });

  it('leaves the incumbent alone when neither is classified (§2)', () => {
    expect(shouldEnrichExistingItem({ name: 'Withings' }, { name: 'Withings' })).toBe(false);
  });

  it('never downgrades a classified incumbent with an unclassified proposal (§2)', () => {
    expect(shouldEnrichExistingItem({ name: 'Withings' }, FULL_CLASSIFICATION)).toBe(false);
  });
});

describe('upsertOrEnrichResearchItem — the production case Prompt 478 could not reach', () => {
  // Criterion §5, verbatim: "dois documentos diferentes mencionando a mesma
  // empresa, um sem facetos (pré-478) e outro com (pós-478) — a segunda
  // leitura deve enriquecer a linha, não ser descartada."
  it('a classified proposal from document B enriches the unclassified row document A left behind', async () => {
    const { admin, rows } = makeFakeAdmin([row({ document_id: 'doc-deck', page: 4 })]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal());

    expect(outcome).toBe('enriched');
    expect(rows).toHaveLength(1); // never a second row — the unique key still holds
    expect(rows[0].structured).toMatchObject({ sherlockClassification: 'DIRECT', candidateKind: 'company', candidateStage: 'launched' });
  });

  it('§3 — the winning row points at the document that supplied the classification, not the first one that mentioned the name', async () => {
    const { admin, rows } = makeFakeAdmin([row({ document_id: 'doc-deck', page: 4 })]);
    await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal({ documentId: 'doc-landscape', page: 2 }));

    expect(rows[0].document_id).toBe('doc-landscape');
    expect(rows[0].page).toBe(2);
    expect(rows[0].detail).toBe('France · growth · scales');
    expect(rows[0].run_signature).toBe('sig-new');
  });

  // Guard 2, and the reason it exists. A web row carries a verdict computed
  // from its OWN structured (fact_status, change_class, implication_*,
  // insight_confidence, ...) plus confidence/source_url/hypothesis_id.
  // Swapping structured underneath all of that would leave nine columns
  // describing data the row no longer holds. Measured in production: 0 of
  // the 26 web `players` rows even use the `Competitor: ` title template
  // this path produces, so no such collision has ever actually occurred.
  it('a web incumbent is never rewritten — its verdict columns describe its own structured', async () => {
    const { admin, rows } = makeFakeAdmin([row({ source_kind: 'web', document_id: null, page: null, source_url: 'https://example.com/withings' })]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal());

    expect(outcome).toBe('unchanged');
    expect(rows[0].source_kind).toBe('web');
    expect(rows[0].source_url).toBe('https://example.com/withings');
    expect(rows[0].structured).toEqual({ name: 'Withings' });
  });

  // Guard 1 — an unclassified proposal costs exactly what it cost before
  // PROMPT 492 RETIRED THIS TEST'S ORIGINAL ASSERTION, and says so rather
  // than quietly editing the number. As written for 482 it pinned
  // `counts.selects === 0` — "one upsert, no follow-up read" — because
  // guard 1 sat above the read. 492 moved that guard below it on purpose:
  // without reading the incumbent there is no way to tell a collision with
  // a completely different document from an idempotent re-read of the same
  // one, and for segments/trends/regulatory (which never carry a
  // classification) that was every collision they can have. So the read now
  // happens, and what is pinned instead is the half that still matters and
  // was never the point of the optimisation: NOTHING IS WRITTEN.
  it('an unclassified proposal reads the incumbent but never writes anything', async () => {
    const { admin, counts, rows } = makeFakeAdmin([row()]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal({ structured: { name: 'Withings' } }));

    expect(outcome).toBe('title_collision_cross_document');
    expect(counts.selects).toBe(1);
    expect(counts.updates).toBe(0);
    expect(rows[0].structured).toEqual({ name: 'Withings' });
    expect(rows[0].run_signature).toBe('sig-old');
  });

  // The other half of the trade, and the reason the extra round-trip is
  // bounded: a free title never reads anything at all.
  it('a proposal whose title is free still makes no follow-up read', async () => {
    const { admin, counts } = makeFakeAdmin([]);
    expect(await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal({ structured: { name: 'Withings' } }))).toBe('inserted');
    expect(counts.selects).toBe(0);
  });

  it('§2 — an incumbent that already carries a classification is left exactly as it was', async () => {
    const existing = row({ structured: { ...FULL_CLASSIFICATION, sherlockClassification: 'ADJACENT' }, document_id: 'doc-deck' });
    const { admin, rows } = makeFakeAdmin([existing]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal());

    expect(outcome).toBe('unchanged');
    expect(rows[0].structured).toMatchObject({ sherlockClassification: 'ADJACENT' });
    expect(rows[0].document_id).toBe('doc-deck');
    expect(rows[0].run_signature).toBe('sig-old');
  });

  it('§2 — an unclassified proposal colliding with an unclassified row still touches nothing (492 only changes what it is CALLED)', async () => {
    const { admin, rows } = makeFakeAdmin([row()]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal({ structured: { name: 'Withings' } }));

    // 482's rule is intact: no merge, no overwrite, first-come stays. What
    // 492 changes is only that the swallowing is now reported as what it is
    // — the fixture's incumbent is doc-deck and the proposal is
    // doc-landscape, which was never a re-read of anything.
    expect(outcome).toBe('title_collision_cross_document');
    expect(rows[0].detail).toBe('France · growth');
    expect(rows[0].document_id).toBe('doc-deck');
  });

  // Prompt 483 changed what happens NEXT for an accepted row (the
  // org_competitors row it created can now have its competitor_type filled
  // in — see market-competitor-backfill.test.ts, which mocks the capability
  // probe so that path really runs). What this test pins is the half that
  // did NOT change and matters more here: the accepted ITEM row is never
  // rewritten. Under this file's fixture the probe is off, so the backfill
  // returns before touching any table and the outcome stays 'unchanged'.
  it('§4 — an accepted row is never rewritten: it already produced its org_competitors row', async () => {
    const { admin, rows } = makeFakeAdmin([row({ status: 'accepted' })]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal());

    expect(outcome).toBe('unchanged');
    expect(rows[0].structured).toEqual({ name: 'Withings' });
    expect(rows[0].status).toBe('accepted');
  });

  it('a rejected row is a decision the founder already made — left alone too', async () => {
    const { admin, rows } = makeFakeAdmin([row({ status: 'rejected' })]);
    expect(await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal())).toBe('unchanged');
    expect(rows[0].structured).toEqual({ name: 'Withings' });
  });

  it('a free title still just inserts, with the classification on it from the start', async () => {
    const { admin, rows } = makeFakeAdmin([]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal());

    expect(outcome).toBe('inserted');
    expect(rows).toHaveLength(1);
    expect(rows[0].structured).toMatchObject({ sherlockClassification: 'DIRECT' });
  });

  it('a collision in a DIFFERENT org is not a collision at all', async () => {
    const { admin, rows } = makeFakeAdmin([row({ org_id: 'org-2' })]);
    expect(await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal())).toBe('inserted');
    expect(rows).toHaveLength(2);
  });

  it('a failed update is reported as unchanged, never counted as an enrichment', async () => {
    const { admin } = makeFakeAdmin([row()], { updateError: true });
    expect(await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal())).toBe('unchanged');
  });

  it('a non-players section is still never enriched — but its collision is no longer silent', async () => {
    // trends/regulatory/segments NEVER carry the four classification fields,
    // so before 492 every collision they can have came back as a flat
    // 'unchanged', indistinguishable from re-reading the same document.
    const existing = row({ section: 'trends', title: 'Trend: home diagnostics', structured: null });
    const { admin, rows } = makeFakeAdmin([existing]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new',
      proposal({ section: 'trends', title: 'Trend: home diagnostics', structured: null }));

    expect(outcome).toBe('title_collision_cross_document');
    expect(rows[0].detail).toBe('France · growth');
  });
});

// ---------------------------------------------------------------------------
// Prompt 492 — a collision with ANOTHER document was exactly as silent as
// before 482. 482 fixed the case where the four classifications exist;
// segments/trends/regulatory never have them, so for those sections nothing
// was fixed at all — and nothing could tell the two causes apart.

describe('isCrossDocumentCollision — Prompt 492 §2', () => {
  it('the same document is not a cross-document collision — that is an idempotent re-read', () => {
    expect(isCrossDocumentCollision('doc-a', 'doc-a')).toBe(false);
  });

  it('a different document is', () => {
    expect(isCrossDocumentCollision('doc-a', 'doc-b')).toBe(true);
  });

  it('an incumbent with no document_id counts as different, never as "probably the same"', () => {
    // Measured 31/08: the rows with a null document_id are the 143
    // web-sourced ones, never the document-sourced ones (all 56 of those
    // carry a real id, pre-467 zombies included). There is no evidence such
    // a row came from the document being read now, and inventing it to keep
    // the quieter answer is the move this prompt exists to stop
    // (invariable 14 — absence of distinction is not proof of identity).
    expect(isCrossDocumentCollision(null, 'doc-b')).toBe(true);
    expect(isCrossDocumentCollision(undefined, 'doc-b')).toBe(true);
    expect(isCrossDocumentCollision('', 'doc-b')).toBe(true);
  });
});

describe('upsertOrEnrichResearchItem — Prompt 492, the collision that was indistinguishable from a re-read', () => {
  // The scenario the prompt asks for, built exactly: incumbent document_id
  // = A, proposal with an identical title and document_id = B.
  it('an unclassified proposal colliding with a row from ANOTHER document reports it', async () => {
    const { admin, rows } = makeFakeAdmin([row({ section: 'trends', title: 'Trend: home diagnostics', document_id: 'doc-A', structured: null })]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new',
      proposal({ section: 'trends', title: 'Trend: home diagnostics', documentId: 'doc-B', structured: null }));

    expect(outcome).toBe('title_collision_cross_document');
    // The correction is the REPORT, never a merge or an overwrite — those
    // would need positive proof of identity, which a shared title is not.
    expect(rows).toHaveLength(1);
    expect(rows[0].document_id).toBe('doc-A');
    expect(rows[0].detail).toBe('France · growth');
  });

  it('the SAME document re-read stays plain unchanged — nothing is lost, nothing is reported', async () => {
    const { admin, rows } = makeFakeAdmin([row({ section: 'trends', title: 'Trend: home diagnostics', document_id: 'doc-A', structured: null })]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new',
      proposal({ section: 'trends', title: 'Trend: home diagnostics', documentId: 'doc-A', structured: null }));

    expect(outcome).toBe('unchanged');
    expect(rows[0].detail).toBe('France · growth');
  });

  it('an incumbent with no document_id at all counts as another document', async () => {
    // Not a shape production holds today (measured: every document-sourced
    // row has a real document_id, and web rows are covered by the test
    // below) — pinned because the branch exists and its failure mode is the
    // quiet one.
    const { admin } = makeFakeAdmin([row({ section: 'growth', title: 'Growth: 8% 2026-2030', document_id: null, structured: null })]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new',
      proposal({ section: 'growth', title: 'Growth: 8% 2026-2030', documentId: 'doc-B', structured: null }));

    expect(outcome).toBe('title_collision_cross_document');
  });

  it('a web incumbent is another source too — its document_id is null by construction', async () => {
    const { admin } = makeFakeAdmin([row({ section: 'trends', title: 'Trend: home diagnostics', source_kind: 'web', document_id: null, structured: null })]);
    expect(await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new',
      proposal({ section: 'trends', title: 'Trend: home diagnostics', documentId: 'doc-B', structured: null })))
      .toBe('title_collision_cross_document');
  });

  it('a real enrichment still wins over the collision report — something DID change', async () => {
    // 482's path is untouched: when the proposal carries a classification the
    // incumbent lacks, the row is enriched and the outcome says so, even
    // though the two rows came from different documents.
    const { admin, rows } = makeFakeAdmin([row({ document_id: 'doc-A' })]);
    const outcome = await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new', proposal({ documentId: 'doc-B' }));

    expect(outcome).toBe('enriched');
    expect(rows[0].document_id).toBe('doc-B');
  });

  it('a title that is free is still an insert, never a collision of any kind', async () => {
    const { admin } = makeFakeAdmin([]);
    expect(await upsertOrEnrichResearchItem(admin, 'org-1', 'sig-new',
      proposal({ section: 'trends', title: 'Trend: nobody owns this', structured: null }))).toBe('inserted');
  });
});
