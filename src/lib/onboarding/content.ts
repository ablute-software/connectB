// Onboarding copy registry (onboarding_sherlockdeal_v2.md §7). Every
// onboarding-engine-tracked moment lives here — key, type, order, and
// copy — so rewriting a message never touches engine.ts, and translating
// to another language later means editing this one file, not hunting
// through components.
//
// NOT here: pipeline.empty (§3) is deliberately outside this registry —
// it never persists to onboarding_state, has no dismiss, and is computed
// live every render. See pipeline/page.tsx.
export type OnboardingType = 'modal' | 'coachmark';

export interface OnboardingItem {
  key: string;
  type: OnboardingType;
  /** Lower fires first when more than one item is eligible in the same tick. */
  order: number;
  title: string;
  body: string;
  primaryCta: string;
  secondaryCta?: string;
}

// Lifetime modal budget (§2): max 3 modals ever exist in this registry —
// enforced by the assertion in engine.test.ts, not just this comment.
export const ONBOARDING_CONTENT: OnboardingItem[] = [
  {
    key: 'welcome', type: 'modal', order: 1,
    title: 'Bem-vindo ao Sherlock Deal',
    body: 'Vamos encontrar os investidores certos para a sua startup — não uma lista genérica, mas os que encaixam no seu setor, na sua fase e no seu ticket. Comece por nos contar quem é. É isso que põe o motor a trabalhar.',
    primaryCta: 'Contar sobre a minha empresa', secondaryCta: 'Explorar primeiro',
  },
  {
    // Corrected per prompt 34/35 (auditoria A1): wave/fit are hardcoded
    // constants today, not a real ranking — the old copy ("por ordem de
    // alinhamento") claimed a matching engine that doesn't exist yet. This
    // is an honesty fix, independent of the rest of onboarding v2.
    key: 'waves', type: 'coachmark', order: 2,
    title: 'O que estes números significam, por agora',
    body: 'Estes números indicam o volume de investidores por fase — a ordenação por alinhamento chega numa próxima atualização.',
    primaryCta: 'Percebi',
  },
];

export function onboardingItem(key: string): OnboardingItem | undefined {
  return ONBOARDING_CONTENT.find((i) => i.key === key);
}
