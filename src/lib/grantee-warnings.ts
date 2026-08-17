// Prompt 222 §2 (dívida do 217 §D) — os avisos do picker de grantees.
//
// A decisão, do revisor: AVISAR, nunca esconder e nunca bloquear. Uma
// entidade que passou pode ser legitimamente reaberta, e esconder
// silenciosamente é o padrão que temos vindo a eliminar. O que muda aqui é
// só o que o founder VÊ — quem recebe acesso é exactamente o mesmo.
//
// Sobre do_not_contact: o rules.ts trata-o como hard stop "permanente, sem
// override", mas isso é sobre CONTACTAR. Um grant é dar acesso a quem já
// está em diálogo, não abordar a frio — por isso aqui é aviso forte, não
// bloqueio. O que não pode é ser silencioso, que era a inconsistência entre
// as duas superfícies que o 217 apanhou.
import type { EntityStatus } from './types';

export interface StatusChip {
  label: string;
  // 'warn' = amarelo (algo a ponderar), 'muted' = cinzento (informativo).
  tone: 'warn' | 'muted';
}

// Só os estados que valem um chip. Os restantes (not_contacted, contacted,
// in_conversation) são o caso normal e não merecem ruído.
export function entityStatusChip(status: EntityStatus): StatusChip | null {
  if (status === 'passed') return { label: 'passed', tone: 'warn' };
  if (status === 'dormant') return { label: 'dormant', tone: 'muted' };
  if (status === 'invested') return { label: 'invested', tone: 'muted' };
  return null;
}

const MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

// A nota inline ao selecionar uma entidade que passou. Só para 'passed' —
// dormant fica pelo chip, por decisão do revisor (menos grave).
//
// A data degrada de propósito: 3 das 31 entidades 'passed' da ablute_ não
// têm nenhuma interação classificada como pass (medido antes de escrever),
// portanto a frase tem de funcionar sem data em vez de mostrar "Invalid
// Date" ou esconder o aviso todo — o aviso é que importa, a data é um
// extra.
export function passedNote(entityName: string, lastPassAt?: string | null): string | null {
  if (!entityName) return null;
  const when = lastPassAt ? MONTH_YEAR.format(new Date(lastPassAt)) : null;
  return when
    ? `${entityName} passed in ${when} — are you sure?`
    : `${entityName} is marked as passed — are you sure?`;
}

export interface PersonLike { id: string; full_name: string; do_not_contact?: boolean }

export function doNotContactPeople<T extends PersonLike>(people: T[]): T[] {
  return people.filter((p) => p.do_not_contact);
}

// O aviso explícito dentro de "Everyone confirmed at this entity" — o caso
// que o 217 apanhou: conceder a toda a gente resolvia do_not_contact para
// dentro do grant sem o founder nunca ver o nome.
export function everyoneDncWarning(people: PersonLike[]): string | null {
  const flagged = doNotContactPeople(people);
  if (flagged.length === 0) return null;
  const names = flagged.map((p) => p.full_name).join(', ');
  return flagged.length === 1
    ? `${names} is marked do-not-contact. Granting access isn't outreach, but they will get in.`
    : `${names} are marked do-not-contact. Granting access isn't outreach, but they will get in.`;
}
