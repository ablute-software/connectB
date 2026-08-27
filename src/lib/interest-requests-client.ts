'use client';
// Prompt 220 §A — o pedido de nível 3 estava visível num único sítio
// (InterestLevelRequestsCard, dentro de /settings) e o founder nunca lá
// passava. Este hook partilhado é a fonte única do lado do cliente para o
// mesmo endpoint (/api/founder/interest-level-requests): o badge da
// Pipeline no nav (shell.tsx), o Approve/Deny do Today (§B) e a pill do
// dossier da entidade (§C) leem todos daqui.
//
// Mesmo padrão do useUnreadMessagesCount (DealThreadView.tsx): um evento de
// janela em vez de fetch-on-mount-e-nunca-mais — decidir num sítio
// (Today, ou o card em /settings) faz todos os badges/pills montados
// re-verificar imediatamente, sem reload.
import { useEffect, useState } from 'react';

export interface InterestRequest {
  id: string;
  investorName: string;
  status: 'pending' | 'granted' | 'denied';
  requestedAt: string;
  decidedAt: string | null;
  note: string | null;
  shareDirectEmail: boolean;
  // A entidade do CRM da própria org para este investidor (via
  // catalog_deliveries) — null quando o par (org, investidor) ainda não tem
  // delivery, o mesmo caso em que a task do Today nem chegou a ser criada.
  entityId: string | null;
}

export const INTEREST_REQUEST_DECIDED_EVENT = 'sherlock-interest-request-decided';

export function useInterestRequests(): InterestRequest[] {
  const [requests, setRequests] = useState<InterestRequest[]>([]);
  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch('/api/founder/interest-level-requests').then((r) => r.json()).then((d) => {
        if (!cancelled) setRequests(d.requests ?? []);
      }).catch(() => {});
    }
    load();
    window.addEventListener(INTEREST_REQUEST_DECIDED_EVENT, load);
    return () => { cancelled = true; window.removeEventListener(INTEREST_REQUEST_DECIDED_EVENT, load); };
  }, []);
  return requests;
}

export function usePendingInterestCount(): number {
  return useInterestRequests().filter((r) => r.status === 'pending').length;
}

// Prompt 413 §2 — the copy the founder reads right where they act, shared
// between SherlockInsightBanner and TodayPanel so both tell the same story
// (real tester feedback on the 410 version: "ok, but how do I respond?
// what do I have to do?? does the investor want a contact-access, or
// access to the contact?" — "contact access" is jargon that reads both
// ways; this spells out the actual consequence instead). One copy of each
// string, never a second one that could drift.
export function interestRequestHeadline(investorName: string): string {
  return `${investorName} asked to see your contact details.`;
}

export function interestRequestConsequence(shareDirectEmail: boolean): string {
  return shareDirectEmail
    ? 'Approving shares your contact info with this investor — including your direct email.'
    : 'Approving shares your contact info with this investor.';
}

export const INTEREST_REQUEST_APPROVE_LABEL = 'Approve — share contact';
export const INTEREST_REQUEST_DENY_LABEL = 'Deny';

// O POST partilhado. Quem decide dispara o evento — é isso que faz o badge
// do nav cair e a pill da entidade desaparecer sem reload.
export async function decideInterestRequest(
  id: string, decision: 'granted' | 'denied', opts?: { note?: string; shareDirectEmail?: boolean },
): Promise<void> {
  await fetch('/api/founder/interest-level-requests', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, decision, note: opts?.note, shareDirectEmail: !!opts?.shareDirectEmail }),
  });
  window.dispatchEvent(new Event(INTEREST_REQUEST_DECIDED_EVENT));
}
