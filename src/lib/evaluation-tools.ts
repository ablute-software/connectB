// Prompt 548 Part 3 — the Evaluation tools sub-tabs, lifted out of
// EvaluationToolsPanel.tsx so two very different callers can share them.
//
// The panel is a client component wired to the store; the guest preview must
// never import it (importing it would pull the store into a page anyone with
// a link can open, and the no-fetch/no-store rule for previews would become
// a lie the grep cannot see). Retyping the labels in the preview was the
// other option and is exactly the mistake Prompt 548 exists to undo — the
// old guest sidebar advertised "Access granted" two prompts after that entry
// was renamed. So: one list, in a JSX-free module both sides import.
//
// Prompt 427 §B — order only; keys/labels/subtitles unchanged.
export const EVALUATION_TOOLS: { key: 'calculator' | 'simulator' | 'scorecard' | 'berkus' | 'return' | 'compare'; label: string; subtitle: string }[] = [
  { key: 'scorecard', label: 'Scorecard criteria', subtitle: 'Your private scoring criteria' },
  { key: 'berkus', label: 'Berkus Method', subtitle: 'Pre-revenue valuation estimate' },
  { key: 'calculator', label: 'Ownership calculator', subtitle: 'Real round data from your Pipeline' },
  { key: 'simulator', label: 'Equity simulator', subtitle: 'Your own hypothetical numbers' },
  // Prompt 169 §C — MOIC over the same real ownership math as the
  // calculator above. Prompt 408 §A.3 — evolved from a single assumed
  // exit into up to 5 weighted scenarios (Failure→Outlier) plus the VC
  // Method's required-exit inversion.
  { key: 'return', label: 'Scenarios & returns', subtitle: 'Failure→outlier scenarios, weighted MOIC & IRR' },
  // Prompt 345 Block E — moved here from the Pipeline (checkbox-per-row +
  // banner removed there); this tool IS the comparator now, not a shortcut
  // back to another tab.
  { key: 'compare', label: 'Compare startups', subtitle: 'Side-by-side, up to 3 from your Pipeline' },
];
