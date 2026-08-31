import 'server-only';
// Prompt 498 — a metade que fala com a base de dados do tick de regras
// (`src/lib/rules.ts`) do lado do servidor: o TODO que estava em
// /api/automations/route.ts desde o início. A decisão toda vive em
// automation-rules-tick.ts (puro, testado); aqui só se carrega o que essa
// decisão precisa e se escreve o que ela devolve.
//
// Forma copiada de runInterestReminderSweep (o sweep diário mais próximo
// deste problema — "corre todos os dias, nunca duplica") e do
// reconciliationSweep do mesmo route: loop por org real, tolerante a erro por
// org (regista e continua, nunca aborta o tick inteiro).
//
// SOBRE O "MODO DE AUTOMAÇÃO" (draft-review vs full-auto), que o prompt manda
// medir antes de construir: a coluna EXISTE e é real — `automations.mode`,
// enum `automation_mode` ('draft_review','full_auto'), desde a migração 0001,
// com valores reais em produção (verificado 31/08/2026: a org ablute_ tem 3
// automações em draft_review e 5 em full_auto). O que NÃO existe é uma coluna
// por ORG: o modo é por automação. Nada de novo foi inventado aqui — nem
// schema, nem UI.
//
// E este sweep não lê `mode` de propósito. O motor demo lê-o para decidir se
// um run nasce 'pending_review' ou já 'approved' (isto é, pronto a despachar).
// Aqui o output é uma TAREFA: uma linha que o founder tem de abrir e agir,
// que nenhum executor sabe enviar. Ou seja, este sweep é draft-review por
// CONSTRUÇÃO, não por uma verificação de modo que um dia alguém possa
// esquecer-se de fazer — e continua draft-review mesmo que o founder ponha a
// automação em full_auto. É a leitura mais segura por omissão, e é a que
// mantém verdadeira a regra antiga do NEXT_STEPS.md: nunca despachar
// automaticamente, LinkedIn draft-only, sempre.
// O QUE ESTE SWEEP NÃO FAZ, e porquê: o motor demo tem um terceiro ramo,
// `hook_missing` -> uma tarefa de "investigar hook" por cada pessoa com
// hook_status = 'to_research'. Fica de fora, e não por esquecimento — o
// critério do prompt nomeia `outboundsAwaitingFollowUp` e `passReasonAlert`, e
// a medição diz porque é que isso está certo: a org ablute_ tem 1745 pessoas
// em 'to_research' e JÁ tem 965 tarefas de research abertas de uma passagem
// anterior do tick client-side. Portar esse ramo para o cron acrescentaria
// ~780 tarefas por cima de uma parede que já existe. Isso é o oposto da regra
// de ouro do Sherlock ("o produto reduz peso, nunca o acrescenta") e o
// problema a resolver ali é a parede de 965, não a falta de servidor.
import type { SupabaseClient } from '@supabase/supabase-js';
import { planAutomationRulesTick, type OpenTaskSlice, type RulesDbSlice } from './automation-rules-tick';

export interface AutomationRulesSweepResult {
  orgsChecked: number;
  orgsWithRulesEnabled: number;
  tasksCreated: number;
  /** Orgs onde `passReasonAlert` dispara hoje. Ver a nota sobre alertas abaixo. */
  passPatternOrgs: number;
  errors: number;
}

const PAGE = 1000;

