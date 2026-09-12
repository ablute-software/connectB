// Prompt 604 §C — the commitments, as data, in the marketing voice Nuno
// asked for. Prompt 603 delivered these in a more "legal" register; Prompt
// 604 replaced every body with this literal text — "Não reescrever, não
// encurtar, não reordenar" — because the page is advertising ("é apenas
// publicidade disfarçada, tipo 'nós damos, esta é a nossa forma de
// funcionar para tua segurança e conforto'"), not the contract. The Terms
// are the contract, already accepted at signup.
//
// NINE, contiguously numbered 1-9. Prompt 608 had kept a deliberate gap at 6
// (…5, 7…) so a REMOVED entry (the AI-training promise) couldn't silently
// shift a later commitment's identity for someone who had ACCEPTED A
// VERSIONED RECORD naming it. Prompt 604 §A removed that record entirely —
// registration is now a plain "seen" mark on the account (see
// lib/commitments.ts), not a per-commitment, per-version acceptance — so the
// thing the gap was protecting no longer exists, and 604's own literal text
// numbers 1-9 with no gap. Renumbered here for that reason, not by oversight.
export interface Commitment {
  n: number;
  title: string;
  body: string;
  /** In-app destination, so a commitment that names a feature reaches it. */
  link?: { href: string; label: string };
  /**
   * Prompt 606 — which of the page's three sections this belongs to.
   * Structural only, in the DATA rather than sliced by index in the page —
   * that survives any future edit to the list, not only the one that
   * motivated it.
   */
  group: CommitmentGroup;
}

export type CommitmentGroup = 'who_sees' | 'how_we_handle' | 'you_control';

/** Section headings, in render order — verbatim from Prompt 604 §C. */
export const COMMITMENT_GROUPS: { key: CommitmentGroup; label: string }[] = [
  { key: 'who_sees', label: 'Who can see it' },
  { key: 'how_we_handle', label: 'How we handle it' },
  { key: 'you_control', label: 'You stay in control' },
];

/**
 * The controller named in the Terms. Prompt 624 §B — this used to be its own
 * literal here, which is how the same fact came to be written in three places
 * and findable in none. Re-exported rather than removed so this file's own
 * consumers (this page, /legal/subprocessors) don't need to change import
 * paths; the value now has exactly one definition.
 */
export { CONTROLLER_LEGAL_NAME as CONTROLLER_NAME } from '../../lib/controller';

export const COMMITMENTS_V1: Commitment[] = [
  {
    group: 'who_sees',
    n: 1, title: 'Your documents are yours.',
    body: "We don't share a document, or anything about your company, unless you choose to. The only thing that ever overrides that is a court order we're legally bound to obey — and if we're allowed to tell you, we will.",
  },
  {
    group: 'who_sees',
    n: 2, title: 'You decide who sees what.',
    body: 'Access is something you give, one person at a time, and take back whenever you want. Change it and it applies at once — no request, no waiting on us.',
    link: { href: '/documents', label: 'Manage access in the Vault' },
  },
  {
    group: 'who_sees',
    n: 3, title: 'You see every time a document is opened.',
    body: 'Who opened it, and when. It sits in your workspace, for you to look at whenever you feel like it.',
    link: { href: '/documents/access-log', label: 'Open the access log' },
  },
  {
    group: 'how_we_handle',
    // Prompt 604 §C's literal text for this one promises "where you can see
    // it too" for OUR TEAM's own access to a workspace. That was true when
    // 604 was written: /documents/access-log showed a "Sherlock team
    // access" section built from viewer_enter/viewer_exit. Prompt 886/877
    // (2026-09-10, Nuno's decision, repeated from 877) reversed it: an
    // authorised admin opening a customer's workspace is logged INTERNALLY
    // and is deliberately NOT disclosed to the customer, and that section
    // was removed from this same page. The literal text is kept here
    // unedited, per 604's own "não reescrever" — but the link that used to
    // back up "where you can see it too" is deliberately omitted rather than
    // pointed at a page that no longer shows what the sentence promises. The
    // sentence itself now needs a decision: soften it, or restore some form
    // of visibility. Flagged in NEXT_STEPS.md; not resolved here.
    n: 4, title: "We don't read your documents out of curiosity.",
    body: "Our team reaches your workspace only to fix something or to answer you, and when that happens it's recorded with the reason and the time, where you can see it too.",
  },
  {
    group: 'how_we_handle',
    n: 5, title: 'The engine works for you.',
    body: "It reads your documents to build your summaries and your data room, inside your workspace, for your use. That's the only reason it ever opens them.",
  },
  {
    group: 'how_we_handle',
    n: 6, title: 'Our suppliers work for us, not on your data.',
    body: 'Running this takes hosting, email, payments and AI processing. Those suppliers handle your data only to keep the service running, never for their own ends, and we tell you before that list changes.',
    link: { href: '/legal/subprocessors', label: 'The current list of suppliers' },
  },
  {
    group: 'you_control',
    n: 7, title: 'If anything ever goes wrong, you hear it from us.',
    body: "Your data is encrypted on the way in and where it rests, and access is kept narrow. In the unlikely event something were breached, you'd hear it from us quickly and directly.",
  },
  {
    group: 'you_control',
    n: 8, title: 'Leaving is as easy as arriving.',
    body: "Export what's yours, correct what's wrong, or close the account — all from inside the app. Before you confirm, we tell you plainly what stays behind and for how long.",
    link: { href: '/privacy-request', label: 'Make a data-rights request' },
  },
  {
    group: 'you_control',
    n: 9, title: 'We learn from patterns, never from your content.',
    body: 'What we study is how the product gets used, and what we publish about the market is aggregate. Your documents, your name and your numbers stay out of both.',
  },
];
