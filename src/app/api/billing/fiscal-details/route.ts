// Billing -- the org's InvoiceXpress fiscal details (NIF + billing address).
// GET returns what's on file (to prefill the checkout step); POST saves an
// edit. Same owner/admin gate as /api/stripe/checkout -- these are the
// numbers that end up on a real fiscal document, not a cosmetic setting.
//
// By Nuno's decision (04/11/2026): fiscal_id is OPTIONAL. The warning that a
// missing NIF means the invoice is issued to "Consumidor Final" lives in the
// UI step that calls this, not here -- this route only ever stores whatever
// the founder confirmed.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { can, type OrgRole } from '@/lib/permissions';
import { withoutViewer } from '@/lib/acting-org';

async function requireOwnerOrAdmin() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) } as const;
  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) } as const;
  if (!can(member.role as OrgRole, 'manage_org_settings')) {
    return { error: NextResponse.json({ ok: false, error: 'Only the owner/admin can edit billing details.' }, { status: 403 }) } as const;
  }
  return { orgId: member.org_id as string } as const;
}

export const GET = withoutViewer(async function GET(_req: Request) {
  const gate = await requireOwnerOrAdmin();
  if ('error' in gate) return gate.error;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'Not configured.' }, { status: 200 });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: org, error } = await admin.from('orgs')
    .select('legal_name, name, fiscal_id, billing_address, billing_postal_code, billing_city, billing_country')
    .eq('id', gate.orgId).maybeSingle();
  if (error || !org) return NextResponse.json({ ok: false, error: 'Could not load billing details.' }, { status: 500 });
  return NextResponse.json({
    ok: true,
    details: {
      name: (org.legal_name as string | null) || (org.name as string),
      fiscalId: org.fiscal_id as string | null,
      address: org.billing_address as string | null,
      postalCode: org.billing_postal_code as string | null,
      city: org.billing_city as string | null,
      country: (org.billing_country as string | null) || 'PT',
    },
  });
});

function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, 200) : null;
}

export const POST = withoutViewer(async function POST(req: Request) {
  const gate = await requireOwnerOrAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch = {
    fiscal_id: cleanStr(body.fiscalId),
    billing_address: cleanStr(body.address),
    billing_postal_code: cleanStr(body.postalCode),
    billing_city: cleanStr(body.city),
    billing_country: cleanStr(body.country) || 'PT',
  };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'Not configured.' }, { status: 200 });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await admin.from('orgs').update(patch).eq('id', gate.orgId);
  if (error) return NextResponse.json({ ok: false, error: 'Could not save billing details.' }, { status: 500 });
  return NextResponse.json({ ok: true });
});
