import { describe, expect, it } from 'vitest';
import {
  filterEligibleClaims, selectProofClaims, selectWhyNowClaims, selectTeamClaims, buildMiniPitchPlan,
  checkMiniPitchGate, computeMiniPitchInputSnapshot, projectMiniPitchForInvestor, shouldShowMiniPitchTeaser,
  mergeRegeneratedSlides, type MiniPitchClaim, type StoredMiniPitchSlide,
} from './mini-pitch';

function claim(overrides: Partial<MiniPitchClaim> & Pick<MiniPitchClaim, 'id' | 'category' | 'evidenceClass'>): MiniPitchClaim {
  return {
    statement: 'A statement.', specificity: 'high', status: 'accepted', sourceKind: 'fact', ...overrides,
  };
}

describe('selectProofClaims — always the highest evidence class available', () => {
  it('picks the class-1 (paid commitment) claim when one exists', () => {
    const claims = [
      claim({ id: 'c5', category: 'equipa', evidenceClass: 5, statement: 'award winner' }),
      claim({ id: 'c3', category: 'equipa', evidenceClass: 3 }),
      claim({ id: 'c1', category: 'tracao_gtm', evidenceClass: 1 }),
    ];
    const picked = selectProofClaims(claims);
    expect(picked.map((c) => c.id)).toContain('c1');
    expect(picked[0].id).toBe('c1');
  });

  it('falls to class 2 (external validation) with no class-1 claim', () => {
    const claims = [
      claim({ id: 'c5', category: 'equipa', evidenceClass: 5 }),
      claim({ id: 'c2', category: 'validacao_externa', evidenceClass: 2 }),
      claim({ id: 'c4', category: 'problema', evidenceClass: 4 }),
    ];
    expect(selectProofClaims(claims)[0].id).toBe('c2');
  });

  it('falls to class 3 (team) with nothing stronger', () => {
    const claims = [claim({ id: 'c5', category: 'equipa', evidenceClass: 5 }), claim({ id: 'c3', category: 'equipa', evidenceClass: 3 })];
    expect(selectProofClaims(claims)[0].id).toBe('c3');
  });

  it('last resort is class 4 (mechanism)', () => {
    const claims = [claim({ id: 'c5', category: 'equipa', evidenceClass: 5 }), claim({ id: 'c4', category: 'solucao', evidenceClass: 4 })];
    expect(selectProofClaims(claims)[0].id).toBe('c4');
  });

  it('decoration (class 5) never leads — with only decoration available, the slide has no claims', () => {
    const claims = [claim({ id: 'c5a', category: 'equipa', evidenceClass: 5 }), claim({ id: 'c5b', category: 'prova_tecnica', evidenceClass: 5 })];
    expect(selectProofClaims(claims)).toEqual([]);
  });

  it('decoration can fill a remaining seat, but never the lead', () => {
    const claims = [
      claim({ id: 'c1', category: 'tracao_gtm', evidenceClass: 1 }),
      claim({ id: 'c5', category: 'equipa', evidenceClass: 5 }),
    ];
    const picked = selectProofClaims(claims);
    expect(picked[0].id).toBe('c1');
    expect(picked.map((c) => c.id)).toContain('c5');
  });

  it('caps at 3 claims', () => {
    const claims = Array.from({ length: 5 }, (_, i) => claim({ id: `c${i}`, category: 'tracao_gtm', evidenceClass: 1 }));
    expect(selectProofClaims(claims)).toHaveLength(3);
  });

  it('never picks a claim already used elsewhere (exclude set)', () => {
    const claims = [claim({ id: 'c1', category: 'tracao_gtm', evidenceClass: 1 })];
    expect(selectProofClaims(claims, new Set(['c1']))).toEqual([]);
  });

  it('excludes mercado_timing/funding/ask categories — those belong to other slides', () => {
    const claims = [
      claim({ id: 'c1', category: 'mercado_timing', evidenceClass: 1 }),
      claim({ id: 'c2', category: 'funding', evidenceClass: 1 }),
      claim({ id: 'c3', category: 'ask', evidenceClass: 1 }),
    ];
    expect(selectProofClaims(claims)).toEqual([]);
  });
});

