'use client';
// IRM_SPEC §4b — Relationship summary card. Compact chip for the pipeline row;
// full stage stepper + one-liner + CTAs for the entity page header.
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Entity } from '@/lib/types';
import { useStore } from '@/lib/store';
import {
  STAGE_ORDER, STAGE_LABEL, relationshipSummary, nextBestAction, stageExits, entityMode, type WhoseTurn, type Health, type DealMessageTouch,
} from '@/lib/relationship';
import { LOCK_DAYS } from '@/lib/rules';
import { planPark, planPass, advanceConfirmation, type ExitPlan } from '@/lib/exit-effects';
import { derivedStage } from '@/lib/derived-stage';
import { TermHint } from '@/components/ui';

// Prompt 49 §4 — jargon inside nextBestAction()'s free-text copy gets a
// clickable (i) the first time it appears in the string. First-match-only
// (not global): these are short one-liners, a single term is what's ever
// actually present, and replacing every occurrence would need a much less
// readable regex-split-map dance for no real benefit today.
const NEXT_STEP_GLOSSARY: { pattern: RegExp; explain: string }[] = [
  { pattern: /pre-flight/i, explain: 'An automatic check run just before a first message — flags missing hook research, banned phrases, or reaching out too soon.' },
  { pattern: /^Locked/, explain: `Outreach to this investor is paused for ${LOCK_DAYS} days after your last message, so a reply has time to arrive before you follow up again.` },
];

function annotateNextStep(text: string): ReactNode {
  for (const term of NEXT_STEP_GLOSSARY) {
    const m = text.match(term.pattern);
    if (m?.index === undefined) continue;
    const before = text.slice(0, m.index);
    const match = m[0];
    const after = text.slice(m.index + match.length);
    return <>{before}{match}<TermHint text={term.explain} />{after}</>;
  }
  return text;
}

const WHOSE_TURN_STYLE: Record<WhoseTurn, string> = {
  us: 'bg-cyan-100 text-cyan-900',
  them: 'bg-blue-100 text-blue-900',
  overdue: 'bg-red-100 text-[#B00000]',
  none: 'bg-gray-100 text-gray-400',
};
const WHOSE_TURN_LABEL: Record<WhoseTurn, string> = {
  us: 'We owe a reply', them: 'Waiting on them', overdue: 'Overdue', none: 'No contact yet',
};

const HEALTH_DOT: Record<Health, string> = {
  hot: 'bg-[#B00000]', warm: 'bg-green-600', stalled: 'bg-gray-400', none: '',
};
const HEALTH_LABEL: Record<Health, string> = {
  hot: 'Hot — meeting or diligence', warm: 'Warm — recent activity', stalled: 'Stalled — no movement in a while', none: '',
};

// Prompt 197 C.1 — dealMessageTouches is optional and defaults to none, so
// every existing caller that doesn't have an entity's Sherlock thread
// loaded (RelationshipCompactLine's bulk per-row usage in the Pipeline
// table, in particular) keeps behaving exactly as before. See
// relationship.ts's own header comment on relationshipSummary for why this
// stays additive rather than a required param.
export function HealthDot({ entityId, dealMessageTouches = [] }: { entityId: string; dealMessageTouches?: DealMessageTouch[] }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entityId, new Date(), dealMessageTouches);
  if (s.health === 'none') return null;
  return <span title={HEALTH_LABEL[s.health]} className={`inline-block h-2 w-2 rounded-full ${HEALTH_DOT[s.health]}`} />;
}

