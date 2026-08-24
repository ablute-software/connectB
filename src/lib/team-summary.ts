// Prompt 357 §A — a team_summary that's trivially just "Name — Title" for
// one of the team members already listed below it is pure duplication, not
// a real summary: confirmed live, overview.team_summary held literally
// "Nuno Marujo — CEO" while the member list right below it showed the same
// person the same way. Splitting on common separators handles a summary
// that's really just several redundant "Name — Title" lines concatenated;
// a GENUINE summary sentence never matches any member line and is always
// shown.
export interface TeamSummaryMember { fullName: string; title: string | null }

function normalize(s: string): string {
  return s.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

export function isTeamSummaryRedundant(summary: string, team: TeamSummaryMember[]): boolean {
  const segments = summary.split(/[;\n]/).map((s) => normalize(s)).filter(Boolean);
  if (segments.length === 0) return false;

  const memberLines = new Set<string>();
  for (const m of team) {
    memberLines.add(normalize(m.fullName));
    if (m.title) {
      memberLines.add(normalize(`${m.fullName} - ${m.title}`));
      memberLines.add(normalize(`${m.fullName}, ${m.title}`));
    }
  }
  return segments.every((seg) => memberLines.has(seg));
}
