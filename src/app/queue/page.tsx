// /queue dissolved — it briefly merged Needs review + Outbox, but Needs
// review moved into /settings (separador "Needs review") and Outbox went
// back to being its own top-level page (now itself superseded by /tasks's
// "Warrants" sub-tab, Prompt 94 — redirecting straight there rather than
// bouncing through /outbox's own redirect). /queue itself was never live
// for long, but it WAS deployed, so it still gets a permanent redirect
// rather than a 404 for anyone who bookmarked it in that window.
import { permanentRedirect } from 'next/navigation';

export default function QueueRedirect() {
  permanentRedirect('/tasks?tab=warrants');
}
