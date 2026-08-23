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
  // Prompt 333 — an optional multi-step carousel for a single registry
  // entry (currently only `welcome`). This is NOT a new registry item: the
  // lifetime modal budget and `seen`/session gating below still apply to
  // the whole entry, once, regardless of how many steps it has. Any item
  // without `steps` keeps rendering as the single title/body card it
  // always has (see `waves`, and `title`/`body`/`primaryCta` above, kept
  // for that backward compatibility even though `welcome` no longer reads
  // them directly).
  steps?: { title: string; body: string }[];
}

// Lifetime modal budget (§2): max 3 modals ever exist in this registry —
// enforced by the assertion in engine.test.ts, not just this comment.
export const ONBOARDING_CONTENT: OnboardingItem[] = [
  {
    // Prompt 86 §4 — rewritten copy, Version C (chosen by Nuno, 01/08).
    // Not dispensable by outside click or Escape — see WelcomeModal.tsx.
    key: 'welcome', type: 'modal', order: 1,
    title: 'Welcome — let’s get you in front of the right investors',
    body: 'We built Sherlock Deal because founders were wasting months on lists that ignored their sector and their stage. To do better than that, we need to know your company. Start with your profile — everything else in the platform gets better once it’s filled in.',
    primaryCta: 'Tell us about my company', secondaryCta: 'Explore first',
    // Prompt 333 — 4-step carousel, one step per sidebar group. Exact copy
    // as given; WelcomeModal.tsx renders these instead of title/body/
    // primaryCta above once `steps` is present.
    steps: [
      {
        title: 'Start with your company',
        body: 'About [Company] is where you build your company’s profile — the more complete it is, the better we can match you with the right investors. In the Vault Data Room you can securely add documents: only you have access, and you control exactly which investors can see what.',
      },
      {
        title: 'Investors start appearing in your Pipeline',
        body: 'Once your profile is filled in, investors matching your profile start showing up in Pipeline — each dossier includes tips on how to reach out. Track what needs doing in Tasks and see it all on your Agenda. The more information you give us about your company, the more focused the investors we put in your pipeline — and the more precise Sherlock’s guidance becomes at every step.',
      },
      {
        title: 'My Network & Messages',
        body: 'Manage communication with other founders and investors here — including asking other founders for a referral to introduce you to an investor, and more.',
      },
      {
        title: 'Dashboard & Readiness and Train',
        body: 'Dashboard tracks your progress over time. Readiness & Train analyses your startup and gives you concrete suggestions to get in line with what investors are looking for.',
      },
    ],
  },
  {
    // Corrected per prompt 34/35 (auditoria A1): wave/fit are hardcoded
    // constants today, not a real ranking — the old copy ("por ordem de
    // alinhamento") claimed a matching engine that doesn't exist yet. This
    // is an honesty fix, independent of the rest of onboarding v2.
    key: 'waves', type: 'coachmark', order: 2,
    title: 'What these numbers mean, for now',
    body: 'These numbers show the volume of investors per stage — ranking by fit is coming in a future update.',
    primaryCta: 'Got it',
  },
];

export function onboardingItem(key: string): OnboardingItem | undefined {
  return ONBOARDING_CONTENT.find((i) => i.key === key);
}
