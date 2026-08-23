// Prompt 327 Pedidos E/F — the readiness gate shared by both the Roadmap
// "AI support" button and the Round "Use of funds" AI support button.
// Reuses the EXACT signal Blueprint/Readiness & Train already uses for
// "is there enough material to work from" — blueprint_analyses.status =
// 'completed' for the org (blueprint-capability.ts's own migration-presence
// probe is a separate, unrelated check: whether the TABLE exists at all,
// not whether THIS org has a finished analysis). Never a second readiness
// signal invented for this prompt.
export function hasCompletedBlueprintAnalysis(rows: { status: string }[]): boolean {
  return rows.some((r) => r.status === 'completed');
}
