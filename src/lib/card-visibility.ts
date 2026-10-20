// Which readers see a card that hides itself from "someone who cannot edit".
//
// A founder-side card often says: show me to people who can edit, or to anyone once there is something to show (the cap table only to owners and admins; the
// MatchDeal card to a reader only once the pitch is live for investors; the photo gallery to a reader only if it has photos). `canEdit` carries that — and a
// Developer Viewer session has `canEdit` FALSE too (it holds no role in the org it is looking at), so every such card went BLANK for the one person whose job is
// to see what the founder sees: the Cap table, Previous funding and MatchDeal tabs of ablute_ (Nuno, 20/10/2026: "I know it has data and it was not displayed").
//
// The viewer is not a member with fewer rights; it is a reader entitled to everything, read-only. Whether it may CHANGE anything is still `canEdit` (false) and
// the server (withActingOrg, the viewer write gate, RLS) — this only decides whether the card is drawn at all.
export function cardVisibleToReader(args: {
  /** May change this organisation's data (an owner or an admin, or demo mode). */
  canEdit: boolean;
  /** A Developer Viewer session: a developer reading the company's workspace, read-only. */
  viewer: boolean;
  /** Is there something here for a reader who cannot edit (a live pitch, at least one photo)? Only matters for the cards that hide when empty. */
  hasContentForReaders?: boolean;
}): boolean {
  return args.canEdit || args.viewer || !!args.hasContentForReaders;
}
