// The Pipeline's note for a company that told us it is NOT raising.
//
// Nuno, 20/10/2026: "if an action is missing, if there is a reason, it should be on the screen — e.g. 'X is marked as Not raising and therefore does not appear to
// investors, and no proposals are shown', then the option 'change the status to Active'". The note is worth having; that particular sentence is not true, so it is
// not what this says. What the code does with `round_raising === false`:
//   - an investor who has the startup in their pipeline sees "This round has closed." on its card (investor-pipeline.ts, case (d)) — the card stays, openable;
//   - the old workspace view of the startup leaves out its round card (portal/page.tsx);
//   - the round fields stop counting towards the company profile's completeness (companyCompleteness.ts);
//   - NOTHING in the catalog match, the unlock gate, the quota or the delivery reads it — the founder's own pipeline is not affected.
// So the note says the first and the last, and offers the one-click way back. An UNANSWERED status (null) is not "not raising": no note.
export interface NotRaisingAdvisory {
  title: string;
  body: string;
  actionLabel: string;
  /** What the confirm step tells the founder before the status changes (it is visible to investors, so it is not a silent toggle). */
  confirmBody: string;
}

export function notRaisingAdvisory(args: { roundRaising: boolean | null | undefined; companyName?: string | null }): NotRaisingAdvisory | null {
  if (args.roundRaising !== false) return null;
  const name = args.companyName?.trim() || 'Your company';
  return {
    title: `${name} is marked “Not currently raising”.`,
    body: 'Investors who have you in their pipeline see “This round has closed” on your card. This setting does not change the investors on this page.',
    actionLabel: 'Mark as raising',
    confirmBody: 'This tells investors your round is open again, and your round details count towards your profile completeness again. You can change it back in Company › Round.',
  };
}
