'use client';
// Prompt 216 §B — a faixa "ponto da situação" no topo do separador de
// atividade do dossier: a relação vista pelo INVESTIDOR, nunca o CRM do
// founder (§A — a fonte é investorJourneySteps, cujos tipos de input só
// admitem dados investor-visíveis).
//
// O badge 📄 segue o padrão do stepper do founder (209/215): hover dá
// nome+data via title, o clique abre o DocBadgePopover — flutuante por
// createPortal, nunca inline (regra do CLAUDE.md sobre overlays).
import { Fragment, useState } from 'react';
import { DocBadgePopover, type BadgeDoc } from '@/components/DocBadgePopover';
import type { InvestorJourneyStep } from '@/lib/investor-journey';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function InvestorJourneyStrip({ steps, onOpenDoc, onSeeInHistory }: {
  steps: InvestorJourneyStep[];
  onOpenDoc: (documentId: string) => void;
  onSeeInHistory: (entryId: string) => void;
}) {
  const [popover, setPopover] = useState<{ anchor: DOMRect; stepKey: string } | null>(null);

  const popoverStep = popover ? steps.find((s) => s.key === popover.stepKey) : undefined;
  // key = entryId (a âncora do timeline); o open resolve de volta ao
  // documento. Um doc sem grant hoje fica sem "open" mas mantém a história.
  const badgeDocs: BadgeDoc[] = (popoverStep?.docs ?? []).map((d) => ({
    key: d.entryId, name: d.name, at: d.at, openable: d.accessible,
  }));

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
      {/* Prompt 224 §2/§3 — o mesmo trilho do JourneyStepper do founder: os
          dois passam a ler-se como a mesma peça de UI. A seta de texto dá
          lugar ao conector que estica (flex-1), e o pill ganha o mesmo
          padding/tamanho. O 📄 inline já era daqui — foi este componente
          que serviu de padrão para corrigir o lado do founder. */}
      <div className="flex flex-wrap items-center gap-y-2">
        {steps.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && (
              <span aria-hidden
                className={`mx-1 h-px min-w-[12px] flex-1 ${
                  steps[i - 1].state === 'done' ? 'bg-[#0E7490]/30' : 'bg-gray-200'}`} />
            )}
            <span
              title={s.at ? `${s.label} — ${fmtDate(s.at)}` : s.label}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                s.state === 'done'
                  ? 'border-[#0E7490]/30 bg-[#E8F4F8] text-[#0E7490]'
                  : 'border-dashed border-gray-300 text-gray-400'
              }`}>
              {s.label}
              {s.count != null && <span className="text-[10px] opacity-70">({s.count})</span>}
              {s.at && <span className="hidden text-[10px] opacity-70 sm:inline">{fmtDate(s.at)}</span>}
              {s.docs && s.docs.length > 0 && (
                <button
                  onClick={(e) => setPopover({ anchor: (e.currentTarget as HTMLElement).getBoundingClientRect(), stepKey: s.key })}
                  title={s.docs.map((d) => `${d.name} — ${fmtDate(d.at)}`).join('\n')}
                  className="rounded hover:bg-white/70" aria-label={`${s.docs.length} document(s)`}>
                  📄<span className="text-[10px]">{s.docs.length}</span>
                </button>
              )}
            </span>
          </Fragment>
        ))}
      </div>
      {popover && badgeDocs.length > 0 && (
        <DocBadgePopover
          anchor={popover.anchor} docs={badgeDocs}
          onOpen={(key) => {
            const doc = popoverStep?.docs?.find((d) => d.entryId === key);
            if (doc?.accessible) onOpenDoc(doc.documentId);
          }}
          onSeeInHistory={onSeeInHistory}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
