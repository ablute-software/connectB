import { describe, expect, it } from 'vitest';
// Deliberately imports the WORKER's own module, not a copy: what is tested
// here is byte-for-byte what supabase/functions/enrichment-worker deploys.
import { isHumanVerified, stripHumanVerified, withoutNulls } from '../../supabase/functions/enrichment-worker/human-guard';

// Prompt 642 §4 — the worker does not write over what a human verified, and
// never writes null over a value.
describe('stripHumanVerified', () => {
  const stamped = { background: 'verified_by_admin', hook: 'plausible_by_startups', hook_evidence: 'Publicou guias…', hook_verified_at: '2026-09-09' };

  it('drops every key a human stamped, keeps the rest', () => {
    const { kept, protectedKeys } = stripHumanVerified({ background: 'model text', intro_path: 'via X', watch_outs: 'none' }, stamped);
    expect(kept).toEqual({ intro_path: 'via X', watch_outs: 'none' });
    expect(protectedKeys).toEqual(['background']);
  });

  it('hook_source travels with hook: a protected hook protects its source too', () => {
    const { kept, protectedKeys } = stripHumanVerified({ hook: 'model hook', hook_source: 'web', intro_path: 'x' }, stamped);
    expect(kept).toEqual({ intro_path: 'x' });
    expect(protectedKeys.sort()).toEqual(['hook', 'hook_source']);
  });

  it('only a value that IS a level protects: the import\'s side keys (hook_evidence, hook_verified_at) do not', () => {
    expect(isHumanVerified(stamped, 'hook_evidence')).toBe(false);
    expect(isHumanVerified(stamped, 'hook_verified_at')).toBe(false);
    expect(isHumanVerified(stamped, 'background')).toBe(true);
    expect(isHumanVerified(stamped, 'hook')).toBe(true);
  });

  it('every human level protects — plausible, startups, admin, person', () => {
    for (const level of ['plausible_by_startups', 'verified_by_startups', 'verified_by_admin', 'verified_by_person']) {
      expect(stripHumanVerified({ thesis: 'x' }, { thesis: level }).kept).toEqual({});
    }
  });

  it('an empty or missing verified_fields protects nothing', () => {
    expect(stripHumanVerified({ thesis: 'x', sectors: ['a'] }, {}).kept).toEqual({ thesis: 'x', sectors: ['a'] });
    expect(stripHumanVerified({ thesis: 'x' }, null).kept).toEqual({ thesis: 'x' });
    expect(stripHumanVerified({ thesis: 'x' }, undefined).kept).toEqual({ thesis: 'x' });
  });

  it('an unknown level string does not protect (the model has no rung; neither does a typo)', () => {
    expect(stripHumanVerified({ thesis: 'x' }, { thesis: 'ai' }).kept).toEqual({ thesis: 'x' });
  });
});

describe('withoutNulls', () => {
  it('omits null and undefined so an upsert only touches what the model returned', () => {
    expect(withoutNulls({ hook: null, background: 'b', intro_path: undefined, kill_words: [] })).toEqual({ background: 'b', kill_words: [] });
  });
});
