// Prompt 216 §B — a relação vista pelo INVESTIDOR: primeiro contacto →
// interesse expresso → documentos recebidos → mensagens → estado atual.
//
// Fronteira de privacidade (§A, requisito de aceitação): tudo aqui deriva
// EXCLUSIVAMENTE do que o investidor já pode ver hoje — o interaction log
// dele (investor_interaction_log), as mensagens Sherlock da thread dele, os
// documentos a que TEM acesso (já resolvidos com gate pelo servidor) e a
// decisão dele próprio. Nada do CRM do founder (interactions,
// relationshipSummary, pipeline) entra neste ficheiro — nem por parâmetro:
// os tipos de input só admitem as formas investor-visíveis.
//
// A ancoragem de documentos aos passos reutiliza anchorDocsToBoundaries
// (journey.ts) — a mesma função pura do docsByStage do founder, com outra
// fonte de eventos, nunca duplicada.
import { anchorDocsToBoundaries, type StageDoc } from './journey';

export interface InvestorLogEntryLike {
  id: string;
  kind: string; // 'manual' | 'interested' | 'passed' | 'archived' | 'reopened' | 'matchdeal_link'
  at: string;
  document?: { id: string; name: string } | null;
}

export interface InvestorJourneyInput {
  entries: InvestorLogEntryLike[];
  messages: { createdAt: string }[];
  // Documentos que a firma pode abrir HOJE — a lista já vem resolvida pelo
  // caminho com gate (resolveDocumentAccess no servidor); aqui só se anota.
  accessibleDocs: { id: string; name: string }[];
  status: 'open' | 'passed' | 'interested';
  decidedAt?: string | null;
}

export type InvestorStepKey = 'first_contact' | 'interest' | 'documents' | 'messages' | 'current';

export interface InvestorJourneyDoc {
  documentId: string;
  name: string;
  at: string;
  // A entrada do timeline onde este documento apareceu — a âncora do clique.
  entryId: string;
  // false quando o documento apareceu no log mas já não há grant que o cubra
  // — o popover mostra nome+data mas não oferece "open".
  accessible: boolean;
}

export interface InvestorJourneyStep {
  key: InvestorStepKey;
  label: string;
  state: 'done' | 'future';
  at?: string;
  count?: number;
  docs?: InvestorJourneyDoc[];
}

const CURRENT_LABEL: Record<InvestorJourneyInput['status'], string> = {
  open: 'In review', interested: 'Interested', passed: 'Passed',
};

export function investorJourneySteps(input: InvestorJourneyInput): InvestorJourneyStep[] {
  const entryTimes = input.entries.map((e) => e.at);
  const messageTimes = input.messages.map((m) => m.createdAt);
  const allTimes = [...entryTimes, ...messageTimes].sort();

  const firstContactAt = allTimes[0];

  // Interesse: a entrada automática 'interested' do log é a fonte primária;
  // cair em decidedAt cobre decisões antigas de antes do log automático
  // existir — mas só quando a decisão foi mesmo "interested".
  const interestedEntry = input.entries
    .filter((e) => e.kind === 'interested')
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  const interestAt = interestedEntry?.at
    ?? (input.status === 'interested' ? input.decidedAt ?? undefined : undefined);

  const docEvents: StageDoc[] = input.entries
    .filter((e) => e.document)
    .map((e) => ({ documentId: (e.document as { id: string }).id, at: e.at, interactionId: e.id }));
  const firstDocAt = docEvents.map((d) => d.at).sort()[0];

  const firstMessageAt = messageTimes.sort()[0];

  // O passo "documents" está done se há acesso HOJE ou se algum documento
  // apareceu no log — receber e perder o grant não apaga o facto de ter
  // recebido.
  const docsDone = input.accessibleDocs.length > 0 || docEvents.length > 0;

  const steps: InvestorJourneyStep[] = [
    { key: 'first_contact', label: 'First contact', state: firstContactAt ? 'done' : 'future', at: firstContactAt },
    { key: 'interest', label: 'Interest expressed', state: interestAt ? 'done' : 'future', at: interestAt },
    { key: 'documents', label: 'Documents received', state: docsDone ? 'done' : 'future', at: firstDocAt, count: input.accessibleDocs.length || undefined },
    { key: 'messages', label: 'Messages', state: messageTimes.length > 0 ? 'done' : 'future', at: firstMessageAt, count: input.messages.length || undefined },
    {
      key: 'current', label: CURRENT_LABEL[input.status], state: 'done',
      at: input.decidedAt ?? allTimes.at(-1),
    },
  ];

  // Ancoragem 📄: as fronteiras são os passos com data; um documento cai no
  // passo em vigor à data em que apareceu — a MESMA função do founder
  // (docsByStage), com os passos do investidor como fonte de fronteiras.
  const boundaries = steps
    .filter((s): s is InvestorJourneyStep & { at: string } => !!s.at && s.key !== 'current')
    .map((s) => ({ at: s.at, key: s.key }));
  const anchored = anchorDocsToBoundaries(boundaries, 'first_contact' as InvestorStepKey, docEvents);

  const accessibleById = new Map(input.accessibleDocs.map((d) => [d.id, d.name]));
  const nameByDocId = new Map(
    input.entries.filter((e) => e.document).map((e) => [(e.document as { id: string }).id, (e.document as { name: string }).name]));

  for (const step of steps) {
    const docs = anchored.get(step.key);
    if (!docs || docs.length === 0) continue;
    step.docs = docs.map((d) => ({
      documentId: d.documentId,
      name: nameByDocId.get(d.documentId) ?? accessibleById.get(d.documentId) ?? 'Document',
      at: d.at,
      entryId: d.interactionId,
      accessible: accessibleById.has(d.documentId),
    }));
  }

  return steps;
}
