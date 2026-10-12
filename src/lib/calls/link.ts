// Prompt 905, moved here by Prompt 908 — the ONE place that builds the URL candidates apply through. The entity's
// "Preview & confirm" tab and the back-office Calls page both use it, so the link is the same string in both.
export function callLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/call/${token}`;
}
