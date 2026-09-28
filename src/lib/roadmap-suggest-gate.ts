// Prompt 892 — split out of suggest-events/route.ts: a Next.js route file may
// only export recognized route handlers (GET/POST/etc. and a small config
// allow-list) — an arbitrary named export like this one fails the route's
// own generated type check (`does not satisfy the constraint '{ [x:
// string]: never }'`). Pure and tiny on purpose, so it needs no Supabase
// client or network call to test.
//
// The rule itself: 894 fixed suggest-events' org resolution to correctly
// target the org being VIEWED during a Developer Viewer session (rather
// than the admin's own org, the previous bug), which as a side effect
// turned a wrong-org mixup into a real leak — a plain page load could run a
// full AI generation pass and write real roadmap_event_suggestions rows
// into the org being viewed, plus spend that org's own AI credits, with no
// way for its founders to know a suggestion wasn't their own. A viewer
// session may still READ whatever is already pending (useful while
// investigating); it must never trigger a NEW pass.
export function shouldGenerateNewSuggestions(opts: {
  isViewerSession: boolean; alreadyRanForThisSignature: boolean; hasApiKey: boolean; itemCount: number;
}): boolean {
  return !opts.isViewerSession && !opts.alreadyRanForThisSignature && opts.hasApiKey && opts.itemCount > 0;
}
