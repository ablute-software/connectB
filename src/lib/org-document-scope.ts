// Prompt 692 — the pure predicate behind the cross-org document gate.
// Deliberately takes no notion of "admin" at all: org membership is the
// only input, on purpose. The bug this closes was specifically an admin
// exemption (documents_ablute_qa_read grants any platform_admin
// unrestricted read across every org's Vault, independent of org_id) — a
// predicate that accepted an `isAdmin` flag would invite reintroducing
// exactly that exemption one call site at a time.
export function findCrossOrgDocumentId(
  docs: { id: string; org_id: string }[],
  orgId: string,
): string | null {
  return docs.find((d) => d.org_id !== orgId)?.id ?? null;
}
