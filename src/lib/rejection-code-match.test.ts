import { describe, expect, it } from 'vitest';
import { rejectionStillClashes, clearedRejectionCodes, rejectionClearedRationale } from './rejection-code-match';
import type { Entity, Org, OrgAxisClassification, RejectionCode } from './types';

function code(over: Partial<RejectionCode> = {}): RejectionCode {
  return {
    id: 'rc1', entity_id: 'e1', axis_code: 'stage', required_level: 1, level_label: 'seed',
    created_at: '2026-01-01T00:00:00.000Z', ...over,
  };
}
function org(over: Partial<Org> = {}): Pick<Org, 'stage' | 'sectors' | 'country'> {
  return { stage: 'pre_seed', sectors: ['healthtech'], country: 'PT', ...over };
}
function entity(over: Partial<Entity> = {}): Pick<Entity, 'stage_min' | 'stage_max' | 'sectors' | 'invests_in_geographies'> {
  return { stage_min: undefined, stage_max: undefined, sectors: [], invests_in_geographies: [], ...over };
}

// BlueCrow-shaped case: passed because "requerem produto no mercado" —
// coded as axis 'stage', required_level pointing at a later stage than
// the org's stage at pass time.
describe('rejectionStillClashes — stage axis', () => {
  it('clashes while the org has not reached the required stage level', () => {
    const c = code({ axis_code: 'stage', required_level: 2 }); // series_a
    expect(rejectionStillClashes(c, org({ stage: 'pre_seed' }), entity(), [])).toBe(true);
  });

  it('clears once the org reaches the required stage level', () => {
    const c = code({ axis_code: 'stage', required_level: 2 }); // series_a
    expect(rejectionStillClashes(c, org({ stage: 'series_a' }), entity(), [])).toBe(false);
  });

  it('an unknown org stage never confirms cleared', () => {
    const c = code({ axis_code: 'stage', required_level: 1 });
    expect(rejectionStillClashes(c, org({ stage: undefined }), entity(), [])).toBe(true);
  });

  it("'other' has no ladder position — never confirms cleared either", () => {
    const c = code({ axis_code: 'stage', required_level: 0 });
    expect(rejectionStillClashes(c, org({ stage: 'other' }), entity(), [])).toBe(true);
  });

  it("also clashes if the investor's OWN stage_max is now below the org's stage", () => {
    // 253's investor-side trigger: the investor lowered stage_max after the
    // pass — even a startup that grew past the rejection's own level can
    // still fail the investor's CURRENT mandate.
    const c = code({ axis_code: 'stage', required_level: 0 }); // pre_seed, already met
    expect(rejectionStillClashes(c, org({ stage: 'series_a' }), entity({ stage_max: 'seed' }), [])).toBe(true);
  });
});

describe('rejectionStillClashes — sector axis', () => {
  it('clashes while the org sector is outside the investor mandate', () => {
    const c = code({ axis_code: 'sector', required_level: 1, level_label: 'digital health' });
    expect(rejectionStillClashes(c, org({ sectors: ['hardware'] }), entity({ sectors: ['digital health'] }), [])).toBe(true);
  });

  it('clears once the org sectors overlap the mandate (a pivot)', () => {
    const c = code({ axis_code: 'sector', required_level: 1, level_label: 'digital health' });
    expect(rejectionStillClashes(c, org({ sectors: ['digital health'] }), entity({ sectors: ['digital health'] }), [])).toBe(false);
  });

  it('no sector mandate recorded on the investor — never claims a clash', () => {
    const c = code({ axis_code: 'sector' });
    expect(rejectionStillClashes(c, org({ sectors: ['hardware'] }), entity({ sectors: [] }), [])).toBe(false);
  });
});

describe('rejectionStillClashes — geography axis', () => {
  it('clashes while the org HQ is outside the investor geographies', () => {
    const c = code({ axis_code: 'geography', level_label: 'EU' });
    expect(rejectionStillClashes(c, org({ country: 'US' }), entity({ invests_in_geographies: ['PT', 'ES'] }), [])).toBe(true);
  });

  it('clears once the org HQ matches (plain membership, same rule computeMatchScore uses)', () => {
    const c = code({ axis_code: 'geography' });
    expect(rejectionStillClashes(c, org({ country: 'PT' }), entity({ invests_in_geographies: ['PT', 'ES'] }), [])).toBe(false);
  });
});

