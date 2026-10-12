// Prompt 904 §A.3 — which controls a Developer Viewer session should not invite a click on.
//
// The API is the barrier (withActingOrg / the middleware gate answer 403 viewer_read_only to any write); this
// only spares the developer the useless click, by greying the control and saying why on hover. Pure, so the
// word list is tested rather than remembered.
//
// Deliberately a blunt word list over the control's visible text — the same trade-off DeveloperViewerFrame has
// always made (a perfect classifier is not needed when the server refuses the write anyway). Two tiers:
//   • the original substrings (save, delete, send, …), matched anywhere in the text;
//   • the verbs the 12/10 report named that the first list missed (Accept selected (18), Edit, Post update,
//     Change password, Suggest a stronger version, Research this hypothesis), matched as WHOLE WORDS so that
//     "Credits" or "Postcode" do not trip on "edit" / "post".
export const VIEWER_READ_ONLY_TOOLTIP = 'Read-only in Developer Viewer';

const MUTATING_SUBSTRINGS = [
  'save', 'delete', 'revoke', 'remove', 'send', 'submit', 'create', 'add', 'grant',
  'invite', 'approve', 'reject', 'suspend', 'archive', 'confirm', 'upload', 'unlock', 'request', 'reset',
];

const MUTATING_WORDS = /\b(accept|edit|post|suggest|research|change)\b/i;

export function isMutatingControlText(text: string): boolean {
  const lower = text.toLowerCase();
  return MUTATING_SUBSTRINGS.some((w) => lower.includes(w)) || MUTATING_WORDS.test(text);
}
