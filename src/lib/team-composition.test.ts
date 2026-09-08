import { describe, expect, it } from 'vitest';
import {
  analyseTeamComposition, compositionSummary, requiredRoles, rolesOf, type TeamMember,
} from './team-composition';

// The roster that produced the two false sentences in Prompt 613 §B, copied
// from production (org 48a7c481…, 2026-09-08). Every test that says "this no
// longer lies" is measured against these exact three rows.
const SHERLOCK_DEAL: TeamMember[] = [
  { id: 'p1', fullName: 'Sherlock', title: 'CEO', isFounder: true },
  { id: 'p2', fullName: 'Nuno Marujo', title: 'CTO', isFounder: true },
  { id: 'p3', fullName: 'Alexandra', title: 'CCO', isFounder: true },
];

describe('requiredRoles (Prompt 613 §E.1) — the list comes from the business', () => {
  it('always asks for the three every company needs', () => {
    const keys = requiredRoles({}).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['technical', 'commercial', 'product']));
  });

  it('adds finance once there is a real round to manage, but not at pre-seed', () => {
    expect(requiredRoles({ stage: 'seed' }).map((r) => r.key)).toContain('finance');
    expect(requiredRoles({ stage: 'Series A' }).map((r) => r.key)).toContain('finance');
    // 'seed' matches inside 'pre-seed' unless the boundary is explicit.
    expect(requiredRoles({ stage: 'pre-seed' }).map((r) => r.key)).not.toContain('finance');
  });

  it('a marketplace and a medtech do not need the same functions', () => {
    const marketplace = requiredRoles({ sectors: ['Marketplace'] }).map((r) => r.key);
    const medtech = requiredRoles({ sectors: ['Digital health'] }).map((r) => r.key);
    expect(marketplace).toContain('operations');
    expect(marketplace).not.toContain('regulatory');
    expect(medtech).toContain('regulatory');
    expect(medtech).not.toContain('operations');
  });
});

describe('analyseTeamComposition (Prompt 613 §E.2/§E.3)', () => {
  it('reads the CTO from the roster — the sentence §B called false', () => {
    const coverage = analyseTeamComposition(SHERLOCK_DEAL, { stage: 'seed' });
    const technical = coverage.find((c) => c.role.key === 'technical')!;
    expect(technical.state).toBe('covered');
    expect(technical.owners.map((o) => o.name)).toEqual(['Nuno Marujo']);
    expect(technical.note).toContain('Nuno Marujo');
  });

  it('reads the CCO as commercial and the CEO as covering nothing by title alone', () => {
    const coverage = analyseTeamComposition(SHERLOCK_DEAL, { stage: 'seed' });
    expect(coverage.find((c) => c.role.key === 'commercial')!.owners.map((o) => o.name)).toEqual(['Alexandra']);
    const roles = requiredRoles({ stage: 'seed' });
    expect(rolesOf(SHERLOCK_DEAL[0], roles)).toEqual([]);
  });

  it('names the functions this team really is missing, instead of a false count', () => {
    const coverage = analyseTeamComposition(SHERLOCK_DEAL, { stage: 'seed' });
    const absent = coverage.filter((c) => c.state === 'absent').map((c) => c.role.key).sort();
    expect(absent).toEqual(['finance', 'product']);
    expect(compositionSummary(coverage)).toContain('no owner');
  });

  it('calls a function thin when one person is carrying three or more', () => {
    const soloist: TeamMember[] = [
      { id: 'p1', fullName: 'Ana Dias', title: 'CTO, Head of Product and Finance', isFounder: true },
    ];
    const coverage = analyseTeamComposition(soloist, { stage: 'seed' });
    const technical = coverage.find((c) => c.role.key === 'technical')!;
    expect(technical.state).toBe('thin');
    expect(technical.note).toContain('Ana Dias');
    expect(technical.note).toContain('other functions');
  });

  it('calls a function thin when its only owner is part-time', () => {
    const coverage = analyseTeamComposition(
      [{ id: 'p2', fullName: 'Nuno Marujo', title: 'CTO', isFounder: true, commitment: 'part_time' }],
      {},
    );
    expect(coverage.find((c) => c.role.key === 'technical')!.state).toBe('thin');
  });

  it('never reads an unanswered commitment as part-time', () => {
    const coverage = analyseTeamComposition(
      [{ id: 'p2', fullName: 'Nuno Marujo', title: 'CTO', isFounder: true, commitment: null }],
      {},
    );
    expect(coverage.find((c) => c.role.key === 'technical')!.state).toBe('covered');
  });

  it('honours a role the founder assigned by hand, over the title (§E.4)', () => {
    const coverage = analyseTeamComposition(
      [{ id: 'p1', fullName: 'Sherlock', title: 'CEO', isFounder: true, assignedRoles: ['product'] }],
      {},
    );
    expect(coverage.find((c) => c.role.key === 'product')!.state).toBe('covered');
    expect(coverage.find((c) => c.role.key === 'technical')!.state).toBe('absent');
  });

  it('an empty roster is every function absent, and says so without a count', () => {
    const coverage = analyseTeamComposition([], { stage: 'seed' });
    expect(coverage.every((c) => c.state === 'absent')).toBe(true);
    expect(compositionSummary(coverage)).not.toMatch(/\b0\b/);
  });

  it('says so plainly when nothing is missing', () => {
    const full: TeamMember[] = [
      { id: 'a', fullName: 'A', title: 'CTO', isFounder: true },
      { id: 'b', fullName: 'B', title: 'Head of Sales', isFounder: true },
      { id: 'c', fullName: 'C', title: 'Head of Product', isFounder: false },
      { id: 'd', fullName: 'D', title: 'CFO', isFounder: false },
    ];
    const coverage = analyseTeamComposition(full, { stage: 'seed' });
    expect(coverage.every((c) => c.state === 'covered')).toBe(true);
    expect(compositionSummary(coverage)).toBe('Every function this business needs has a named owner.');
  });
});
