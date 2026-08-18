// Prompt 206-C + 209 — a jornada como ela foi, e os documentos ancorados ao
// passo em que foram partilhados.
//
// Duas funções puras, uma fonte para duas superfícies (o badge 📄 nos chips
// do stepper e o 📎 nas linhas do histórico, que já existe). O render é
// noutro sítio; aqui só se decide o que há para desenhar.
import type { Db, Interaction, RelationshipStage } from './types';
import { STAGE_ORDER, STAGE_LABEL } from './relationship';
import { derivedStage } from './derived-stage';
import { nextPendingTaskDue } from './relationship';

// O stage_change grava o estágio SÓ no texto ("Stage changed to Engaged."),
// nunca numa coluna. Reverter pelo rótulo é o que os dados permitem — e é
// frágil de propósito assumido: se um rótulo mudar, as linhas antigas
// deixam de casar. Por isso quem não casa é ignorado em silêncio e a
// jornada cai no derivado, em vez de inventar um passo errado.
const STAGE_BY_LABEL = new Map<string, RelationshipStage>(
  STAGE_ORDER.map((s) => [STAGE_LABEL[s].toLowerCase(), s]),
);

export function stageChangeAt(i: Interaction): RelationshipStage | undefined {
  if (i.channel !== 'stage_change') return undefined;
  const m = i.content?.match(/stage changed to (.+?)\.?$/i);
  if (!m) return undefined;
  return STAGE_BY_LABEL.get(m[1].trim().toLowerCase());
}

// Prompt 249 §B — interactionId is the anchor for "clique-para-evidência":
// when present, the outcome/parked chip is clickable and opens the history
// at that exact interaction (same onViewInHistory the 📄 doc badge already
// uses — Prompt 209). Absent when nothing in the data identifies one — see
// journeySteps() below for what's actually derivable today and what isn't.
export type JourneyStep =
  | { kind: 'stage'; stage: RelationshipStage; state: 'done' | 'current' | 'future'; at?: string }
  | { kind: 'outcome'; outcome: 'declined' | 'invested'; at?: string; passCategory?: string; interactionId?: string }
  | { kind: 'parked'; revisitAt?: string; interactionId?: string };

// Os passos efectivamente percorridos, por ordem. Base: as stage_change
// gravadas. Sem nenhuma (a maioria das relações antigas, que nunca passaram
// pelo stepper), infere-se do mínimo defensável: houve resposta -> passou
// por contacted e engaged; não houve -> só contacted.
function traversed(db: Db, entityId: string): { stage: RelationshipStage; at?: string }[] {
  const changes = db.interactions
    .filter((i) => i.entity_id === entityId && i.channel === 'stage_change')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  const out: { stage: RelationshipStage; at?: string }[] = [];
  for (const c of changes) {
    const s = stageChangeAt(c);
    if (!s || s === 'decision') continue;
    if (!out.some((x) => x.stage === s)) out.push({ stage: s, at: c.occurred_at });
  }
  if (out.length > 0) return out;

  const replied = db.interactions.some((i) => i.entity_id === entityId && i.direction === 'in');
  const contactedAt = db.interactions
    .filter((i) => i.entity_id === entityId && i.channel !== 'stage_change')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0]?.occurred_at;
  const firstReplyAt = db.interactions
    .filter((i) => i.entity_id === entityId && i.direction === 'in')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0]?.occurred_at;

  return replied
    ? [{ stage: 'contacted', at: contactedAt }, { stage: 'engaged', at: firstReplyAt }]
    : [{ stage: 'contacted', at: contactedAt }];
}