export function WhoseTurnChip({ entityId, dealMessageTouches = [] }: { entityId: string; dealMessageTouches?: DealMessageTouch[] }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entityId, new Date(), dealMessageTouches);
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${WHOSE_TURN_STYLE[s.whoseTurn]}`}>
      {WHOSE_TURN_LABEL[s.whoseTurn]}
    </span>
  );
}

// Compact version for the pipeline row — a whose-turn chip + one-line status.
export function RelationshipCompactLine({ entityId }: { entityId: string }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entityId);
  if (s.touchCount === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
      <HealthDot entityId={entityId} />
      <WhoseTurnChip entityId={entityId} />
      <span>
        Last touch {s.lastTouchAt?.slice(0, 10)} ({s.daysSinceLastTouch}d) · {s.touchCount} touch{s.touchCount === 1 ? '' : 'es'}
      </span>
    </div>
  );
}

// Full version for the entity page header.
export function RelationshipSummaryCard({ entity, onOpenThread, dealMessageTouches = [] }: {
  entity: Entity; onOpenThread?: () => void;
  // Prompt 197 C.1 — the caller (entities/[id]/page.tsx) already has this
  // entity's Sherlock thread loaded (from resolving its "Message investor"
  // eligibility, Prompt 197 A), so it's threaded straight through here
  // instead of this card re-fetching it independently.
  dealMessageTouches?: DealMessageTouch[];
}) {
  const { db, setRelationshipStage, setEntityStatus, addTask, toggleTask, updateTask } = useStore();
  const [exitMode, setExitMode] = useState<'none' | 'pass'>('none');
  const [passReason, setPassReason] = useState('');
  // Prompt 205 §A — o que se mostra no lugar do banner depois de decidir. O
  // Nuno escolheu "Frozen" e nada de visivel aconteceu; o clique tem de ter
  // eco imediato, nao so uma mudanca de pill algures no topo.
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Executa um plano de exit-effects.ts: cria a task de revisita e resolve
  // as pendentes. A task de revisita vem primeiro para o "Next:" ja a
  // apanhar no mesmo render (§D).
  function applyPlan(plan: ExitPlan) {
    if (plan.revisitTask) {
      addTask({
        title: plan.revisitTask.title, due_at: plan.revisitTask.dueAt,
        entity_id: entity.id, kind: 'follow_up', action_type: 'other', source: 'suggested',
      });
    }
    for (const d of plan.dispositions) {
      if (d.action === 'done') toggleTask(d.taskId);
      else updateTask(d.taskId, { due_at: d.dueAt });
    }
    setConfirmation(plan.confirmation);
  }
  const s = relationshipSummary(db, entity.id, new Date(), dealMessageTouches);
  const action = nextBestAction(db, entity.id, new Date(), dealMessageTouches);
  // Prompt 197 C.2 — continua a ser uma sugestão, nunca uma promoção
  // automática: o founder é que decide qual das saídas usa.
  // Prompt 202 §A.2 + §E — a decisão de que saídas mostrar vive em
  // relationship.ts (stageExits), que é pura e testada. Aqui só se desenha.
  const exits = stageExits(db, entity, new Date(), dealMessageTouches);
  const { lastInboundWasPass, nextStage } = exits;
  // Prompt 205 §E — uma entidade parqueada/fechada não pode continuar a
  // desenhar um funil activo ao lado do pill que diz "dormant". O stepper
  // fica neutro e o chip de "de quem é a vez" desaparece: não é vez de
  // ninguém enquanto isto estiver parado.
  const mode = entityMode(entity);
  const parkedOrClosed = mode !== 'active';
  // Prompt 206-A — o stepper passa a desenhar o estágio EFECTIVO (factos, com
  // o manual a ganhar quando está à frente e não é contradito), em vez do
  // que alguém clicou uma vez e nunca mais reviu.
  const ds = derivedStage(db, entity.id);
  const stepIdx = STAGE_ORDER.indexOf(ds.effective);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {parkedOrClosed && (
          <span className="mr-1 whitespace-nowrap rounded-full bg-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600">
            {mode === 'parked' ? '❄ parked' : '✕ closed'}
          </span>
        )}
        {STAGE_ORDER.map((stg, i) => (
          <div key={stg} className="flex items-center gap-1">
            <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ${
              parkedOrClosed ? 'bg-gray-100 text-gray-400'
                : i === stepIdx ? (ds.effective === 'decision' && entity.status === 'passed' ? 'bg-[#B00000] text-white' : 'bg-[#0E7490] text-white')
                : i < stepIdx ? 'bg-[#E8F4F8] text-cyan-900'
                : 'bg-gray-100 text-gray-400'}`}>
              {STAGE_LABEL[stg]}
            </span>
            {i < STAGE_ORDER.length - 1 && <span className="text-gray-300">→</span>}
          </div>
        ))}
      </div>

      {(ds.contradicted || ds.manualAhead || ds.unclassifiedReplies > 0 || parkedOrClosed) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {/* O caso Adara: os factos dizem que acabou e o stepper mostrava
              uma fase activa. Aqui o aviso é o ponto, não um detalhe. */}
          {ds.contradicted && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-[#B00000]" title={ds.reason}>
              ✕ {ds.reason} — stage was set to {STAGE_LABEL[ds.manual!]} manually
            </span>
          )}
          {/* Manual à frente sem contradição é legítimo: 'diligence' não tem
              facto nenhum que a produza. Nota discreta, não aviso. */}
          {ds.manualAhead && (
            <button onClick={() => setRelationshipStage(entity.id, ds.derived)}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 hover:bg-gray-200"
              title={`The facts only support ${STAGE_LABEL[ds.derived]} (${ds.reason}). Click to go back to that.`}>
              set manually · facts say {STAGE_LABEL[ds.derived]}
            </button>
          )}
          {ds.unclassifiedReplies > 0 && (
            <Link href={`/log?entity=${entity.id}`}
              className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 hover:bg-amber-200">
              {ds.unclassifiedReplies} {ds.unclassifiedReplies === 1 ? 'reply' : 'replies'} to classify
            </Link>
          )}
          {mode === 'parked' && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">
              {nextBestAction(db, entity.id, new Date(), dealMessageTouches)}
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <HealthDot entityId={entity.id} dealMessageTouches={dealMessageTouches} />
        {!parkedOrClosed && <WhoseTurnChip entityId={entity.id} dealMessageTouches={dealMessageTouches} />}
        <span>
          {s.firstContactAt ? `First contact ${s.firstContactAt.slice(0, 10)}` : 'No contact yet'}
          {s.lastTouchAt && s.lastTouchAt !== s.firstContactAt && ` · Last touch ${s.lastTouchAt.slice(0, 10)} (${s.daysSinceLastTouch}d ago)`}
          {s.touchCount > 0 && ` · ${s.touchCount} touch${s.touchCount === 1 ? '' : 'es'}`}
        </span>
      </div>
      {action && <div className="mt-1.5 text-xs font-medium text-[#0E7490]">Next: {annotateNextStep(action)}</div>}
      {confirmation && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
          {confirmation}
        </div>
      )}
      {!confirmation && exits.show && (
        <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
          lastInboundWasPass ? 'border-red-200 bg-red-50 text-[#B00000]'
            : s.whoseTurn === 'overdue' ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-cyan-200 bg-[#E8F4F8] text-cyan-900'}`}>
          <span>
            {lastInboundWasPass
              ? `They passed — this still shows as ${STAGE_LABEL[s.stage]}.`
              : s.whoseTurn === 'overdue'
                // Nunca responderam: dizer "They've replied" aqui seria mentira,
                // e é o caso em que o founder mais precisa de uma saída.
                ? `No reply in ${s.daysSinceLastTouch ?? 0} days — this still shows as ${STAGE_LABEL[s.stage]}.`
                : `They've replied — this still shows as ${STAGE_LABEL[s.stage]}.`}
          </span>

          {exitMode === 'none' && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {/* Saída 1 — avançar. Escondida num pass: oferecer "avançar" a
                  quem disse que não é exactamente o bug do caso Adara. */}
              {exits.canAdvance && (
                <button onClick={() => { setRelationshipStage(entity.id, nextStage); setConfirmation(advanceConfirmation(STAGE_LABEL[nextStage])); }}
                  className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0c637b]">
                  Move to {STAGE_LABEL[nextStage]}
                </button>
              )}
              {/* Saída 2 — o "não". Pede a razão, que é obrigatória. */}
              <button onClick={() => setExitMode('pass')}
                className="rounded-full border border-red-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#B00000] hover:bg-red-50">
                No interest / over — marks as passed
              </button>
              {/* Saída 3 — parquear. Em 'contacted' lê-se "cold", que é o que
                  de facto aconteceu: nunca responderam. Mesmo mecanismo. */}
              <button onClick={() => {
                  setEntityStatus(entity.id, 'dormant', exits.parkLabel === 'cold' ? 'Cold — no reply' : 'Parked — no continuity');
                  applyPlan(planPark(entity, db.tasks, new Date()));
                }}
                className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                {exits.parkLabel === 'cold' ? 'Cold / no reply' : 'Frozen / no continuity'} — parks this investor
              </button>
            </div>
          )}

          {exitMode === 'pass' && (
            <div className="mt-1.5 space-y-1.5">
              <textarea value={passReason} onChange={(e) => setPassReason(e.target.value)} rows={2}
                placeholder="Why did they pass? Verbatim if possible — REQUIRED. Ten of these rewrite the pitch."
                className="w-full rounded border border-red-200 p-2 text-xs text-gray-900" />
              <div className="flex gap-1.5">
                <button
                  disabled={passReason.trim().length === 0}
                  onClick={() => {
                    setEntityStatus(entity.id, 'passed', passReason.trim());
                    setRelationshipStage(entity.id, 'decision');
                    applyPlan(planPass(entity, db.tasks));
                    setExitMode('none'); setPassReason('');
                  }}
                  className="rounded-full bg-[#B00000] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                  Save as passed
                </button>
                <button onClick={() => { setExitMode('none'); setPassReason(''); }}
                  className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-600">
                  Cancel
                </button>
              </div>
              {passReason.trim().length === 0 && (
                <p className="text-[11px] text-gray-500">A pass reason is required — it&apos;s what makes the next pitch better.</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {onOpenThread && (
          // Prompt 206-B — contagem no proprio botao, e teal preenchido quando
          // ha respostas por classificar: a razao para ir ao historico e
          // precisamente essa.
          <button onClick={onOpenThread}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              ds.unclassifiedReplies > 0
                ? 'bg-[#0E7490] font-medium text-white hover:bg-[#0c637b]'
                : 'border border-gray-300 hover:bg-gray-50'}`}>
            History ({db.interactions.filter((i) => i.entity_id === entity.id).length})
            {ds.unclassifiedReplies > 0 && ` · ${ds.unclassifiedReplies} to classify`}
          </button>
        )}
        <Link href={`/log?entity=${entity.id}`} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
          Log interaction
        </Link>
      </div>
    </div>
  );
}
