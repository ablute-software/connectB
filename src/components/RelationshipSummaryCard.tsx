'use client';
// IRM_SPEC §4b — Relationship summary card. Compact chip for the pipeline row;
// full stage stepper + one-liner + CTAs for the entity page header.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Entity, PassReasonCategory } from '@/lib/types';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/confirm';
import {
  STAGE_LABEL, STAGE_ORDER, relationshipSummary, nextBestAction, nextBestActionButton, nextContactPerson, needsReopenTrigger, stageExits, PASS_REASON_CATEGORIES,
  type WhoseTurn, type Health, type DealMessageTouch,
} from '@/lib/relationship';
import { LOCK_DAYS, preflight, preflightSummary } from '@/lib/rules';
import { planPark, planPass, planInvested, planSnooze, advanceConfirmation, type ExitPlan } from '@/lib/exit-effects';

// Prompt 226 §4 — opções fixas. Sem "custom": um date-picker aqui era mais
// caixilharia do que valor, e estas quatro cobrem o que o founder diz em voz
// alta ("daqui a uma semana", "depois do verão").
const SNOOZE_OPTIONS = [
  { days: 3, label: '3 days' }, { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' }, { days: 30, label: '1 month' },
] as const;

// Prompt 269 §2 — minimal guard against saving a reopen_trigger that reads
// as cut off (real case: "nothing nee"). Not a hard content rule — some
// valid notes are genuinely short — just enough to catch the obviously
// truncated case without policing every phrasing.
const REOPEN_TRIGGER_MIN_LENGTH = 15;
import { derivedStage } from '@/lib/derived-stage';
import { JourneyStepper } from '@/components/JourneyStepper';
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

// Full version for the entity page header.
export function RelationshipSummaryCard({
  entity, onOpenThread, onClassifyRequest, onViewInHistory, dealMessageTouches = [], historySlot,
  pendingInterest, canMessage, onOpenMessage,
}: {
  entity: Entity; onOpenThread?: () => void;
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
  // Prompt 241 — o histórico da coluna direita, injectado pela página. É o
  // <RecentInteractions>, que já tem a classificação inline e os saltos;
  // este cartão só lhe dá o lugar no layout. Evita a segunda lista (a
  // duplicação que o 240 criou) sem trazer para aqui a máquina toda.
  historySlot?: ReactNode;
  // Prompt 396 §7 — the Sherlock Tip gets an actionable button when the
  // advice has an obvious target. These three are already known by the
  // caller (page.tsx) — no new derivation needed for them, unlike the
  // overdue-follow-up case (nextBestActionButton, below).
  pendingInterest?: boolean;
  canMessage?: boolean;
  onOpenMessage?: () => void;
}) {
  const { db, setRelationshipStage, undoStageChange, setEntityStatus, addTask, toggleTask, updateTask, updateEntity, logInteraction, addRejectionCode } = useStore();
  const confirm = useConfirm();
  // Prompt 251-B "Fase 0" — inline shortcut to fill entities.reopen_trigger
  // straight from the Sherlock Tip, for the one case (needsReopenTrigger)
  // where nothing is registered yet. null = not editing.
  const [reopenTriggerDraft, setReopenTriggerDraft] = useState<string | null>(null);
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
  const action = nextBestAction(db, entity.id, new Date(), dealMessageTouches);
  // Prompt 396 §7 — the overdue-follow-up case's own button target.
  const actionButton = nextBestActionButton(db, entity.id, new Date(), dealMessageTouches);
  // Prompt 254 — nextBestAction's not_contacted branch already names the
  // RESULT (ready / N issues); this recomputes the same preflight (cheap,
  // pure, no I/O — same call the People panel below already makes once per
  // row) so the Tip can render the actual issue list and, when clear, a
  // real "Log interaction" shortcut instead of leaving the founder to
  // guess what "pre-flight" meant.
  const nextContact = s.stage === 'not_contacted' ? nextContactPerson(db, entity.id) : undefined;
  const nextContactPreflight = nextContact ? preflightSummary(preflight(db, nextContact, null)) : undefined;
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
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      {/* Prompt 209 — o stepper e agora o JourneyStepper: desenha o que o
          journeySteps() decide (percorridos com ✓, desfecho como ultimo chip,
          sem estagios cinzentos depois de terminada) e leva o badge 📄.
          Prompt 226 §1/§2 — os cartoes do 225 desceram para uma linha
          propria abaixo do banner: aqui em cima disputavam a largura com o
          trilho (era o que empurrava o "Decision" para a 2ª linha) e
          deixavam um vazio vertical enorme ao lado de um stepper de 40px.
          O trilho volta a ter a largura toda; o overflow-x-auto e a rede
          para quando mesmo assim nao couber. */}
      <div data-tour-id="entity-journey" className="overflow-x-auto">
        <JourneyStepper entity={entity} onViewInHistory={onViewInHistory} />
      </div>

      {(ds.contradicted || ds.manualAhead || ds.unclassifiedReplies > 0 || parkedOrClosed) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
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

      {/* Prompt 240 — a linha de ACÇÕES sobe para aqui, alinhada à direita e
          sozinha: antes "Move to X"/"Snooze" viviam dentro do banner, a
          disputar a mesma linha do texto de estado, e o "Something else"
          vivia na linha do HealthDot. Três sítios para o mesmo tipo de
          decisão. Botões mais pequenos que os do banner anterior — são
          acções secundárias ao lado do stepper, não o assunto da página.
          As CONDIÇÕES de cada um não mudam: "Move to"/"Snooze" continuam a
          depender de haver sugestão activa (exits.show); "Something else"
          continua disponível sempre que a relação está activa (233 §B), que
          era o caminho que faltava quando não há sugestão nenhuma. */}
      {!parkedOrClosed && exitMode === 'none' && (
      <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
        {actionsOpen && (<>
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
        </>)}
        {/* Prompt 396 §3 — collapsed by default; this control is what's
            "in its place" (pipeline's own expand/collapse pattern). Always
            in the DOM regardless of `actionsOpen`, so it's a stable tour
            anchor even when the row above it isn't rendered. */}
        <button data-tour-id="entity-actions" onClick={() => setActionsOpen((o) => !o)}
          aria-expanded={actionsOpen} aria-label={actionsOpen ? 'Hide actions' : 'Show actions'}
          className="rounded-full border border-gray-300 bg-white px-2 py-1 text-[10.5px] font-semibold text-gray-500 hover:bg-gray-50">
          {actionsOpen ? '−' : '＋ Actions'}
        </button>
      </div>
      )}

      {/* Prompt 240 — a linha de ESTADO fica sozinha: chip + frase, sem
          botões a disputar-lhe espaço. A frase é só o texto das saídas; o
          `action` (o conselho) mudou-se para o cartão "Sherlock Tip" na
          coluna da esquerda, que é onde tem espaço para se ler. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-gray-700">
        <HealthDot entityId={entity.id} dealMessageTouches={dealMessageTouches} />
        {!parkedOrClosed && <WhoseTurnChip entityId={entity.id} dealMessageTouches={dealMessageTouches} />}
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

      {/* Prompt 240 — duas COLUNAS, seguindo o mockup: à esquerda os cartões
          de datas + o conselho (Tip) ou o desfecho (Pass reason); à direita
          o histórico, que passa a ser o bloco maior (`flex-[1.3]` contra
          `flex-1`) — invertendo o 228 §B, onde ele era o mais estreito.
          Em ecrã estreito o flex-wrap empilha as duas colunas. */}
      <div className="mt-4 flex flex-wrap items-start gap-4">
        <div className="flex min-w-[300px] flex-1 flex-col gap-3">
          {/* Dois cartões de datas lado a lado, como no mockup: cada facto
              com o seu rótulo, em vez de quatro linhas empilhadas num só. */}
          <div className="flex gap-3">
            <div className="min-w-0 flex-1 rounded-2xl border border-[#e6eef0] bg-[linear-gradient(155deg,#ffffff,#f3fafb_70%)] px-4 py-3 shadow-[0_1px_1px_rgba(15,60,70,.04),0_6px_14px_-6px_rgba(15,60,70,.14),inset_0_1px_0_rgba(255,255,255,.6)]">
              <div className="text-[11.5px] text-gray-500">First contact</div>
              <div className="mt-0.5 truncate text-sm font-bold text-[#0E7490]">
                {s.firstContactAt ? s.firstContactAt.slice(0, 10) : '—'}
              </div>
              <div className="mt-0.5 text-[11.5px] text-gray-500">
                {s.touchCount} {s.touchCount === 1 ? 'touch' : 'touches'}
              </div>
            </div>
            {/* Prompt 240 — quando a relação fechou COM pass, "Last touch"
                passa a "Closed", com a data da própria interação de pass.
                Nunca entity.updated_at: esse muda com qualquer edição sem
                relação nenhuma com o fecho. Sem pass classificado (ex.
                parked), mantém-se "Last touch" — não se inventa um desfecho
                que não foi registado. */}
            <div className="min-w-0 flex-1 rounded-2xl border border-[#e6eef0] bg-[linear-gradient(155deg,#ffffff,#f3fafb_70%)] px-4 py-3 shadow-[0_1px_1px_rgba(15,60,70,.04),0_6px_14px_-6px_rgba(15,60,70,.14),inset_0_1px_0_rgba(255,255,255,.6)]">
              {parkedOrClosed && lastPassInteraction ? (
                <>
                  <div className="text-[11.5px] text-gray-500">Closed</div>
                  <div className="mt-0.5 truncate text-sm font-bold text-gray-600">{lastPassInteraction.occurred_at.slice(0, 10)}</div>
                  <div className="mt-0.5 text-[11.5px] text-gray-500">
                    {Math.floor((Date.now() - new Date(lastPassInteraction.occurred_at).getTime()) / 86_400_000)}d ago
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11.5px] text-gray-500">Last touch</div>
                  <div className="mt-0.5 truncate text-sm font-bold text-[#0E7490]">
                    {s.lastTouchAt ? s.lastTouchAt.slice(0, 10) : '—'}
                  </div>
                  <div className="mt-0.5 text-[11.5px] font-semibold text-[#0E7490]">
                    {s.daysSinceLastTouch != null ? `${s.daysSinceLastTouch}d ago` : ' '}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Prompt 240 — "Sherlock Tip": o conselho do nextBestAction em
              cartão próprio, em vez de diluído numa linha neutra de estado.
              É a frase que o founder vai aprender a confiar, e merece o
              destaque. Verde-teal pálido, nunca saturado — a paleta do
              resto do produto.
              Prompt 251-B "Fase 0" — deixa de exigir relação activa: o Tip
              "devia sempre existir" (nota do Nuno) — numa relação fechada
              É a oportunidade de reabertura, quando existe. nextBestAction
              já devolve texto para closed/parked (derivado da doutrina de
              reopen, migração 0016) em vez do antigo silêncio total. */}
          {action && (
            <div data-tour-id="entity-tip" className="rounded-2xl border border-[#cdeadb] bg-[#F4FBF7] px-4 py-3.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.03em] text-[#0f5132]">
                <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-[5px] bg-[#0f5132] text-[10px] font-extrabold text-white">S</span>
                Sherlock Tip
              </div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-gray-800">{annotateNextStep(action)}</div>
              {/* Prompt 254 — the RESULT the headline above already named:
                  a real shortcut when clear (never just "go do it"), or
                  the actual list of what's failing (no jargon dump —
                  preflight's own reason text) when it isn't. */}
              {nextContactPreflight?.green && nextContact && (
                <Link href={`/log?entity=${entity.id}&person=${nextContact.id}`}
                  className="mt-1.5 inline-block rounded-lg bg-[#0f5132] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0c4028]">
                  Log the first interaction
                </Link>
              )}
              {nextContactPreflight && !nextContactPreflight.green && (
                <ul className="mt-1.5 space-y-0.5 text-[12px] text-gray-700">
                  {nextContactPreflight.failed.map((f) => (
                    <li key={f.key} className="flex gap-1.5">
                      <span aria-hidden className="text-[#0f5132]">·</span>
                      <span>{f.reason ?? f.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {/* Prompt 396 §7 — pending L3 contact request: already known
                  by the caller (page.tsx's own useInterestRequests), no new
                  derivation needed. Takes priority visually over the
                  overdue-follow-up button below — deciding on the request
                  is the more urgent of the two if somehow both apply. */}
              {pendingInterest ? (
                <Link href="/today"
                  className="mt-1.5 inline-block rounded-lg bg-[#0f5132] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0c4028]">
                  Decide in Today →
                </Link>
              ) : actionButton?.kind === 'follow_up' ? (
                canMessage && onOpenMessage ? (
                  <button onClick={onOpenMessage}
                    className="mt-1.5 inline-block rounded-lg bg-[#0f5132] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0c4028]">
                    Message investor
                  </button>
                ) : (
                  <Link href={`/log?entity=${entity.id}&person=${actionButton.personId}`}
                    className="mt-1.5 inline-block rounded-lg bg-[#0f5132] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0c4028]">
                    Log the follow-up
                  </Link>
                )
              ) : null}
              {/* Prompt 396 §7 — unclassified replies: same onClassifyRequest
                  the "N replies to classify" chip already uses (line ~350
                  above) — reused, not reimplemented. Orthogonal to whatever
                  nextBestAction's own text says, so it's not gated on
                  `action` matching any particular branch. */}
              {ds.unclassifiedReplies > 0 && onClassifyRequest && (
                <button onClick={onClassifyRequest}
                  className="mt-1.5 ml-1.5 inline-block rounded-lg border border-[#0f5132] px-2.5 py-1 text-[11px] font-semibold text-[#0f5132] hover:bg-[#e4f3ea]">
                  Classify {ds.unclassifiedReplies} {ds.unclassifiedReplies === 1 ? 'reply' : 'replies'}
                </button>
              )}
              {/* Prompt 251-B point 3 — the "nothing registered" case also
                  asks the founder to fix that, not just names the gap.
                  Prompt 269 §2 — reopen_trigger is now editable once set
                  too (real case: "nothing nee", a typo with no way to fix
                  it), and shown as an explicitly attributed founder note —
                  never fused into the Sherlock Tip sentence above, which
                  is Sherlock's own derived opinion, not a place for raw
                  manual text. A short minimum guards against saving
                  something that reads as cut off, without policing valid
                  short notes into being padded. */}
              {parkedOrClosed && (
                reopenTriggerDraft === null ? (
                  entity.reopen_trigger ? (
                    <div className="mt-1.5 flex items-start gap-1.5 text-[12px] text-gray-600">
                      <span>Your note when freezing: &ldquo;{entity.reopen_trigger}&rdquo;</span>
                      <button onClick={() => setReopenTriggerDraft(entity.reopen_trigger ?? '')} title="Edit your note"
                        className="shrink-0 text-[11px] text-gray-300 hover:text-[#0f5132]">
                        ✎
                      </button>
                    </div>
                  ) : needsReopenTrigger(entity) ? (
                    <button onClick={() => setReopenTriggerDraft('')}
                      className="mt-1.5 text-[11px] font-semibold text-[#0f5132] hover:underline">
                      + Set reopen trigger
                    </button>
                  ) : null
                ) : (
                  <div className="mt-1.5 space-y-1.5">
                    <textarea value={reopenTriggerDraft} onChange={(e) => setReopenTriggerDraft(e.target.value)} rows={2} autoFocus
                      placeholder="What would have to change for a re-approach to be legitimate?"
                      className="w-full rounded border border-[#cdeadb] bg-white p-2 text-xs text-gray-900" />
                    {reopenTriggerDraft.trim().length > 0 && reopenTriggerDraft.trim().length < REOPEN_TRIGGER_MIN_LENGTH && (
                      <p className="text-[11px] text-amber-700">A few more words help — this reads as cut off.</p>
                    )}
                    <div className="flex gap-1.5">
                      <button
                        disabled={reopenTriggerDraft.trim().length < REOPEN_TRIGGER_MIN_LENGTH}
                        onClick={() => { updateEntity(entity.id, { reopen_trigger: reopenTriggerDraft.trim() }); setReopenTriggerDraft(null); }}
                        className="rounded-full bg-[#0f5132] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
                        Save
                      </button>
                      <button onClick={() => setReopenTriggerDraft(null)}
                        className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-600">
                        Cancel
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* Prompt 240 — no lugar do Tip, quando a relação fechou com um
              pass: a razão VERBATIM e a categoria. É o dado com mais valor
              que sobra de um "não" — dez destes reescrevem o pitch — e até
              aqui só aparecia como uma linha pequena dentro do drawer.
              Fechada por outro motivo (parked sem pass), não aparece nada:
              não se inventa texto. */}
          {parkedOrClosed && lastPassReason && (
            <div className="rounded-2xl border border-[#f0d5d5] bg-[#FCF4F4] px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.03em] text-[#7a1f1f]">
                Pass reason
                {lastPassInteraction?.pass_reason_category && (
                  <span className="font-normal normal-case tracking-normal text-gray-500">
                    · {lastPassInteraction.pass_reason_category.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-[13px] italic leading-relaxed text-gray-800">&ldquo;{lastPassReason}&rdquo;</div>
              {lastPassInteraction && (
                <div className="mt-2 text-[11px] text-gray-500">
                  Recorded {lastPassInteraction.occurred_at.slice(0, 10)}, from the classified reply.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Prompt 241 — a coluna direita passa a ser preenchida pelo
            PRÓPRIO RecentInteractions, em vez de uma segunda lista só de
            leitura. O 240 deixou os dois a mostrar as mesmas linhas, um a
            seguir ao outro, porque o merge do 238 tinha tornado o conteúdo
            idêntico — e a razão original para haver duas (o badge "N to
            classify" cá em cima a apontar para a lista de baixo) deixou de
            existir quando esta passou a desenhar a lista inteira.
            Via escolhida: manter o LAYOUT do 240 (a coluna, o tamanho, a
            posição) e trazer para aqui o componente que já tem a
            classificação inline e os saltos — em vez de mover essa máquina
            toda (InlineClassify, nonces, refs, expanded) para dentro deste
            ficheiro, que a duplicaria e deixaria o RecentInteractions
            morto. É composição, não migração de código. */}
        <div className="min-w-[320px] flex-[1.3]">
          {historySlot}
        </div>

      </div>
    </div>
  );
}
