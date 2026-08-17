'use client';
// IRM_SPEC §4b — Relationship summary card. Compact chip for the pipeline row;
// full stage stepper + one-liner + CTAs for the entity page header.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Entity } from '@/lib/types';
import { useStore } from '@/lib/store';
import {
  STAGE_LABEL, STAGE_ORDER, relationshipSummary, nextBestAction, stageExits, type WhoseTurn, type Health, type DealMessageTouch,
} from '@/lib/relationship';
import { LOCK_DAYS } from '@/lib/rules';
import { planPark, planPass, planSnooze, advanceConfirmation, type ExitPlan } from '@/lib/exit-effects';

// Prompt 226 §4 — opções fixas. Sem "custom": um date-picker aqui era mais
// caixilharia do que valor, e estas quatro cobrem o que o founder diz em voz
// alta ("daqui a uma semana", "depois do verão").
const SNOOZE_OPTIONS = [
  { days: 3, label: '3 days' }, { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' }, { days: 30, label: '1 month' },
] as const;
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
export function RelationshipSummaryCard({ entity, onOpenThread, onClassifyRequest, onViewInHistory, onShowAllHistory, dealMessageTouches = [] }: {
  entity: Entity; onOpenThread?: () => void;
  // Prompt 226 §2 — "Show all N" no cartao de historico. Mesmo padrao das
  // outras: o cartao pede, a pagina liga ao RecentInteractions (que e quem
  // tem o estado `expanded`). Reaproveitar a accao, nao reimplementa-la.
  onShowAllHistory?: () => void;
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
  const { db, setRelationshipStage, undoStageChange, setEntityStatus, addTask, toggleTask, updateTask } = useStore();
  const [exitMode, setExitMode] = useState<'none' | 'pass'>('none');
  const [passReason, setPassReason] = useState('');
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
  // Prompt 225 §3 — o estágio anterior REAL, para o "Move back". Índice > 1
  // e não > 0 de propósito: 'contacted' é o primeiro estágio com histórico,
  // e voltar dali seria voltar a 'not_contacted' — apagar o facto de já se
  // ter contactado, que não é o que "corrigir um avanço por engano" quer
  // dizer. Em 'contacted' o item simplesmente não aparece.
  const stageIndex = STAGE_ORDER.indexOf(s.stage);
  const previousStage = stageIndex > 1 ? STAGE_ORDER[stageIndex - 1] : null;
  // Prompt 226 §2 — o conteúdo do cartão de histórico. Mesma leitura que o
  // RecentInteractions faz (mais recentes primeiro), só sem os controlos.
  const entityInteractions = db.interactions.filter((i) => i.entity_id === entity.id);
  const historyTotal = entityInteractions.length;
  const recentThree = [...entityInteractions]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 3);
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
  const lastPassReason = db.interactions
    .filter((i) => i.entity_id === entity.id && i.direction === 'in' && i.classification === 'pass')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1)?.pass_reason;
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
      <div className="overflow-x-auto">
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

      {/* Prompt 225 §1 — a frase de datas/touches migrou para o cartao da
          coluna direita; HealthDot/WhoseTurnChip ficam onde sempre estiveram. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <HealthDot entityId={entity.id} dealMessageTouches={dealMessageTouches} />
        {!parkedOrClosed && <WhoseTurnChip entityId={entity.id} dealMessageTouches={dealMessageTouches} />}
      </div>
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
      {/* Prompt 227 §4 — o aviso do "Next:" e o texto das saidas eram dois
          blocos empilhados, um deles um bloco teal pesado, a dizer coisas da
          MESMA conversa. Passam a uma linha compacta e neutra: texto a
          esquerda (as duas frases juntas por "·"), accoes a direita.
          O fundo deixa de ser colorido; a distincao de gravidade fica no
          TEXTO (vermelho num pass, ambar num overdue), que e sinal
          suficiente sem um bloco de cor a competir com o resto do cartao. */}
      {(action || (!confirmation && !dismissed && exits.show)) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6eef0] bg-[#fafcfc] px-3.5 py-2.5">
          <div className="min-w-[200px] flex-1 text-xs leading-relaxed text-gray-700">
            {action && <span>{annotateNextStep(action)}</span>}
            {action && !confirmation && !dismissed && exits.show && <span className="mx-1.5 text-gray-300">·</span>}
            {!confirmation && !dismissed && exits.show && (
              <span className={
                lastInboundWasPass ? 'font-semibold text-[#B00000]'
                  : s.whoseTurn === 'overdue' ? 'font-semibold text-amber-800'
                  : 'font-semibold text-[#0c637b]'}>
                {lastInboundWasPass
                  ? `They passed — this still shows as ${STAGE_LABEL[s.stage]}.`
                  : s.whoseTurn === 'overdue'
                    // Nunca responderam: dizer "They've replied" aqui seria mentira,
                    // e é o caso em que o founder mais precisa de uma saída.
                    ? `No reply in ${s.daysSinceLastTouch ?? 0} days — this still shows as ${STAGE_LABEL[s.stage]}.`
                    : `They've replied — this still shows as ${STAGE_LABEL[s.stage]}.`}
              </span>
            )}
          </div>
          {!confirmation && !dismissed && exits.show && (
          <>

          {/* Prompt 225 §3 (opção A do mockup) — as quatro saídas em fila
              quebravam linha e davam todas o mesmo peso visual. Agora: a
              acção principal fica sozinha, o resto entra num menu. As
              acções e os seus efeitos são exactamente os mesmos — só a
              apresentação muda. */}
          {exitMode === 'none' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Saída 1 — avançar. Escondida num pass: oferecer "avançar" a
                  quem disse que não é exactamente o bug do caso Adara. */}
              {exits.canAdvance && (
                <button onClick={() => { changeStage(nextStage, STAGE_LABEL[nextStage]); setConfirmation(advanceConfirmation(STAGE_LABEL[nextStage])); }}
                  className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#0c637b]">
                  Move to {STAGE_LABEL[nextStage]}
                </button>
              )}
              {/* Prompt 226 §4 — Snooze. "Nao agora" nao e "desisti": a
                  entidade fica ACTIVA e so as tarefas pendentes mudam de
                  data (planSnooze, irmao do planPark sem o
                  setEntityStatus). E a saida que faltava para o caso mais
                  comum de todos — o founder sabe que tem de responder, mas
                  nao esta semana. */}
              <div className="relative" ref={snoozeRef}>
                <button onClick={() => { setSnoozeOpen((o) => !o); setMenuOpen(false); }}
                  aria-haspopup="menu" aria-expanded={snoozeOpen}
                  className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                  Snooze ▾
                </button>
                {snoozeOpen && (
                  <div role="menu"
                    className="absolute left-0 top-[calc(100%+6px)] z-10 min-w-[150px] rounded-[10px] border border-gray-200 bg-white p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,.18)]">
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
              <div className="relative" ref={menuRef}>
                <button onClick={() => { setMenuOpen((o) => !o); setSnoozeOpen(false); }}
                  aria-haspopup="menu" aria-expanded={menuOpen}
                  className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-500 hover:bg-gray-50">
                  Something else ▾
                </button>
                {menuOpen && (
                  <div role="menu"
                    className="absolute left-0 top-[calc(100%+6px)] z-10 min-w-[230px] rounded-[10px] border border-gray-200 bg-white p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,.18)]">
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
                    {/* Prompt 214 §C.3 — ha sempre a saida de nao fazer nada.
                        Uma sugestao sem "dispensar" nao e sugestao, e
                        insistencia. */}
                    <button role="menuitem" onClick={() => { setMenuOpen(false); setDismissed(true); }}
                      className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-gray-800 hover:bg-gray-100">
                      Dismiss — keep as is
                    </button>
                    {/* Saída 2 — o "não". Pede a razão, que é obrigatória. */}
                    <button role="menuitem" onClick={() => { setMenuOpen(false); setExitMode('pass'); }}
                      className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-[#B00000] hover:bg-gray-100">
                      No interest / over — marks as passed
                    </button>
                    {/* Saída 3 — parquear. Em 'contacted' lê-se "cold", que é
                        o que de facto aconteceu: nunca responderam. */}
                    <button role="menuitem" onClick={() => {
                        setMenuOpen(false);
                        setEntityStatus(entity.id, 'dormant', exits.parkLabel === 'cold' ? 'Cold — no reply' : 'Parked — no continuity');
                        applyPlan(planPark(entity, db.tasks, new Date()));
                      }}
                      className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-gray-800 hover:bg-gray-100">
                      {exits.parkLabel === 'cold' ? 'Cold / no reply' : 'Frozen / no continuity'} — parks this investor
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* O textarea da razão do pass ocupa a linha toda (w-full a forçar
              a quebra do flex): é escrita, não um botão. */}
          {exitMode === 'pass' && (
            <div className="w-full space-y-1.5">
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
          </>
          )}
        </div>
      )}

      {/* Prompt 226 §2 — os dois cartoes, agora numa linha propria abaixo do
          banner e da MESMA largura (o 70% do 225 e que fazia o de historico
          ler-se como cortado). "Log interaction" saiu daqui de vez: existe
          sempre no topo da pagina, e repeti-lo era redundante (§4). */}
      {/* Prompt 227 §2 — `flex-1` + `basis-[260px]` + `min-w-[240px]` nos
          dois: dividem o espaco a meio, encolhem juntos, e empilham quando
          nem 240px cabem (o flex-wrap trata disso, sem breakpoint a mao). */}
      <div className="mt-4 flex flex-wrap gap-3.5">
        <div className="min-w-[240px] flex-1 basis-[260px] rounded-2xl border border-[#e6eef0] bg-[linear-gradient(155deg,#ffffff,#f3fafb_70%)] px-4 py-3 shadow-[0_1px_1px_rgba(15,60,70,.04),0_6px_14px_-6px_rgba(15,60,70,.14),inset_0_1px_0_rgba(255,255,255,.6)]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              Contact history
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">{historyTotal}</span>
              {ds.unclassifiedReplies > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                  {ds.unclassifiedReplies} to classify
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              {/* Mesmas acções do cabeçalho do RecentInteractions —
                  reaproveitadas por callback, não reimplementadas aqui. */}
              {onShowAllHistory && historyTotal > 3 && (
                <button onClick={onShowAllHistory} className="text-[11px] font-semibold text-[#0E7490] hover:underline">
                  Show all {historyTotal}
                </button>
              )}
              {onOpenThread && (
                <button onClick={onOpenThread} className="text-[11px] font-medium text-[#0E7490] hover:underline">
                  Thread view
                </button>
              )}
            </span>
          </div>
          {/* As 3 mais recentes, compactas: data · direcção · uma linha. Sem
              controlos de classificação — esses vivem só na secção completa
              abaixo, para não haver dois sítios a fazer a mesma coisa. */}
          <ul className="mt-2 space-y-1">
            {recentThree.length === 0 ? (
              <li className="text-xs text-gray-400">No contact logged yet.</li>
            ) : recentThree.map((i) => (
              <li key={i.id} className="flex gap-2 truncate border-t border-dashed border-gray-100 pt-1 text-[11.5px] text-gray-500 first:border-0 first:pt-0">
                <span className="shrink-0 tabular-nums">{i.occurred_at.slice(0, 10)}</span>
                <span className={`shrink-0 font-semibold ${i.direction === 'in' ? 'text-[#0E7490]' : 'text-gray-600'}`}>
                  {i.direction === 'in' ? 'Received' : 'Sent'}
                </span>
                <span className="truncate text-gray-600">{i.content}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* §2 — o numero deixa de ser um text-2xl gigante e passa a inline
            com a palavra; "Last touch" e o "Nd ago" separam-se em duas
            linhas, que era o que quebrava feio a meio da palavra. */}
        <div className="min-w-[240px] flex-1 basis-[260px] rounded-2xl border border-[#e6eef0] bg-[linear-gradient(155deg,#ffffff,#f3fafb_70%)] px-4 py-3 shadow-[0_1px_1px_rgba(15,60,70,.04),0_6px_14px_-6px_rgba(15,60,70,.14),inset_0_1px_0_rgba(255,255,255,.6)]">
          <div className="text-xs text-gray-500">
            {s.firstContactAt ? `First contact ${s.firstContactAt.slice(0, 10)}` : 'No contact yet'}
          </div>
          <div className="mt-0.5 text-sm font-bold text-[#0E7490]">
            {s.touchCount} {s.touchCount === 1 ? 'touch' : 'touches'}
          </div>
          {s.lastTouchAt && s.lastTouchAt !== s.firstContactAt && (
            <>
              <div className="mt-0.5 text-xs text-gray-500">Last touch {s.lastTouchAt.slice(0, 10)}</div>
              {s.daysSinceLastTouch != null && (
                <div className="text-xs font-semibold text-[#0E7490]">· {s.daysSinceLastTouch}d ago</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
