// Prompt 603 §B — the commitments, as data, so the page, the acceptance
// version and the links live together. Same discipline as terms.ts: a
// material change to this text is a NEW version (a new file and a bump of
// COMMITMENTS_VERSION in lib/commitments.ts), never a silent edit — the
// version accepted by each person must stay resolvable.
//
// NOT LEGAL ADVICE, and not yet reviewed by a lawyer: the interstitial that
// shows this is behind COMMITMENTS_GATE_ENABLED (lib/commitments.ts) until
// the review and the open answers in §C of the prompt.
//
// NINE, not ten. Prompt 604 §A asked for the AI-training promise to leave the
// STRUCTURE ("sai da estrutura, não fica como espaço vazio à espera de ser
// reactivado sem se verificar o contrato"), and Nuno was literal: "entre as
// claims retira a nº 6 totalmente." Prompt 603 had instead left it dormant
// behind an AI_TRAINING_LINE_CONFIRMED flag, which is precisely the waiting
// blank that sentence forbade — and the flag's own name was the trap: it read
// as "flip me", when what it actually required was going and reading the AI
// provider's contract. Removed in Prompt 608. If that day comes, the promise
// gets written then, with the contract in hand; it is one line of text, not
// work saved.
//
// The numbering deliberately keeps its gap (…5, 7…). `n` identifies a
// commitment inside a PUBLISHED version that people have accepted by name;
// renumbering would silently turn today's 7 into yesterday's 6.
export interface Commitment {
  n: number;
  title: string;
  body: string;
  /** In-app destination, so a commitment that names a feature reaches it. */
  link?: { href: string; label: string };
  /**
   * Prompt 606 — which of the page's three sections this belongs to.
   *
   * Structural only: no wording changes here, 604's text is closed. The
   * grouping lives in the DATA rather than being sliced by index in the page.
   * The immediate reason was the dormant commitment 6, now gone (608 §D), but
   * the reason that outlives it is the larger one: slicing by index breaks on
   * ANY future edit to the list, not only on that one.
   */
  group: CommitmentGroup;
}

export type CommitmentGroup = 'who_sees' | 'how_we_handle' | 'you_control';

/** Section headings, in render order. */
export const COMMITMENT_GROUPS: { key: CommitmentGroup; label: string }[] = [
  { key: 'who_sees', label: 'Who can see it' },
  { key: 'how_we_handle', label: 'How we handle it' },
  { key: 'you_control', label: 'You stay in control' },
];

/** The controller named in the Terms (v3, Provider clause). §C question 3 — confirm it is the same entity for the Privacy Policy. */
export const CONTROLLER_NAME = 'Exotictarget, Lda';

export const COMMITMENTS_V1: Commitment[] = [
  {
    group: 'who_sees',
    n: 1, title: 'Your documents are yours.',
    body: 'We never share a document or any information about your company with anyone unless you explicitly choose to. The only exception is a binding legal obligation — a court order or a lawful request we cannot refuse. If that ever happens and we are permitted to tell you, we will.',
  },
  {
    group: 'who_sees',
    n: 2, title: 'You decide who sees what.',
    body: 'Access to your documents is granted by you, person by person. You can change it or revoke it at any time, and it takes effect immediately.',
    link: { href: '/documents', label: 'Manage access in the Vault' },
  },
  {
    group: 'who_sees',
    n: 3, title: 'You can see every access.',
    body: 'Every time a document of yours is opened, it is recorded — who, and when. That record is yours to inspect.',
    link: { href: '/documents/access-log', label: 'Open the access log' },
  },
  {
    group: 'how_we_handle',
    n: 4, title: 'Our team does not browse your content.',
    body: 'Access by our staff is restricted to what is needed to run and support the service — resolving a support request, investigating a fault. Every such access is logged with the reason and the duration, and it is visible to you. We do not read your documents out of curiosity, and we never do it to inform anyone else\'s decisions.',
    link: { href: '/documents/access-log#team', label: 'See team access on your workspace' },
  },
  {
    group: 'how_we_handle',
    n: 5, title: 'Automated processing works for you, not on you.',
    body: 'To make the product work, our systems read your documents to produce extractions and summaries for your own workspace. That processing serves you. It is not used to reveal your content to anyone else.',
  },
  {
    group: 'how_we_handle',
    n: 7, title: 'We use a short list of suppliers, and they work under contract.',
    body: 'Running the service requires infrastructure: hosting, email delivery, payments, AI processing. These suppliers process your data only on our instructions, cannot use it for their own purposes, and are bound by data-protection agreements. The current list is published, and we tell you before it changes.',
    link: { href: '/legal/subprocessors', label: 'The current list of suppliers' },
  },
  {
    group: 'you_control',
    n: 8, title: 'We protect your data with appropriate measures — and we tell you if something goes wrong.',
    body: 'No one can promise a system will never be breached. What we can promise: encryption in transit and at rest, access limited to those who need it, and, if a breach affects your data, notification to the supervisory authority within 72 hours and to you without undue delay.',
  },
  {
    group: 'you_control',
    n: 9, title: 'You keep your rights, and we make them usable.',
    body: 'Access, correct, export, restrict, object, or delete — from inside the app, not by writing a letter. Closing your account ends access immediately; what we retain afterwards, and for how long, is stated on that screen before you confirm.',
    link: { href: '/privacy-request', label: 'Make a data-rights request' },
  },
  {
    group: 'you_control',
    n: 10, title: 'Aggregate insight, never your content.',
    body: 'We study how the product is used to improve it, and we publish statistics about the market. Neither ever exposes your documents, your identity, or anything traceable to your company.',
  },
];

export const COMMITMENTS_FOOTNOTE = 'This page summarises how we work. The Privacy Policy and Terms are the documents that govern the relationship — this is the plain-language version, not a replacement.';