// Paginação explícita. O PostgREST pode ter um tecto de linhas por resposta
// (`db-max-rows`); não consegui confirmar da consola qual o valor efectivo
// deste projecto — não está na configuração dos roles — e é exactamente por
// isso que aqui não se assume nenhum. Estas três tabelas crescem sem limite
// (a org ablute_ já tem 1773 pessoas e 518 interacções), e uma amostra
// truncada em silêncio seria pior do que um erro: `outboundsAwaitingFollowUp`
// concluiria "ninguém respondeu" sobre respostas que existem, e o sweep
// pediria follow-ups a quem já respondeu. Paginar custa nada e tira a
// pergunta do caminho, hoje e se o tecto mudar amanhã.
async function fetchAll<T>(admin: SupabaseClient, table: string, columns: string, orgId: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(columns)
      .eq('org_id', orgId).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as unknown as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function runAutomationRulesSweep(admin: SupabaseClient, now: Date): Promise<AutomationRulesSweepResult> {
  const result: AutomationRulesSweepResult = {
    orgsChecked: 0, orgsWithRulesEnabled: 0, tasksCreated: 0, passPatternOrgs: 0, errors: 0,
  };

  const { data: orgRows, error: orgErr } = await admin.from('orgs').select('id, weekly_cap, is_test');
  if (orgErr) throw new Error(`orgs: ${orgErr.message}`);
  const orgs = ((orgRows ?? []) as { id: string; weekly_cap: number | null; is_test: boolean | null }[])
    .filter((o) => !o.is_test);
  result.orgsChecked = orgs.length;

  for (const org of orgs) {
    try {
      // As duas automações que ESTE sweep implementa. Uma org sem linha para
      // elas conta como desligada e é saltada sem uma única query de dados —
      // mesma leitura que runInterestReminderSweep faz do seu próprio
      // trigger. (Medido em 31/08/2026: só a org ablute_ tem linhas em
      // `automations`; provision-org não semeia nenhuma. Consequência real e
      // deliberadamente NÃO corrigida aqui — semear automações a orgs que
      // nunca viram o painel seria opt-in sem consentimento, e o painel
      // renderiza `db.automations` directamente, portanto a lacuna é
      // visível a quem a for corrigir.)
      const { data: autos, error: autoErr } = await admin.from('automations')
        .select('trigger, enabled').eq('org_id', org.id).eq('enabled', true)
        .in('trigger', ['no_reply_14d', 'followup_no_reply_14d']);
      if (autoErr) throw new Error(`automations: ${autoErr.message}`);
      const triggers = new Set(((autos ?? []) as { trigger: string }[]).map((a) => a.trigger));
      const followUpEnabled = triggers.has('no_reply_14d');
      const dormantEnabled = triggers.has('followup_no_reply_14d');
      if (!followUpEnabled && !dormantEnabled) continue;
      result.orgsWithRulesEnabled++;

      const [interactions, people, entities, openTasks] = await Promise.all([
        fetchAll<RulesDbSlice['interactions'][number]>(admin, 'interactions',
          'id, entity_id, person_id, occurred_at, direction, classification, pass_reason_category', org.id),
        fetchAll<RulesDbSlice['people'][number]>(admin, 'people',
          'id, entity_id, full_name, do_not_contact', org.id),
        fetchAll<RulesDbSlice['entities'][number]>(admin, 'entities',
          'id, name, status', org.id),
        (async () => {
          const { data, error } = await admin.from('tasks')
            .select('entity_id, kind, source').eq('org_id', org.id).eq('done', false);
          if (error) throw new Error(`tasks: ${error.message}`);
          return (data ?? []) as unknown as OpenTaskSlice[];
        })(),
      ]);

      const plan = planAutomationRulesTick({
        db: { interactions, people, entities },
        openTasks,
        followUpEnabled,
        dormantEnabled,
        // O tecto por corrida vem do número que a própria org já escolheu:
        // nunca mais tarefas de outreach numa corrida do que os outbounds
        // que as suas próprias regras de volume permitem numa semana
        // (`orgs.weekly_cap`, o mesmo valor que preflight usa). Pedir a um
        // founder 40 follow-ups quando o produto o proíbe de fazer mais de
        // 20 por semana seria pedir trabalho impossível — e a regra de ouro
        // do Sherlock diz que o produto reduz peso, nunca o acrescenta. O
        // que fica de fora não se perde: o sweep é sem estado e volta a
        // derivar tudo amanhã.
        maxPerTick: org.weekly_cap ?? 20,
        now,
      });

      if (plan.passPattern) {
        result.passPatternOrgs++;
        // `passReasonAlert` é avaliado aqui, sobre os mesmos dados, mas NÃO
        // gera tarefa: já é visível ao founder em duas superfícies vivas
        // (o banner de OverviewPanel.tsx e o passo 11 da escada de
        // sherlock-next.ts), ambas recalculadas da mesma função pura a cada
        // render. Uma terceira cópia guardada em `tasks` seria exactamente o
        // que sherlock-next.ts recusa por escrito ("never a second copy of
        // it") — e, pior, seria a única das três que pode ficar
        // desactualizada: um alerta derivado ao vivo desaparece no instante
        // em que o padrão deixa de existir, um alerta guardado fica lá.
        // Fica registado para quem opera a plataforma ver o padrão a
        // disparar sem abrir o workspace de ninguém.
        console.log(`[automations] regras: padrão de passes na org=${org.id} — categoria "${plan.passPattern.category}" em ${plan.passPattern.count} entidades`);
      }

      // Linha a linha, não um insert em lote: um lote é UMA instrução, por
      // isso um único conflito com o índice de 0286 abortaria também as
      // tarefas legítimas da mesma corrida. O volume é o tecto acima (≤
      // weekly_cap por org e por dia), portanto o custo de N inserts é
      // irrelevante ao pé de perder a corrida inteira por causa de uma.
      let created = 0;
      for (const task of plan.tasks) {
        const { error: insErr } = await admin.from('tasks').insert({ ...task, org_id: org.id, done: false });
        // 23505 = o índice único parcial de 0286 apanhou uma corrida (duas
        // execuções sobrepostas do cron). Não é falha: significa que a outra
        // corrida já criou esta tarefa, que é exactamente o resultado
        // desejado — não contar, não repetir, seguir.
        if (insErr && insErr.code === '23505') continue;
        if (insErr) throw new Error(`tasks insert: ${insErr.message}`);
        created++;
        result.tasksCreated++;
      }

      // `created` e não `plan.tasks.length`: as duas divergem quando o índice
      // de 0286 apanha uma corrida sobreposta, e o log tem de dizer o que
      // ficou mesmo na base de dados.
      console.log(`[automations] regras org=${org.id}: ${plan.considered} pendentes, ${created} tarefas criadas (saltadas: ${JSON.stringify(plan.skipped)})`);
    } catch (e) {
      result.errors++;
      console.error(`[automations] tick de regras falhou para org=${org.id}:`, (e as Error).message);
    }
  }

  return result;
}
