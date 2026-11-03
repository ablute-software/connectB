// Prompt 935 (02/11/2026) — what the fixed landing is made of, apart from the long copy of the panels (landing-fixed-panels.ts): the two wheels, the headings that rotate, the order of the legal chapters and what
// the contact form's subjects mean. From the approved mockup (v21); the wording is Nuno's, the structure is what the components and the tests read.
export type LandingMode = 'startups' | 'investors';

export type IconName = 'overview' | 'find' | 'fundraise' | 'ai' | 'share' | 'pricing' | 'docs' | 'faq' | 'discover' | 'review' | 'pipeline' | 'mandate';

export interface WheelItem {
  /** The panel it shows (data-id in the card). */
  id: string;
  icon: IconName;
  /** The name of the place: the tab's accessible name and the card's title. */
  label: string;
  /** What fits under the wheel's circle (small caps). */
  short: string;
  /** The line next to the title of the card. */
  kicker: string;
}

export interface ModeDef {
  /** Which place is selected when the page opens (the wheel is a ring: the others turn around it). */
  home: number;
  items: readonly WheelItem[];
}

export const MODES: Record<LandingMode, ModeDef> = {
  startups: {
    home: 3,
    items: [
      { id: 'docs', icon: 'docs', label: 'Documents', short: 'Documents', kicker: 'Terms, privacy, data rights' },
      { id: 's-pricing', icon: 'pricing', label: 'Pricing', short: 'Pricing', kicker: 'Plans that grow up with you' },
      { id: 's-share', icon: 'share', label: 'Share securely', short: 'Share securely', kicker: 'Data room, per investor' },
      { id: 's-overview', icon: 'overview', label: 'Overview', short: 'Overview', kicker: 'Your round, one place' },
      { id: 's-find', icon: 'find', label: 'Find investors', short: 'Find investors', kicker: 'Your suspect list, every next step' },
      { id: 's-ai', icon: 'ai', label: 'AI assistant', short: 'AI assistant', kicker: 'Drafts from confirmed facts' },
      { id: 's-faq', icon: 'faq', label: 'FAQ', short: 'FAQ', kicker: 'Questions founders ask' },
    ],
  },
  investors: {
    home: 4,
    items: [
      { id: 'docs', icon: 'docs', label: 'Documents', short: 'Documents', kicker: 'Terms, privacy, data rights' },
      { id: 'i-faq', icon: 'faq', label: 'FAQ', short: 'FAQ', kicker: 'Questions investors ask' },
      { id: 'i-mandate', icon: 'mandate', label: 'Your mandate', short: 'Your mandate', kicker: 'The criteria behind every match' },
      { id: 'i-pricing', icon: 'pricing', label: 'Access & pricing', short: 'Access', kicker: 'Seats and plans' },
      { id: 'i-overview', icon: 'overview', label: 'Overview', short: 'Overview', kicker: 'Deal flow that fits' },
      { id: 'i-discover', icon: 'discover', label: 'Discover startups', short: 'Discover', kicker: 'Why it fits, before you look' },
      { id: 'i-review', icon: 'review', label: 'Review & decide', short: 'Review', kicker: 'The dossier' },
      { id: 'i-pipeline', icon: 'pipeline', label: 'Your pipeline', short: 'Pipeline', kicker: 'Owners, next actions, decisions' },
    ],
  },
};

/** One heading: the words before the emphasised ones, the emphasised words (amber italics), and what follows them. */
export type HeroLine = readonly [lead: string, em: string, trail?: string];

/** The rotating heading of each mode. The first one is the server-rendered h1 (and the only one shown under reduced motion). */
export const HERO_LINES: Record<LandingMode, readonly HeroLine[]> = {
  startups: [
    ['Crack the case on your ', 'fundraise.'],
    ['The right investors. ', 'Not thousands.'],
    ['Every step, every conversation, every document — ', 'under control.'],
    ['Don’t just find investors who fit your round. Sherlock finds those with ', 'interest in your business.'],
    ['Write from facts you confirmed once. ', 'Keep every conversation moving.'],
  ],
  investors: [
    ['Fewer, better, ', 'investment-ready', ' opportunities.'],
    ['Your thesis, applied. ', 'First contact', ' with startups that fit.'],
    ['The reasons, the founder’s confirmed facts, ', 'before the first call.'],
  ],
};

export const heroLineText = (l: HeroLine): string => l[0] + l[1] + (l[2] ?? '');

/** The header's main call to action, by mode. "Sign in" is the same in both. */
export const CTA: Record<LandingMode, { label: string; href: string }> = {
  startups: { label: 'Create account', href: '/signup' },
  investors: { label: 'Claim your profile', href: '/claim' },
};
export const SIGN_IN = { label: 'Sign in', href: '/login' } as const;

/** The route of each mode: the mode switch is a pair of real links. */
export const MODE_PATH: Record<LandingMode, string> = { startups: '/', investors: '/investors' };

/** The legal chapters of the Documents popup, in the order of the one document. `title` is the chapter's heading. */
export const DOC_ORDER = ['terms', 'privacy', 'suppliers', 'data-rights', 'gdpr', 'ai-act'] as const;
export type DocId = (typeof DOC_ORDER)[number];

export const isDocId = (v: unknown): v is DocId => typeof v === 'string' && (DOC_ORDER as readonly string[]).includes(v);

/** What the contact form's subjects mean to the support intake (/api/support/submit): the visitor sees the subject, the ticket gets the category. */
export const CONTACT_SUBJECTS = [
  { label: 'Question about the product', category: 'question' },
  { label: 'Investor access', category: 'claim_profile' },
  { label: 'Firm or programme plan', category: 'question' },
  { label: 'Press', category: 'other' },
  { label: 'Something else', category: 'other' },
] as const;

/** The message must be at least this long (the intake refuses less). */
export const CONTACT_MIN_MESSAGE = 10;