describe('selectWhyNowClaims — never invents a market', () => {
  it('uses mercado_timing claims when present', () => {
    const claims = [claim({ id: 'c1', category: 'mercado_timing', evidenceClass: 4 })];
    expect(selectWhyNowClaims(claims).map((c) => c.id)).toEqual(['c1']);
  });

  it('collapses to the problem/solution mechanism with no market claim', () => {
    const claims = [claim({ id: 'c1', category: 'problema', evidenceClass: 4 }), claim({ id: 'c2', category: 'equipa', evidenceClass: 3 })];
    expect(selectWhyNowClaims(claims).map((c) => c.id)).toEqual(['c1']);
  });

  it('returns empty with neither — never fabricated text to fill the slide', () => {
    expect(selectWhyNowClaims([claim({ id: 'c1', category: 'equipa', evidenceClass: 3 })])).toEqual([]);
  });
});

describe('selectTeamClaims', () => {
  it('picks only equipa claims, capped at 2', () => {
    const claims = [
      claim({ id: 'c1', category: 'equipa', evidenceClass: 3 }),
      claim({ id: 'c2', category: 'equipa', evidenceClass: 3 }),
      claim({ id: 'c3', category: 'equipa', evidenceClass: 3 }),
      claim({ id: 'c4', category: 'problema', evidenceClass: 4 }),
    ];
    expect(selectTeamClaims(claims)).toHaveLength(2);
  });
});

describe('buildMiniPitchPlan — collapses slides with no material, never a placeholder', () => {
  it('produces all 5 slide kinds when material exists for each', () => {
    const claims = [
      claim({ id: 'c1', category: 'mercado_timing', evidenceClass: 4 }),
      claim({ id: 'c2', category: 'tracao_gtm', evidenceClass: 1 }),
      claim({ id: 'c3', category: 'equipa', evidenceClass: 3 }),
    ];
    expect(buildMiniPitchPlan(claims).map((s) => s.kind)).toEqual(['hook', 'whyNow', 'proof', 'team', 'ask']);
  });

  it('drops whyNow and team when there is nothing for them — 3 slides, not 5 with gaps', () => {
    const claims = [claim({ id: 'c1', category: 'tracao_gtm', evidenceClass: 1 })];
    expect(buildMiniPitchPlan(claims).map((s) => s.kind)).toEqual(['hook', 'proof', 'ask']);
  });

  it('a claim used on whyNow is never repeated on proof', () => {
    const claims = [claim({ id: 'c1', category: 'problema', evidenceClass: 4 })];
    const slides = buildMiniPitchPlan(claims);
    const proof = slides.find((s) => s.kind === 'proof');
    expect(proof).toBeUndefined(); // the only claim went to whyNow's mechanism fallback
  });
});

describe('filterEligibleClaims — restricted-document claims never enter', () => {
  it('drops a claim backed by a due_diligence document even when it is the strongest evidence', () => {
    const claims: MiniPitchClaim[] = [
      claim({ id: 'strong', category: 'tracao_gtm', evidenceClass: 1, sourceKind: 'vault_doc', sourceRef: 'doc-restricted' }),
      claim({ id: 'weak', category: 'equipa', evidenceClass: 3 }),
    ];
    const visibility = { 'doc-restricted': 'due_diligence' };
    const eligible = filterEligibleClaims(claims, visibility);
    expect(eligible.map((c) => c.id)).toEqual(['weak']);
  });

  it('keeps a claim backed by an open-visibility document', () => {
    const claims: MiniPitchClaim[] = [claim({ id: 'ok', category: 'tracao_gtm', evidenceClass: 1, sourceKind: 'vault_doc', sourceRef: 'doc-open' })];
    expect(filterEligibleClaims(claims, { 'doc-open': 'open' }).map((c) => c.id)).toEqual(['ok']);
  });

  it('drops a claim if ANY of its linked documents is restricted, even with others open', () => {
    const claims: MiniPitchClaim[] = [
      claim({ id: 'mixed', category: 'tracao_gtm', evidenceClass: 1, documentRefs: [{ documentId: 'd1', documentName: 'a', page: null }, { documentId: 'd2', documentName: 'b', page: null }] }),
    ];
    expect(filterEligibleClaims(claims, { d1: 'open', d2: 'on_grant' })).toEqual([]);
  });

  it('never surfaces a rejected or proposed claim regardless of document visibility', () => {
    const claims: MiniPitchClaim[] = [claim({ id: 'proposed', category: 'tracao_gtm', evidenceClass: 1, status: 'proposed' })];
    expect(filterEligibleClaims(claims, {})).toEqual([]);
  });

  it('a claim with no document at all (profile/roadmap-sourced) is never restricted', () => {
    const claims: MiniPitchClaim[] = [claim({ id: 'profile', category: 'equipa', evidenceClass: 3, sourceKind: 'profile' })];
    expect(filterEligibleClaims(claims, {})).toEqual(['profile'].map(() => claims[0]));
  });
});

