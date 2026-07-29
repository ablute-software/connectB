// The one seeded real org (ablute_) in this single-tenant-so-far
// deployment. Shared so every place that needs to special-case it — legacy
// owner sign-up (provision-org), back-office investor-access approval —
// points at the same id rather than each hard-coding its own copy.
export const ABLUTE_ORG_ID = 'bca54499-03c8-469b-a48d-b9f442e44f69';
