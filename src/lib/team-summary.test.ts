import { describe, it, expect } from 'vitest';
import { isTeamSummaryRedundant } from './team-summary';

const TEAM = [{ fullName: 'Nuno Marujo', title: 'CEO' }, { fullName: 'Jane Doe', title: 'CTO' }];

describe('isTeamSummaryRedundant', () => {
  it('is redundant when the summary is literally "Name — Title" for one listed member', () => {
    expect(isTeamSummaryRedundant('Nuno Marujo — CEO', TEAM)).toBe(true);
  });

  it('is redundant regardless of dash style or comma vs dash separator', () => {
    expect(isTeamSummaryRedundant('Nuno Marujo - CEO', TEAM)).toBe(true);
    expect(isTeamSummaryRedundant('Nuno Marujo, CEO', TEAM)).toBe(true);
  });

  it('is redundant when it is just the bare name with no title', () => {
    expect(isTeamSummaryRedundant('Nuno Marujo', TEAM)).toBe(true);
  });

  it('is redundant for several concatenated "Name — Title" lines, all matching members', () => {
    expect(isTeamSummaryRedundant('Nuno Marujo — CEO; Jane Doe — CTO', TEAM)).toBe(true);
  });

  it('a real summary sentence is never treated as redundant', () => {
    expect(isTeamSummaryRedundant('A technical and commercial team with 10 years of healthtech experience.', TEAM)).toBe(false);
  });

  it('a mix of a real sentence and a name line is NOT redundant — the whole thing stays visible', () => {
    expect(isTeamSummaryRedundant('Nuno Marujo — CEO; brings a decade of clinical operations experience.', TEAM)).toBe(false);
  });

  it('an empty summary is never redundant (nothing to compare)', () => {
    expect(isTeamSummaryRedundant('', TEAM)).toBe(false);
  });
});
