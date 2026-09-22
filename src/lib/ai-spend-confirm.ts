// Prompt 706 Bloco D — the pre-spend "you don't have much to go on yet"
// warning, generalized from Nuno's own investability example to the four
// actions ai_actions.needs_confirmation marks true (investability_report,
// reconciliation, market_research, market_thesis_document_suggest). Pure
// decision here (what the dialog says, whether it's needed at all),
// exactly the split pipeline-drop.ts's dropDialog() already established
// for this codebase's confirm dialogs: this module decides the wording,
// confirm.tsx's existing useConfirm()/useConfirmWithFields() draws it, the
// caller wires the two buttons to "call the route" / "do nothing" — no new
// modal component.
//
// D.3's own requirement ("closing the popup, or picking 'fill in more
// information', never spends a credit — only 'continue anyway' does") falls
// out for free from that reuse: chargeAiAction only ever runs server-side,
// inside the action's own route, so nothing is spent unless the caller
// actually goes on to call that route after Confirm.
import type { ConfirmOptions } from './confirm';
import type { WalletStatus } from './ai-credits';

/** Reuses the EXACT rule ReviewPanel.tsx already applies to its own `gaps` state — never a new calculation. */
export function countCriticalGaps(gaps: { severity: string }[]): number {
  return gaps.filter((g) => g.severity === 'critical' || g.severity === 'high').length;
}

export function shouldWarnBeforeSpending(criticalGapCount: number): boolean {
  return criticalGapCount > 0;
}

export function insufficientInfoDialog(args: {
  actionLabel: string;
  criticalGapCount: number;
  wallet: WalletStatus | null;
}): ConfirmOptions {
  const { actionLabel, criticalGapCount, wallet } = args;
  const gapWord = criticalGapCount === 1 ? 'crucial question is' : 'crucial questions are';
  const usageLine = !wallet ? ''
    : wallet.isTest ? 'Your account has unlimited AI credits (internal/test org).'
      : `This uses ${wallet.actionCost} credit${wallet.actionCost === 1 ? '' : 's'} — you've used ${wallet.used} of ${wallet.monthlyLimit} this month.`;
  return {
    title: `Run ${actionLabel} with thin information?`,
    message: `${criticalGapCount} ${gapWord} still unanswered about your company — ${actionLabel} will be less precise without them.`
      + (usageLine ? `\n\n${usageLine}` : ''),
    confirmLabel: 'Continue anyway',
    cancelLabel: 'Fill in more information first',
    destructive: false,
  };
}
