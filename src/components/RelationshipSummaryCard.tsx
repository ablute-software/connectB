'use client';
// IRM_SPEC §4b — Relationship summary card. Compact chip for the pipeline row;
// full stage stepper + one-liner + CTAs for the entity page header.
import { useEffect, useRef, useState } from 'react';
import type { Entity, PassReasonCategory } from '@/lib/types';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/confirm';
import {
  STAGE_LABEL, STAGE_ORDER, relationshipSummary, stageExits, PASS_REASON_CATEGORIES,
  type WhoseTurn, type Health, type DealMessageTouch,
} from '@/lib/relationship';
import { planPark, planPass, planInvested, planSnooze, advanceConfirmation, type ExitPlan } from '@/lib/exit-effects';

// Prompt 226 §4 — opções fixas. Sem "custom": um date-picker aqui era mais
// caixilharia do que valor, e estas quatro cobrem o que o founder diz em voz
// alta ("daqui a uma semana", "depois do verão").
const SNOOZE_OPTIONS = [
  { days: 3, label: '3 days' }, { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' }, { days: 30, label: '1 month' },
] as const;
import { derivedStage } from '@/lib/derived-stage';
import { JourneyStepper } from '@/components/JourneyStepper';

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

// Prompt 269 §3 — `neutral` flattens the chip to gray regardless of
// whoseTurn, for the Pipeline's "Showing frozen" view: a frozen row still
// computing "We owe a reply"/"Overdue" in the same live colors as an
// active row reads as urgent when it structurally can't be acted on the
// same way. The label itself is unchanged — this mutes tone, not content.
export function WhoseTurnChip({ entityId, dealMessageTouches = [], neutral = false }: { entityId: string; dealMessageTouches?: DealMessageTouch[]; neutral?: boolean }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entityId, new Date(), dealMessageTouches);
  // Prompt 304 — dropped whitespace-nowrap: Prompt 286 already diagnosed
  // this exact mechanism for StatusPill (a non-wrapping span forces its
  // table-fixed column past its allotted percentage) but its own grep was
  // scoped to one file and missed this second site, in the pipeline row's
  // Entity cell via RelationshipCompactLine. Let the label wrap inside the
  // pill instead of stretching the column.
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${neutral ? 'bg-gray-100 text-gray-400' : WHOSE_TURN_STYLE[s.whoseTurn]}`}>
      {WHOSE_TURN_LABEL[s.whoseTurn]}
    </span>
  );
}

// Compact version for the pipeline row — a whose-turn chip + one-line status.
export function RelationshipCompactLine({ entityId, neutral = false }: { entityId: string; neutral?: boolean }) {
  const { db } = useStore();
  const s = relationshipSummary(db, entityId);
  if (s.touchCount === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
      <HealthDot entityId={entityId} />
      <WhoseTurnChip entityId={entityId} neutral={neutral} />
      <span>
        Last touch {s.lastTouchAt?.slice(0, 10)} ({s.daysSinceLastTouch}d) · {s.touchCount} touch{s.touchCount === 1 ? '' : 'es'}
      </span>
    </div>
  );
}

// Prompt 397 §A.3 — the journey+state+actions card. Used to also carry
// dates cards, the Sherlock Tip and the history column (Prompt 240's
// two-column layout) — those moved out: the Tip is now SherlockInsightBanner
// (full-width, between this card and the rest of the page); dates+history
// moved to the entity page's own right-column panel (Prompt 397 §B).
export function RelationshipSummaryCard({
  entity, onClassifyRequest, onViewInHistory, dealMessageTouches = [],
}: {
  entity: Entity;
  // Prompt 208 §D — pedido de "leva-me a resposta por classificar". O cartao
  // nao sabe desenhar o historico; quem sabe e o RecentInteractions, logo
  // isto sobe a pagina da entidade e desce por focusClassifyNonce.
  onClassifyRequest?: () => void;
  // Prompt 209 — "ver no historico" a partir do badge de documentos do
  // stepper. Mesmo padrao: o cartao pede, a pagina liga ao historico.
  onViewInHistory?: (interactionId: string) => void;
  // Prompt 197 C.1 — the caller (entities/[id]/page.tsx) already has this
  // entity's Sherlock thread loaded (from resolving its "Message investor"
  // eligibility, Prompt 197 A), so it's threaded straight through here
  // instead of this card re-fetching it independently.
  dealMessageTouches?: DealMessageTouch[];
}) {
  const { db, setRelationshipStage, undoStageChange, setEntityStatus, addTask, toggleTask, updateTask, updateEntity, logInteraction, addRejectionCode } = useStore();
  const confirm = useConfirm();
  // Prompt 249 §A — 'decision-choose' is the new step: "Move to Decision"
  // no longer advances on click, it asks for the outcome first. Choosing
  // "Passed" here just switches into the EXISTING 'pass' mode below (same
  // textarea, same required-reason rule, same Save button) — one path, not
  // two that could drift. "Invested" needs no reason, so it applies
  // immediately from the chooser itself.
  const [exitMode, setExitMode] = useState<'none' | 'pass' | 'decision-choose'>('none');
  const [passReason, setPassReason] = useState('');
  // Prompt 251/253 Bloco A — the quick-pass flow used to discard passReason
  // entirely (setEntityStatus's `reason` param is only ever used for
  // status==='dormant', never 'passed' — confirmed by reading both store
  // providers). 42 of 43 real passes in production have no
  // pass_reason_category, and this silent drop is a real part of why.
  // passCat restores the category select /log already had; the "Save as
  // passed" button below now creates a real interaction (classification
  // 'pass', pass_reason, pass_reason_category) via logInteraction instead
  // of just flipping entity status.
  const [passCat, setPassCat] = useState<PassReasonCategory>('other');
  // Optional per-axis codification of this pass (rejection_codes, 0184) --
  // always optional (251-B §1), so it starts empty and stays empty unless
  // the founder adds a row. One row = { axisCode, levelLabel, requiredLevel }.
  const [axisCodeRows, setAxisCodeRows] = useState<{ axisCode: string; levelLabel: string; requiredLevel: string }[]>([]);
  // Prompt 205 §A — o que se mostra no lugar do banner depois de decidir. O
  // Nuno escolheu "Frozen" e nada de visivel aconteceu; o clique tem de ter
  // eco imediato, nao so uma mudanca de pill algures no topo.
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // Prompt 214 §C.2 — janela de arrependimento. O founder mudou
  // Meeting->Diligence com um clique e nao tinha como recuar; a app so lhe
  // oferecia empurrar mais para a frente.
  const [undoable, setUndoable] = useState<{ milestoneId: string; previous?: typeof ds.manual; label: string } | null>(null);
  // §C.3 — dispensar a sugestao sem a seguir. Vive no componente e nao na
  // base de dados de proposito: e "agora nao", nao "nunca mais".
  const [dismissed, setDismissed] = useState(false);
  // Prompt 225 §3 — o menu "Something else". Dropdown local, sem dependência
  // nova: `absolute` dentro do banner (não `fixed`, portanto a regra do
  // CLAUDE.md sobre overlays em portal não se aplica aqui). Fecha ao
  // escolher, ao clicar fora e com Escape.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Prompt 226 §4 — o Snooze tem menu próprio, ao lado do "Something else".
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);
  // Prompt 396 §3 — "Move to X / Snooze ▾ / Something else ▾" now sits
  // behind a "＋"/"−" toggle, collapsed by default (pipeline's own
  // expand/collapse pattern) — pure presentation, no condition/logic below
  // changes (exits.show, canAdvance, parkedOrClosed, the two menus). A flow
  // opened FROM inside the row (exitMode 'pass'/'decision-choose') already
  // implies the row was open to be clicked, so it stays open.
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen && !snoozeOpen) return;
    function onDown(e: MouseEvent) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (snoozeOpen && snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) setSnoozeOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setMenuOpen(false); setSnoozeOpen(false); } }
    // `mousedown` e não `click`, pela mesma razão do DocBadgePopover: o
    // clique que abriu ainda se está a propagar e fechá-lo-ia no mesmo gesto.
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen, snoozeOpen]);

  function changeStage(next: Parameters<typeof setRelationshipStage>[1], label: string) {
    const previous = db.relationshipState.find((r) => r.entity_id === entity.id)?.stage;
    const milestoneId = setRelationshipStage(entity.id, next);
    setUndoable({ milestoneId, previous, label });
    // 10s: tempo de ler o toast e reagir, sem ficar pendurado no ecra.
    window.setTimeout(() => setUndoable((u) => (u?.milestoneId === milestoneId ? null : u)), 10_000);
  }

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
      if (d.action === 'done') {
        toggleTask(d.taskId);
        // Prompt 269 §1 — exit-effects.ts already computes WHY each task
        // got auto-closed (d.reason); it was being thrown away instead of
        // recorded. Appended, never overwriting a founder's own note on
        // the task (notes is also a real founder-facing field — the
        // appointment-note flow, AgendaPanel.tsx).
        const existing = db.tasks.find((t) => t.id === d.taskId)?.notes;
        updateTask(d.taskId, { notes: existing ? `${existing}\n\n${d.reason}` : d.reason });
      } else {
        updateTask(d.taskId, { due_at: d.dueAt });
      }
    }
    setConfirmation(plan.confirmation);
  }
  const s = relationshipSummary(db, entity.id, new Date(), dealMessageTouches);
  // Prompt 197 C.2 — continua a ser uma sugestão, nunca uma promoção
  // automática: o founder é que decide qual das saídas usa.
  // Prompt 202 §A.2 + §E — a decisão de que saídas mostrar vive em
  // relationship.ts (stageExits), que é pura e testada. Aqui só se desenha.
  const exits = stageExits(db, entity, new Date(), dealMessageTouches);
  const { lastInboundWasPass, nextStage } = exits;
  // Prompt 225 §3 — o estágio anterior REAL, para o "Move back". Índice > 1
  // e não > 0 de propósito: 'contacted' é o primeiro estágio com histórico,
  // e voltar dali seria voltar a 'not_contacted' — apagar o facto de já se
  // ter contactado, que não é o que "corrigir um avanço por engano" quer
  // dizer. Em 'contacted' o item simplesmente não aparece.
  const stageIndex = STAGE_ORDER.indexOf(s.stage);
  const previousStage = stageIndex > 1 ? STAGE_ORDER[stageIndex - 1] : null;
  // Prompt 205 §E — uma entidade parqueada/fechada não pode continuar a
  // desenhar um funil activo ao lado do pill que diz "dormant". O stepper
  // fica neutro e o chip de "de quem é a vez" desaparece: não é vez de
  // ninguém enquanto isto estiver parado.
  // Prompt 209 (resto) — a mesma leitura do stepper e do "Next:": vem toda do
  // derivedStage, que ja aplica a precedencia (pass classificado fecha, mesmo
  // com dormant herdado). Antes isto chamava entityMode(entity) directamente
  // e a pagina podia dizer "Declined" no stepper e "parked" no chip.
  // Prompt 206-A — o stepper passa a desenhar o estágio EFECTIVO (factos, com
  // o manual a ganhar quando está à frente e não é contradito), em vez do
  // que alguém clicou uma vez e nunca mais reviu.
  const ds = derivedStage(db, entity.id);
  const mode = ds.mode;
  // A razao ja existe na interacao classificada -- reutiliza-se em vez de
  // inventar texto novo para o dormant_reason.
  // Prompt 240 — passa a guardar-se a INTERACAO toda, nao so a razao: o
  // cartao de pass reason precisa tambem da categoria e da data do pass (e
  // essa data, nao entity.updated_at, e que data o "Closed" no cartao de
  // datas — updated_at muda com qualquer edicao sem relacao com o fecho).
  const lastPassInteraction = db.interactions
    .filter((i) => i.entity_id === entity.id && i.direction === 'in' && i.classification === 'pass')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  const lastPassReason = lastPassInteraction?.pass_reason;
  const parkedOrClosed = mode !== 'active';

  return (
    // Prompt 397 §A.1/§A.3 — full-width journey card: rounded-2xl, no
    // border, diffuse shadow (the study's card style for this whole page).
    <div className="rounded-2xl bg-white px-5 py-3.5 shadow-[0_4px_20px_rgba(15,23,42,0.06)]">
      <div className="text-center text-[10.5px] font-semibold uppercase tracking-wide text-[#0E7490]">Current stage</div>
      {/* Prompt 209 — o stepper e agora o JourneyStepper: desenha o que o
          journeySteps() decide (percorridos com ✓, desfecho como ultimo chip,
          sem estagios cinzentos depois de terminada) e leva o badge 📄.
          Prompt 226 §1/§2 — os cartoes do 225 desceram para uma linha
          propria abaixo do banner: aqui em cima disputavam a largura com o
          trilho (era o que empurrava o "Decision" para a 2ª linha) e
          deixavam um vazio vertical enorme ao lado de um stepper de 40px.
          O trilho volta a ter a largura toda; o overflow-x-auto e a rede
          para quando mesmo assim nao couber. Prompt 397 §A.3 — `variant`
          restyles ONLY this instance (JourneyStepper is also used by
          InvestorJourneyStrip.tsx, whose own look stays untouched). */}
      <div data-tour-id="entity-journey" className="mt-1.5 flex justify-center overflow-x-auto">
        <JourneyStepper entity={entity} onViewInHistory={onViewInHistory} variant="rail" />
      </div>

      {(ds.contradicted || ds.manualAhead || ds.unclassifiedReplies > 0 || parkedOrClosed) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          {/* O caso Adara: os factos dizem que acabou e o stepper mostrava
              uma fase activa. Aqui o aviso é o ponto, não um detalhe. */}
          {ds.contradicted && ds.manual && (
            // Prompt 209 — UMA linha discreta com a accao clicavel. O alerta
            // vermelho comprido competia com o proprio stepper, que agora ja
            // mostra o desfecho: repetir a mesma noticia mais alto nao a
            // torna mais legivel.
            <button
              onClick={() => {
                setRelationshipStage(entity.id, ds.derived);
                // Prompt 209 (resto) — UMA accao, estado coerente em todo o
                // lado. So mexer no stage deixava o status 'dormant' herdado
                // por baixo, e a pagina voltava a discordar de si propria
                // assim que alguem olhasse para o pill.
                if (ds.derived === 'decision' && entity.status !== 'passed') {
                  setEntityStatus(entity.id, 'passed', lastPassReason ?? 'Accepted from the classified reply');
                }
              }}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500 hover:bg-gray-200" title={ds.reason}>
              stage set manually: {STAGE_LABEL[ds.manual]} · accept the facts ({STAGE_LABEL[ds.derived]})
            </button>
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
            // Prompt 208 §D — ISTO era um Link para /log?entity=..., ou seja
            // um formulario de interacao NOVA em branco, quando o inbound ja
            // estava registado: convidava a duplicar em vez de resolver.
            // Agora leva ao historico, com a resposta em destaque e o
            // controlo de classificacao na propria linha.
            <button onClick={onClassifyRequest}
              disabled={!onClassifyRequest}
              className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 hover:bg-amber-200 disabled:cursor-default">
              {ds.unclassifiedReplies} {ds.unclassifiedReplies === 1 ? 'reply' : 'replies'} to classify
            </button>
          )}
        </div>
      )}

      {/* Prompt 413 §3 — status line and the "+ Actions" toggle now share
          ONE row (justify-between) instead of the toggle owning a whole row
          to itself even when collapsed (the common case) — that empty-
          looking row was ~40px of the card's height for nothing. The
          toggle only ever wraps below on narrow viewports (flex-wrap),
          which is fine — it just isn't the common case. Expanded content
          (Move to X / Snooze / Something else) still gets its own row
          below, only when actionsOpen — see that block's own comment. */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-gray-700">
          <HealthDot entityId={entity.id} dealMessageTouches={dealMessageTouches} />
          {!confirmation && !dismissed && exits.show && (
            <span className={
              lastInboundWasPass ? 'font-semibold text-[#B00000]'
                : s.whoseTurn === 'overdue' ? 'font-semibold text-amber-800'
                : 'text-gray-700'}>
              {lastInboundWasPass
                ? `They passed — this still shows as ${STAGE_LABEL[s.stage]}.`
                : s.whoseTurn === 'overdue'
                  // Nunca responderam: dizer "They've replied" aqui seria mentira,
                  // e é o caso em que o founder mais precisa de uma saída.
                  ? `No reply in ${s.daysSinceLastTouch ?? 0} days — this still shows as ${STAGE_LABEL[s.stage]}.`
                  : `They've replied — this still shows as ${STAGE_LABEL[s.stage]}.`}
            </span>
          )}
          {/* Prompt 240 (mockup declined) — uma relação fechada não tem acções
              de avanço; dizer isso é mais honesto do que uma linha vazia. */}
          {parkedOrClosed && (
            <span className="italic text-gray-400">Closed relationship — no advance actions.</span>
          )}
        </div>
        {/* Prompt 396 §3 — collapsed by default (pipeline's own expand/
            collapse pattern). Same condition the expanded content below
            still uses (`!parkedOrClosed && exitMode === 'none'`) — a
            parked/closed entity or a mid-flow exitMode has no actions to
            toggle open, same as before this merge. */}
        {!parkedOrClosed && exitMode === 'none' && (
          <button data-tour-id="entity-actions" onClick={() => setActionsOpen((o) => !o)}
            aria-expanded={actionsOpen} aria-label={actionsOpen ? 'Hide actions' : 'Show actions'}
            className="shrink-0 rounded-full border border-gray-300 bg-white px-2 py-1 text-[10.5px] font-semibold text-gray-500 hover:bg-gray-50">
            {actionsOpen ? '−' : '＋ Actions'}
          </button>
        )}
      </div>

      {/* Prompt 240 — "Move to X"/"Snooze"/"Something else", only when the
          toggle above is open. As before this merge: "Move to"/"Snooze"
          still depend on exits.show; "Something else" is available
          whenever the relationship is active (233 §B). */}
      {!parkedOrClosed && exitMode === 'none' && actionsOpen && (
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
        {!confirmation && !dismissed && exits.show && exits.canAdvance && (
          <button onClick={() => {
              // Prompt 249 §A — Decision is no longer hidden from this
              // button, but a click here never advances it directly: it
              // opens the outcome confirmation instead (below). Every other
              // stage keeps advancing immediately, unchanged.
              if (nextStage === 'decision') { setExitMode('decision-choose'); return; }
              changeStage(nextStage, STAGE_LABEL[nextStage]); setConfirmation(advanceConfirmation(STAGE_LABEL[nextStage]));
            }}
            className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-[#0c637b]">
            Move to {STAGE_LABEL[nextStage]}
          </button>
        )}
        {/* Prompt 226 §4 — Snooze. "Nao agora" nao e "desisti": a entidade
            fica ACTIVA e so as tarefas pendentes mudam de data (planSnooze,
            irmao do planPark sem o setEntityStatus). */}
        {!confirmation && !dismissed && exits.show && (
          <div className="relative" ref={snoozeRef}>
            <button onClick={() => { setSnoozeOpen((o) => !o); setMenuOpen(false); }}
              aria-haspopup="menu" aria-expanded={snoozeOpen}
              className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-gray-600 hover:bg-gray-50">
              Snooze ▾
            </button>
            {snoozeOpen && (
              <div role="menu"
                className="absolute right-0 top-[calc(100%+6px)] z-10 min-w-[150px] rounded-[10px] border border-gray-200 bg-white p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,.18)]">
                {SNOOZE_OPTIONS.map((o) => (
                  <button key={o.days} role="menuitem"
                    onClick={() => {
                      setSnoozeOpen(false);
                      const plan = planSnooze(entity, db.tasks, new Date(), o.days);
                      applyPlan(plan);
                      setConfirmation(plan.confirmation);
                    }}
                    className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-gray-800 hover:bg-gray-100">
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {(
          <div className="relative" ref={menuRef}>
            <button onClick={() => { setMenuOpen((o) => !o); setSnoozeOpen(false); }}
              aria-haspopup="menu" aria-expanded={menuOpen}
              className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[10.5px] text-gray-500 hover:bg-gray-50">
              Something else ▾
            </button>
            {menuOpen && (
              // right-0: o menu passou para a direita da linha, portanto
              // ancora à direita ou saía fora do cartão.
              <div role="menu"
                className="absolute right-0 top-[calc(100%+6px)] z-10 min-w-[230px] rounded-[10px] border border-gray-200 bg-white p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,.18)]">
                {/* Ajuste pedido pelo Nuno — corrigir um avanço por engano
                    sem re-desenhar a barra. Só aparece havendo estágio
                    anterior REAL: em 'contacted' (o primeiro com
                    histórico) não há para onde voltar. Reutiliza o
                    changeStage de sempre, com o undo que ele já traz. */}
                {previousStage && (
                  <>
                    <button role="menuitem"
                      onClick={() => { setMenuOpen(false); changeStage(previousStage, STAGE_LABEL[previousStage]); setConfirmation(`→ Moved back to ${STAGE_LABEL[previousStage]}.`); }}
                      className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-gray-800 hover:bg-gray-100">
                      ↩ Move back to {STAGE_LABEL[previousStage]}
                    </button>
                    <div className="mx-0.5 my-1 h-px bg-gray-200" />
                  </>
                )}
                {/* Prompt 214 §C.3 — ha sempre a saida de nao fazer nada. Uma
                    sugestao sem "dispensar" nao e sugestao, e insistencia.
                    Prompt 233 §B — só faz sentido havendo sugestão activa
                    para dispensar: continua condicionado a exits.show. */}
                {exits.show && (
                  <button role="menuitem" onClick={() => { setMenuOpen(false); setDismissed(true); }}
                    className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-gray-800 hover:bg-gray-100">
                    Dismiss — keep as is
                  </button>
                )}
                {/* Saída 2 — o "não". Pede a razão, que é obrigatória.
                    Prompt 233 §B — SEMPRE disponível: passar não depende de
                    ter havido sugestão nenhuma, é uma decisão válida em
                    qualquer momento. */}
                <button role="menuitem" onClick={() => { setMenuOpen(false); setExitMode('pass'); }}
                  className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-[#B00000] hover:bg-gray-100">
                  No interest / over — marks as passed
                </button>
                {/* Saída 3 — parquear. Em 'contacted' lê-se "cold", que é o
                    que de facto aconteceu: nunca responderam. Prompt 233
                    §B — SEMPRE disponível, pela mesma razão do pass: é
                    exactamente o caso que faltava sem "Mark dormant". */}
                <button role="menuitem" onClick={async () => {
                    setMenuOpen(false);
                    // Prompt 269 §1 — an OPEN investor_interest task means a
                    // real expressed interest is waiting on a reply.
                    // planPark below already closes it (Prompt 205's
                    // answersByParking heuristic, action_type='follow_up_thread')
                    // but did so silently, with no acknowledgment that the
                    // founder is choosing to freeze instead of responding —
                    // this confirm is that acknowledgment. Cancel leaves the
                    // entity and the task exactly as they were.
                    const hasOpenInterest = db.tasks.some((t) => t.entity_id === entity.id && !t.done && t.source === 'investor_interest');
                    if (hasOpenInterest && !(await confirm({ message: "This investor expressed interest and you haven't responded — freeze anyway?" }))) return;
                    setEntityStatus(entity.id, 'dormant', exits.parkLabel === 'cold' ? 'Cold — no reply' : 'Frozen — no continuity');
                    applyPlan(planPark(entity, db.tasks, new Date()));
                  }}
                  className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-gray-800 hover:bg-gray-100">
                  {exits.parkLabel === 'cold' ? 'Cold / no reply' : 'Frozen / no continuity'} — parks this investor
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      )}
      {/* Prompt 249 §A — o passo de confirmação do "Move to Decision":
          pergunta o desfecho antes de mexer em nada. Cancelar volta a
          'none' sem tocar em stage/status/tasks nenhuns. */}
      {!parkedOrClosed && exitMode === 'decision-choose' && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          <p className="text-xs text-gray-600">Move to Decision — what was the outcome?</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setExitMode('pass')}
              className="rounded-full bg-[#B00000] px-2.5 py-1 text-[11px] font-semibold text-white">
              Passed
            </button>
            <button onClick={() => {
                setEntityStatus(entity.id, 'invested');
                setRelationshipStage(entity.id, 'decision');
                applyPlan(planInvested(entity, db.tasks));
                setExitMode('none');
              }}
              className="rounded-full bg-green-700 px-2.5 py-1 text-[11px] font-semibold text-white">
              Invested
            </button>
            <button onClick={() => setExitMode('none')}
              className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* O textarea da razão do pass ocupa a linha toda; vive fora do banner
          de saída (exits.show) porque "No interest / over" agora dispara
          daqui mesmo sem sugestão nenhuma activa, e o "Move to Decision" ->
          "Passed" (249 §A) reusa este mesmo passo em vez de duplicar. */}
      {!parkedOrClosed && exitMode === 'pass' && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-red-200 bg-red-50/40 p-2.5">
          <select value={passCat} onChange={(e) => setPassCat(e.target.value as PassReasonCategory)}
            className="rounded border border-red-200 bg-white px-2 py-1.5 text-xs">
            {PASS_REASON_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
          <textarea value={passReason} onChange={(e) => setPassReason(e.target.value)} rows={2}
            placeholder="Why did they pass? Verbatim if possible — REQUIRED. Ten of these rewrite the pitch."
            className="w-full rounded border border-red-200 p-2 text-xs text-gray-900" />
          {/* Prompt 251/253 Bloco A — optional, per-axis codification of
              this pass (rejection_codes). Always optional: an empty row is
              just dropped on save, never blocks it. */}
          <div className="space-y-1">
            {axisCodeRows.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1">
                <input value={row.axisCode} placeholder="axis (e.g. market_maturity)"
                  onChange={(e) => setAxisCodeRows((rows) => rows.map((r, j) => j === i ? { ...r, axisCode: e.target.value } : r))}
                  className="w-40 rounded border border-red-200 px-1.5 py-1 text-[11px]" />
                <input value={row.requiredLevel} placeholder="level (e.g. 3)" inputMode="numeric"
                  onChange={(e) => setAxisCodeRows((rows) => rows.map((r, j) => j === i ? { ...r, requiredLevel: e.target.value } : r))}
                  className="w-16 rounded border border-red-200 px-1.5 py-1 text-[11px]" />
                <input value={row.levelLabel} placeholder="what that level means"
                  onChange={(e) => setAxisCodeRows((rows) => rows.map((r, j) => j === i ? { ...r, levelLabel: e.target.value } : r))}
                  className="flex-1 min-w-[140px] rounded border border-red-200 px-1.5 py-1 text-[11px]" />
                <button onClick={() => setAxisCodeRows((rows) => rows.filter((_, j) => j !== i))}
                  className="text-[11px] text-gray-400 hover:text-[#B00000]">✕</button>
              </div>
            ))}
            <button onClick={() => setAxisCodeRows((rows) => [...rows, { axisCode: '', levelLabel: '', requiredLevel: '' }])}
              className="text-[11px] font-medium text-gray-500 hover:underline">
              + Code this rejection by axis (optional)
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              disabled={passReason.trim().length === 0}
              onClick={() => {
                const interaction = logInteraction({
                  entity_id: entity.id, direction: 'in', channel: 'email', content: passReason.trim(),
                  classification: 'pass', pass_reason: passReason.trim(), pass_reason_category: passCat,
                });
                setEntityStatus(entity.id, 'passed');
                setRelationshipStage(entity.id, 'decision');
                applyPlan(planPass(entity, db.tasks));
                for (const row of axisCodeRows) {
                  const level = Number(row.requiredLevel);
                  if (!row.axisCode.trim() || !row.levelLabel.trim() || !Number.isFinite(level)) continue;
                  addRejectionCode({
                    entity_id: entity.id, axis_code: row.axisCode.trim(), required_level: level,
                    level_label: row.levelLabel.trim(), source_interaction_id: interaction.id,
                  });
                }
                setExitMode('none'); setPassReason(''); setPassCat('other'); setAxisCodeRows([]);
              }}
              className="rounded-full bg-[#B00000] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
              Save as passed
            </button>
            <button onClick={() => { setExitMode('none'); setPassReason(''); setPassCat('other'); setAxisCodeRows([]); }}
              className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-600">
              Cancel
            </button>
          </div>
          {passReason.trim().length === 0 && (
            <p className="text-[11px] text-gray-500">A pass reason is required — it&apos;s what makes the next pitch better.</p>
          )}
        </div>
      )}
      {undoable && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <span>Stage changed to {undoable.label}.</span>
          <button
            onClick={() => {
              undoStageChange(entity.id, undoable.previous, undoable.milestoneId);
              setUndoable(null); setConfirmation(null);
            }}
            className="font-semibold text-[#0E7490] hover:underline">
            Undo
          </button>
        </div>
      )}
      {confirmation && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
          {confirmation}
        </div>
      )}

    </div>
  );
}
