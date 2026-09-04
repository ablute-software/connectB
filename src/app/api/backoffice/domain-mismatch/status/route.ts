// Prompt 284 §1 — read-only detection for the "Domain mismatch" backoffice
// queue: entities.email_domain doesn't appear anywhere in entities.website.
// No stored flag drives this — it's a live query, same "detect at read
// time" pattern as SuspiciousAccountsTab's own candidates, so a value fixed
// directly (or a false positive resolved) simply stops matching on the
// next load, no separate cleanup needed. email_domain_verified=false is
// the pre-filter AND the exit condition: every resolve action (apply
// suggestion / edit manually / mark as correct) sets it true, which is
// this column's own pre-existing meaning (already set true elsewhere by
// the Contributions Verify flow on this same field) — reused, not
// repurposed.
//
// entities has no is_test column of its own (confirmed against the real
// schema before writing this — unlike catalog_entities/orgs), and this queue
// deliberately does not filter by orgs.is_test.
//
// The reason given here was wrong, corrected in Prompt 568: ablute_ is
// is_test = FALSE, on purpose — the team's account is meant to behave as a
// real org so the whole flow can be validated before launch. So the old
// "filtering would drop every real ablute_ entity" argument never applied.
//
// Not filtering is still right, for a plainer reason: this is a review queue
// over entities, and an entity belonging to a test org is still an entity
// someone typed a domain into. Reviewing it costs a glance; missing a real
// mismatch costs a wrong outreach. Ad-hoc verification fixtures created by this
// repo's own scripts are excluded by CLAUDE.md's own naming convention
// instead (`zz-test-` prefix), the one exclusion mechanism that actually
// applies at the entities level.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { hasDomainMismatch, suggestDomainFix } from '@/lib/domain-mismatch';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: entities, error } = await admin.from('entities')
    .select('id, org_id, name, website, email_domain, email, orgs(name)')
    .eq('email_domain_verified', false)
    .not('website', 'is', null)
    .not('email_domain', 'is', null)
    .not('name', 'ilike', 'zz-test-%');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const mismatches = (entities ?? [])
    .filter((e) => hasDomainMismatch(e.website as string, e.email_domain as string))
    .map((e) => ({
      id: e.id as string,
      name: e.name as string,
      orgName: (e.orgs as unknown as { name: string } | null)?.name ?? 'Unknown org',
      website: e.website as string,
      emailDomain: e.email_domain as string,
      email: (e.email as string | null) ?? null,
      suggestion: suggestDomainFix(e.email as string | null, e.email_domain as string),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ ok: true, mismatches });
}
