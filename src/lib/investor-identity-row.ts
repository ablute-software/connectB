// Prompt 573 §C — the shape /api/backoffice/investor-identity returns,
// shared with the client-side InvestorIdentityTab. Its own file rather than
// a type import from route.ts: that file transitively pulls in
// supabase-server.ts ('server-only'), and while `import type` is erased at
// compile time either way, this codebase's stated convention keeps domain
// types out of route files for exactly this reason.
export interface UnifiedIdentityRow {
  id: string;
  kind: 'self_declared' | 'document' | 'claim';
  status: 'pending' | 'resolved';
  entityId: string;
  entityName: string;
  entityWebsite: string | null;
  requesterEmail: string;
  createdAt: string;
  // null means "couldn't be computed" — no website on file for the entity,
  // per §C's own required copy ("no website declared — domain check
  // impossible"), never rendered as a false ✗.
  domainMatch: boolean | null;
  claimantDomain: string | null;
  entityDomain: string | null;
  documentFileName?: string;
  documentUrl?: string | null;
  malwareFlagged?: boolean;
  malwareScanStatus?: string;
  isDispute?: boolean;
  probableCatalogMatch: { id: string; name: string; website: string | null } | null;
  // Internal test/QA accounts (matchdeal_investor_members.is_internal) —
  // hidden by default, same convention New investors' hiddenInternal uses.
  isInternal: boolean;
  // Cross-referenced context regardless of kind: how many verification
  // documents exist for this SAME entity, any status — a self-declared or
  // claim row's reviewer benefits from knowing a document is also on file.
  documentCount: number;
  // Populated only when status === 'resolved'.
  resolvedByEmail?: string | null;
  resolvedAt?: string | null;
  resolutionNotes?: string | null;
  resolutionMethod?: string | null;
  notifyFailed?: boolean;
}