describe('rejectionStillClashes — free-text axis (org_axis_classifications)', () => {
  const classification = (over: Partial<OrgAxisClassification> = {}): OrgAxisClassification => ({
    id: 'oc1', axis_code: 'market_maturity', level: 3, level_label: 'live with paying customers',
    confirmed_at: '2026-08-01T00:00:00.000Z', ...over,
  });

  it('no classification recorded yet — never confirms cleared', () => {
    const c = code({ axis_code: 'market_maturity', required_level: 3 });
    expect(rejectionStillClashes(c, org(), entity(), [])).toBe(true);
  });

  it('clashes while the confirmed level is below the required one', () => {
    const c = code({ axis_code: 'market_maturity', required_level: 3 });
    expect(rejectionStillClashes(c, org(), entity(), [classification({ level: 1 })])).toBe(true);
  });

  it('clears once the confirmed level meets the required one', () => {
    const c = code({ axis_code: 'market_maturity', required_level: 3 });
    expect(rejectionStillClashes(c, org(), entity(), [classification({ level: 3 })])).toBe(false);
  });

  it('uses the LATEST classification for the axis, not the first', () => {
    const c = code({ axis_code: 'market_maturity', required_level: 3 });
    const older = classification({ level: 3, confirmed_at: '2026-01-01T00:00:00.000Z' });
    const newer = classification({ level: 1, confirmed_at: '2026-08-01T00:00:00.000Z' });
    expect(rejectionStillClashes(c, org(), entity(), [older, newer])).toBe(true);
  });
});

describe('clearedRejectionCodes', () => {
  it('returns only codes that no longer clash', () => {
    const cleared = code({ id: 'cleared', axis_code: 'stage', required_level: 0 });
    const stillClashing = code({ id: 'clashing', axis_code: 'stage', required_level: 3 }); // 'later'
    const result = clearedRejectionCodes([cleared, stillClashing], org({ stage: 'seed' }), entity(), [], []);
    expect(result.map((c) => c.id)).toEqual(['cleared']);
  });

  it('skips a code that already has a proposal (dedup)', () => {
    const cleared = code({ id: 'cleared', axis_code: 'stage', required_level: 0 });
    const result = clearedRejectionCodes([cleared], org({ stage: 'seed' }), entity(), [], ['cleared']);
    expect(result).toEqual([]);
  });
});

describe('rejectionClearedRationale', () => {
  it('names the axis and the bar that used to block, without calling AI', () => {
    const text = rejectionClearedRationale(code({ axis_code: 'stage', level_label: 'product live in market' }));
    expect(text).toContain('stage');
    expect(text).toContain('product live in market');
  });
});

// Prompt 852 §G(c) — the geography axis had no write that re-ran the
// detector: updateOrg only triggered on stage and sectors. These pin the
// pure half of that fix — that the geography branch does react to
// org.country — so the store-side trigger has something to be right about.
describe('geography clears when the org moves into the mandate (Prompt 852 §G)', () => {
  const code = {
    id: 'rc-geo', entity_id: 'ent-1', axis_code: 'geography', required_level: 1,
    level_label: 'must be in DACH', source_interaction_id: 'i-1',
  } as RejectionCode;
  const entity = { stage_min: undefined, stage_max: undefined, sectors: [], invests_in_geographies: ['Germany', 'Austria'] };

  it('still clashes while the org is outside the mandate', () => {
    expect(rejectionStillClashes(code, { stage: 'seed', sectors: [], country: 'Portugal' }, entity, [])).toBe(true);
  });

  it('clears once org.country is inside it', () => {
    expect(rejectionStillClashes(code, { stage: 'seed', sectors: [], country: 'Germany' }, entity, [])).toBe(false);
  });

  it('never claims a clash when the investor recorded no geography mandate', () => {
    expect(rejectionStillClashes(code, { stage: 'seed', sectors: [], country: 'Portugal' },
      { ...entity, invests_in_geographies: [] }, [])).toBe(false);
  });
});

// §G(b) — the free-text half. The writer exists (StartupAxisClassifications,
// Prompt 251/253 Bloc C); what it produces is org_axis_classifications rows,
// and this is what they do once they exist.
describe('a free-text axis clears only once the startup states a level (Prompt 852 §G)', () => {
  const code = {
    id: 'rc-trl', entity_id: 'ent-1', axis_code: 'technology_readiness', required_level: 5,
    level_label: 'TRL 5', source_interaction_id: 'i-1',
  } as RejectionCode;
  const org = { stage: 'seed' as const, sectors: [], country: 'Portugal' };
  const entity = { stage_min: undefined, stage_max: undefined, sectors: [], invests_in_geographies: [] };

  it('never clears with no classification at all — no data is not cleared', () => {
    expect(rejectionStillClashes(code, org, entity, [])).toBe(true);
  });

  it('still clashes below the bar (Nuno’s own TRL 3 example)', () => {
    expect(rejectionStillClashes(code, org, entity, [
      { id: 'c1', axis_code: 'technology_readiness', level: 3, level_label: 'TRL 3', confirmed_at: '2026-09-01T00:00:00Z' } as OrgAxisClassification,
    ])).toBe(true);
  });

  it('clears once the startup states the level the investor asked for', () => {
    expect(rejectionStillClashes(code, org, entity, [
      { id: 'c1', axis_code: 'technology_readiness', level: 3, level_label: 'TRL 3', confirmed_at: '2026-09-01T00:00:00Z' } as OrgAxisClassification,
      { id: 'c2', axis_code: 'technology_readiness', level: 5, level_label: 'TRL 5', confirmed_at: '2026-09-07T00:00:00Z' } as OrgAxisClassification,
    ])).toBe(false);
  });
});
