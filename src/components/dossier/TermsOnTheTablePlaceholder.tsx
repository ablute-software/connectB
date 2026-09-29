// Prompt 893 §A/§H — explicit extension point for Prompt 894 ("condições
// negociais, 'Committed by this investor' com data e o memo de fecho").
// This prompt implements NOTHING of 894's own scope: no deal-terms schema,
// no UI beyond this placeholder, no logic. §H is explicit that 894 depends
// on this prompt and is a SEPARATE, later prompt — do not expand this file
// without a new prompt authorizing it.
export function TermsOnTheTablePlaceholder() {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-xs text-gray-400">
      Terms on the table — coming soon (Prompt 894: negotiated terms, dated commitments, and the closing memo).
    </div>
  );
}
