// Back-office queue for investor_access_requests (0039/0041) — the public
// "request access" lead-capture form on the investor landing. Approving a
// request creates a real access_grants row, which is what resolveRole()
// actually checks to hand out the 'investor' role — see the [id]/approve
// route and DECISIONS.md "resolveRole priority" (2026-07-28).
//
// Each request also carries a domainMatch verdict (Anexo B claim-decision
// matrix — see investor-domain-match.ts) so the reviewing admin sees, before
// clicking anything, whether the registration email's domain actually
// belongs to the firm the requester typed in — not just their say-so.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { checkInvestorDomainMatch } from '@/lib/investor-domain-match';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data, error }, { data: entities }, { data: aliases }] = await Promise.all([
    admin.from('investor_access_requests')
      .select('id, created_at, email, firm_name, note, status, contacted_at, reviewed_at, notified_at, notify_failed')
      .order('created_at', { ascending: false }),
    admin.from('catalog_entities').select('id, name, website'),
    admin.from('entity_aliases').select('catalog_id, alias').not('catalog_id', 'is', null),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const requests = (data ?? []).map((r) => ({
    ...r,
    domainMatch: checkInvestorDomainMatch({
      email: r.email, firmName: r.firm_name, entities: entities ?? [],
      aliases: (aliases ?? []) as { catalog_id: string; alias: string }[],
    }),
  }));

  return NextResponse.json({ ok: true, requests });
}