export function journeySteps(db: Db, entityId: string): JourneyStep[] {
  const entity = db.entities.find((e) => e.id === entityId);
  const ds = derivedStage(db, entityId);

  // FECHADO vem ANTES de parqueado, e a ordem e a correccao do 209: um pass
  // classificado e DESFECHO, e desfecho e terminal. A Adara estava dormant de
  // um teste anterior ao pass, e a versao anterior mostrava-lhe "Parked" --
  // o parque era o facto mais ANTIGO. Entre um estado que alguem deixou para
  // tras e o que o investidor disse, ganha o que o investidor disse.
  const closed = ds.mode === 'closed' || ds.derived === 'decision';
  if (closed) {
    const lastPass = db.interactions
      .filter((i) => i.entity_id === entityId && i.direction === 'in' && i.classification === 'pass')
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
    const outcome: 'declined' | 'invested' = entity?.status === 'invested' ? 'invested' : 'declined';
    // Prompt 249 §B — declined anchors to the SAME lastPass interaction
    // already used for `at`/`passCategory` above: it's the actual reply
    // that explains the outcome, real evidence to jump to. A pass reached
    // manually (the "No interest / over" menu, or "Move to Decision" ->
    // Passed — Prompt 249 §A) never gets one: no inbound reply was
    // classified 'pass', so this stays undefined there — no heuristic
    // invented to fill it in.
    //
    // Invested has no equivalent today: `Classification` (types.ts) has no
    // value that represents "they said yes" the way 'pass' represents "they
    // said no" — there is genuinely no interaction to point at without
    // guessing one (e.g. picking the last 'interested' reply would be a
    // fabricated link, not a derived fact). Stays undefined until a real
    // signal exists.
    const interactionId = outcome === 'declined' ? lastPass?.id : undefined;
    return [
      ...traversed(db, entityId).map((t): JourneyStep => ({ kind: 'stage', stage: t.stage, state: 'done', at: t.at })),
      { kind: 'outcome', outcome, at: lastPass?.occurred_at, passCategory: lastPass?.pass_reason_category, interactionId },
    ];
  }

  // PARQUEADO — pausa, nao desfecho. Mostra SO os passos percorridos (com ✓,
  // esmaecidos no render) e o chip da revisita, nunca os seis estagios: uma
  // relacao parada nao tem futuro a mostrar, so tem historia e uma data de
  // regresso. Reutiliza o mesmo traversed() do caso fechado.
  if (ds.mode === 'parked') {
    // Prompt 249 §B — no interactionId here: setEntityStatus('dormant', …)
    // (the "Frozen"/"Cold" menu action) and the propose_dormant automation
    // both write straight to entities.dormant_since/dormant_reason, neither
    // logs an interaction. There is currently no code path that produces
    // one to anchor "the message/record that generated this park" to — the
    // exact "park manual antigo sem registo" case the prompt itself named
    // as expected to stay non-clickable. Left explicit (not just omitted)
    // so this isn't mistaken for an oversight if a future flow adds one.
    return [
      ...traversed(db, entityId).map((t): JourneyStep => ({ kind: 'stage', stage: t.stage, state: 'done', at: t.at })),
      { kind: 'parked', revisitAt: nextPendingTaskDue(db, entityId), interactionId: undefined },
    ];
  }

  // ACTIVO — sem mudança: o stepper de sempre, com o efectivo destacado.
  const idx = STAGE_ORDER.indexOf(ds.effective);
  const at = new Map(traversed(db, entityId).map((t) => [t.stage, t.at]));
  return STAGE_ORDER.map((stage, i): JourneyStep => ({
    kind: 'stage', stage, state: i < idx ? 'done' : i === idx ? 'current' : 'future', at: at.get(stage),
  }));
}

// ---------------------------------------------------------------------------
// Documentos ancorados ao passo da jornada.
//
// O modelo já suporta isto sem schema novo: interactions.document_id diz o
// que foi partilhado e quando, e as stage_change delimitam os intervalos de
// cada estágio. Um documento partilhado ANTES da primeira stage_change
// pertence ao primeiro passo percorrido — não se inventa um estágio que não
// existia ainda.
export interface StageDoc { documentId: string; at: string; interactionId: string }

// Prompt 216 §B — o miolo de docsByStage, extraído genérico: dado um
// conjunto de fronteiras temporais com chave, cada documento cai no
// intervalo em vigor à data em que foi partilhado. docsByStage (founder,
// fronteiras = stage_change) e investorJourneySteps (investidor, fronteiras
// = os passos da relação vista por ele) usam a MESMA função — outra fonte
// de eventos, nunca uma cópia.
export function anchorDocsToBoundaries<K>(
  boundaries: { at: string; key: K }[],
  firstKey: K,
  docs: StageDoc[],
): Map<K, StageDoc[]> {
  const sorted = [...boundaries].sort((a, b) => a.at.localeCompare(b.at));
  const out = new Map<K, StageDoc[]>();
  for (const d of docs) {
    // A fronteira em vigor à data: a última ATÉ esta partilha.
    const key = sorted.filter((b) => b.at <= d.at).at(-1)?.key ?? firstKey;
    const list = out.get(key) ?? [];
    list.push(d);
    out.set(key, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

export function docsByStage(db: Db, entityId: string): Map<RelationshipStage, StageDoc[]> {
  const changes = db.interactions
    .filter((i) => i.entity_id === entityId && i.channel === 'stage_change')
    .map((i) => ({ at: i.occurred_at, stage: stageChangeAt(i) }))
    .filter((c): c is { at: string; stage: RelationshipStage } => !!c.stage)
    .sort((a, b) => a.at.localeCompare(b.at));

  // Um documento partilhado ANTES de qualquer stage_change foi partilhado
  // quando a relação era, por definição, apenas "contacted" — mesmo que a
  // primeira mudança registada mais tarde tenha sido para outro estágio.
  // Herdar o primeiro estágio REGISTADO poria o deck de 2025-11-27 em
  // "Engaged" só porque foi essa a primeira transição que alguém gravou.
  // Sem stage_change nenhuma, cai no primeiro passo inferido.
  const first: RelationshipStage = changes.length > 0
    ? 'contacted'
    : traversed(db, entityId)[0]?.stage ?? 'contacted';

  const docs: StageDoc[] = db.interactions
    .filter((i) => i.entity_id === entityId && i.document_id)
    .map((i) => ({ documentId: i.document_id as string, at: i.occurred_at, interactionId: i.id }));

  return anchorDocsToBoundaries(changes.map((c) => ({ at: c.at, key: c.stage })), first, docs);
}
