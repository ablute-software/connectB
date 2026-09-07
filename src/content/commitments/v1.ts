// Prompt 603 §B — the ten commitments, as data, so the page, the acceptance
// version and the links live together. Same discipline as terms.ts: a
// material change to this text is a NEW version (a new file and a bump of
// COMMITMENTS_VERSION in lib/commitments.ts), never a silent edit — the
// version accepted by each person must stay resolvable.
//
// NOT LEGAL ADVICE, and not yet reviewed by a lawyer: the interstitial that
// shows this is behind COMMITMENTS_GATE_ENABLED (lib/commitments.ts) until
// the review and the three open answers in §C of the prompt. Commitment 6
// (no AI training) is INCLUDED ONLY once confirmed with the AI provider's
// contract — see AI_TRAINING_LINE_CONFIRMED.
export interface Commitment {
  n: number;
  title: string;
  body: string;
  /** In-app destination, so a commitment that names a feature reaches it. */
  link?: { href: string; label: string };
}

/** Flip to true only after the AI provider's terms are checked (§C question 1). */
export const AI_TRAINING_LINE_CONFIRMED = false;

/** The controller named in the Terms (v3, Provider clause). §C question 3 — confirm it is the same entity for the Privacy Policy. */
export const CONTROLLER_NAME = 'Exotictarget, Lda';

const ALL: Commitment[] = [
  {
    n: 1, title: 'Your documents are yours.',
    body: 'We never share a document or any information about your company with anyone unless you explicitly choose to. The only exception is a binding legal obligation — a court order or a lawful request we cannot refuse. If that ever happens and we are permitted to tell you, we will.',
  },
  {
    n: 2, title: 'You decide who sees what.',
    body: 'Access to your documents is granted by you, person by person. You can change it or revoke it at any time, and it takes effect immediately.',
    link: { href: '/documents', label: 'Manage access in the Vault' },
  },
  {
    n: 3, title: 'You can see every access.',
    body: 'Every time a document of yours is opened, it is recorded — who, and when. That record is yours to inspect.',
    link: { href: '/documents/access-log', label: 'Open the access log' },
  },
  {
    n: 4, title: 'Our team does not browse your content.',
    body: 'Access by our staff is restricted to what is needed to run and support the service — resolving a support request, investigating a fault. Every such access is logged with the reason and the duration, and it is visible to you. We do not read your documents out of curiosity, and we never do it to inform anyone else\'s decisions.',
    link: { href: '/documents/access-log#team', label: 'See team access on your workspace' },
  },
  {
    n: 5, title: 'Automated processing works for you, not on you.',
    body: 'To make the product work, our systems read your documents to produce extractions and summaries for your own workspace. That processing serves you. It is not used to reveal your content to anyone else.',
  },
  {
    n: 6, title: 'Your data is not used to train AI models.',
    body: 'Neither ours nor anyone else\'s.',
  },
  {
    n: 7, title: 'We use a short list of suppliers, and they work under contract.',
    body: 'Running the service requires infrastructure: hosting, email delivery, payments, AI processing. These suppliers process your data only on our instructions, cannot use it for their own purposes, and are bound by data-protection agreements. The current list is published, and we tell you before it changes.',
    link: { href: '/legal/subprocessors', label: 'The current list of suppliers' },
  },
  {
    n: 8, title: 'We protect your data with appropriate measures — and we tell you if something goes wrong.',
    body: 'No one can promise a system will never be breached. What we can promise: encryption in transit and at rest, access limited to those who need it, and, if a breach affects your data, notification to the supervisory authority within 72 hours and to you without undue delay.',
  },
  {
    n: 9, title: 'You keep your rights, and we make them usable.',
    body: 'Access, correct, export, restrict, object, or delete — from inside the app, not by writing a letter. Closing your account ends access immediately; what we retain afterwards, and for how long, is stated on that screen before you confirm.',
    link: { href: '/privacy-request', label: 'Make a data-rights request' },
  },
  {
    n: 10, title: 'Aggregate insight, never your content.',
    body: 'We study how the product is used to improve it, and we publish statistics about the market. Neither ever exposes your documents, your identity, or anything traceable to your company.',
  },
];

export const COMMITMENTS_V1: Commitment[] = ALL.filter((c) => c.n !== 6 || AI_TRAINING_LINE_CONFIRMED);

export const COMMITMENTS_FOOTNOTE = 'This page summarises how we work. The Privacy Policy and Terms are the documents that govern the relationship — this is the plain-language version, not a replacement.';