describe('checkMiniPitchGate', () => {
  const completeOrg = {
    oneLiner: 'We do X for Y.', sectors: ['Fintech'], stage: 'seed' as const, roundTargetEur: 500000,
    introProblem: 'The problem.', introSolution: 'The solution.',
  };
  const usableClaims: MiniPitchClaim[] = [claim({ id: 'c1', category: 'tracao_gtm', evidenceClass: 1 })];

  it('accepts a complete org with at least one usable proof claim', () => {
    expect(checkMiniPitchGate(completeOrg, usableClaims)).toEqual({ eligible: true, missing: [] });
  });

  it('rejects and lists exactly what is missing — never an opaque "not eligible"', () => {
    const result = checkMiniPitchGate({ ...completeOrg, roundTargetEur: null }, usableClaims);
    expect(result.eligible).toBe(false);
    expect(result.missing.map((m) => m.key)).toEqual(['round_target_eur']);
    expect(result.missing[0].href).toBeTruthy();
  });

  // Prompt 379 §A — every profile link used to be the identical
  // '/settings?tab=company', which lands at the top of the tab and does
  // nothing useful. Each now names its section AND the field to flash.
  it('each gate item links to its own section anchor and flashes its own field', () => {
    const result = checkMiniPitchGate(
      { oneLiner: null, sectors: [], stage: null, roundTargetEur: null, introProblem: null, introSolution: null },
      [],
    );
    const byKey = Object.fromEntries(result.missing.map((m) => [m.key, m.href]));
    expect(byKey.one_liner).toBe('/settings?flash=identity.one_liner');
    expect(byKey.sectors).toBe('/settings?flash=identity.sectors');
    // Verified by reading the cards, not assumed: stage and round target
    // are edited in RoundCard, so they point at #settings-round.
    expect(byKey.stage).toBe('/settings?flash=round.stage');
    expect(byKey.round_target_eur).toBe('/settings?flash=round.target');
    expect(byKey.intro_pitch).toBe('/settings?flash=identity.intro_pitch');
    expect(byKey.proof_claim).toBe('/readiness');
  });

  // Prompt 379 §A — a flash link must carry NO `#section` fragment. With
  // both, the browser's own late jump to the anchor undoes the flash scroll
  // and the highlighted field ends up below the fold (measured live: 747px
  // down in a 720px viewport). The flash alone lands it in view.
  it('a flash link carries no fragment — the anchor would override the flash scroll', () => {
    const result = checkMiniPitchGate(
      { oneLiner: null, sectors: [], stage: null, roundTargetEur: null, introProblem: null, introSolution: null },
      [],
    );
    for (const m of result.missing.filter((x) => x.href.includes('flash='))) {
      expect(m.href).not.toContain('#');
    }
  });

  it('no two gate items share the same href any more', () => {
    const result = checkMiniPitchGate(
      { oneLiner: null, sectors: [], stage: null, roundTargetEur: null, introProblem: null, introSolution: null },
      [],
    );
    const hrefs = result.missing.map((m) => m.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('rejects when there is no usable claim for the Proof slide, even with a complete profile', () => {
    const result = checkMiniPitchGate(completeOrg, []);
    expect(result.eligible).toBe(false);
    expect(result.missing.map((m) => m.key)).toContain('proof_claim');
  });

  it('rejects when only a decoration-class claim exists (still no usable Proof claim)', () => {
    const result = checkMiniPitchGate(completeOrg, [claim({ id: 'c5', category: 'equipa', evidenceClass: 5 })]);
    expect(result.missing.map((m) => m.key)).toContain('proof_claim');
  });
});

describe('computeMiniPitchInputSnapshot — staleness detection', () => {
  it('is identical for the same inputs', () => {
    const org = { oneLiner: 'X', sectors: ['Fintech'], stage: 'seed', roundTargetEur: 1, introProblem: 'p', introSolution: 's' };
    const claims = [claim({ id: 'c1', category: 'equipa', evidenceClass: 3 })];
    expect(computeMiniPitchInputSnapshot(org, claims)).toBe(computeMiniPitchInputSnapshot(org, claims));
  });

  it('changes when a claim used by the generator changes', () => {
    const org = { oneLiner: 'X', sectors: ['Fintech'], stage: 'seed', roundTargetEur: 1, introProblem: 'p', introSolution: 's' };
    const before = computeMiniPitchInputSnapshot(org, [claim({ id: 'c1', category: 'equipa', evidenceClass: 3 })]);
    const after = computeMiniPitchInputSnapshot(org, [claim({ id: 'c1', category: 'equipa', evidenceClass: 1 })]);
    expect(before).not.toBe(after);
  });
});

describe('projectMiniPitchForInvestor — strips internal taxonomy before it reaches an investor', () => {
  it('keeps only kind/title/body, dropping claimIds', () => {
    const projected = projectMiniPitchForInvestor([{ kind: 'proof', title: 'Proof', body: 'Text.', claimIds: ['c1', 'c2'] }]);
    expect(projected).toEqual([{ kind: 'proof', title: 'Proof', body: 'Text.' }]);
  });

  it('omits the title key entirely when absent, never an empty string', () => {
    const projected = projectMiniPitchForInvestor([{ kind: 'hook', body: 'Text.' }]);
    expect(projected[0]).not.toHaveProperty('title');
  });

  // Prompt 379 §C.4 — which slides the founder rewrote by hand is internal
  // bookkeeping; an investor must never be able to tell.
  it('never leaks founderEdited to the investor', () => {
    const projected = projectMiniPitchForInvestor([{ kind: 'proof', body: 'Text.', founderEdited: true, claimIds: ['c1'] }]);
    expect(projected[0]).not.toHaveProperty('founderEdited');
    expect(projected[0]).not.toHaveProperty('claimIds');
  });
});

describe('mergeRegeneratedSlides (379 §C.3) — a regeneration never silently eats a founder edit', () => {
  const edited: StoredMiniPitchSlide[] = [
    { kind: 'hook', body: 'My own careful wording.', founderEdited: true, claimIds: ['old'], mediaId: 'm1' },
    { kind: 'ask', body: 'Generated ask.' },
  ];
  const fresh: StoredMiniPitchSlide[] = [
    { kind: 'hook', body: 'Freshly generated hook.', claimIds: ['new'] },
    { kind: 'ask', body: 'Fresh ask.' },
  ];

  it('reports which slides had a founder edit that the fresh run would replace', () => {
    const { choices } = mergeRegeneratedSlides(edited, fresh, []);
    expect(choices).toContainEqual({ kind: 'hook', hadFounderEdit: true, kept: false });
    expect(choices).toContainEqual({ kind: 'ask', hadFounderEdit: false, kept: false });
  });

  it('keeping a slide preserves the founder text AND the image, but takes the fresh provenance', () => {
    const { slides } = mergeRegeneratedSlides(edited, fresh, ['hook']);
    const hook = slides.find((s) => s.kind === 'hook')!;
    expect(hook.body).toBe('My own careful wording.');
    expect(hook.mediaId).toBe('m1');
    expect(hook.founderEdited).toBe(true);
    // the claims behind the slide may legitimately have moved on
    expect(hook.claimIds).toEqual(['new']);
  });

  it('a slide with no founder edit is always taken fresh, even if asked to keep it', () => {
    const { slides } = mergeRegeneratedSlides(edited, fresh, ['ask']);
    expect(slides.find((s) => s.kind === 'ask')!.body).toBe('Fresh ask.');
  });

  it('with no prior slides at all, everything is simply the fresh generation', () => {
    const { slides, choices } = mergeRegeneratedSlides([], fresh, []);
    expect(slides).toEqual(fresh);
    expect(choices.every((c) => !c.hadFounderEdit)).toBe(true);
  });
});

describe('shouldShowMiniPitchTeaser — Prompt 339 §B, fail-closed by construction', () => {
  it('shows at level 0 when a mini-pitch has been activated', () => {
    expect(shouldShowMiniPitchTeaser(0, true)).toBe(true);
  });

  it('never shows at level 0 when no mini-pitch was ever activated', () => {
    expect(shouldShowMiniPitchTeaser(0, false)).toBe(false);
  });

  it('never shows when hasMiniPitch is undefined (absent field, never treated as true)', () => {
    expect(shouldShowMiniPitchTeaser(0, undefined)).toBe(false);
  });

  it('never shows at level 1+ even with an activated mini-pitch — the real slides render instead, never both', () => {
    expect(shouldShowMiniPitchTeaser(1, true)).toBe(false);
    expect(shouldShowMiniPitchTeaser(2, true)).toBe(false);
    expect(shouldShowMiniPitchTeaser(3, true)).toBe(false);
  });
});
