// Billing -- the InvoiceXpress fiscal details (NIF + billing address) of whoever
// is about to pay. GET returns what's on file (to prefill the checkout step);
// POST saves an edit. Two subjects, chosen by `catalog_entity_id` (query string
// on GET, `catalogEntityId` in the body on POST):
//   - absent: the caller's org, stored on orgs. Same owner/admin gate as
//     /api/stripe/checkout -- these are the numbers that end up on a real
//     fiscal document, not a cosmetic setting.
//   - present: an investor firm, stored on investor_billing (never on
//     catalog_entities, which is publicly readable: see migration
//     20261104130000). Same gate as /api/stripe/investor-checkout: an active
//     member of THAT firm, lapsed billing included, since paying is the way out.
//
// By Nuno's decision (04/11/2026): fiscal_id is OPTIONAL. The warning that a
// missing NIF means the invoice is issued to "Consumidor Final" lives in the
// UI step that calls this, not here -- this route only ever stores whatever
// the customer confirmed.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { can, type OrgRole } from '@/lib/permissions';
import { withoutViewer } from '@/lib/acting-org';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';

type Subject = { kind: 'org'; orgId: string } | { kind: 'firm'; firmId: string };
type Gate = { subject: Subject; admin: SupabaseClient } | { error: NextResponse };

const FISCAL_COLUMNS = 'fiscal_id, billing_address, billing_postal_code, billing_city, billing_country';

async function authorize(catalogEntityId: string | null): Promise<Gate> {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: false, error: 'Not configured.' }, { status: 200 }) };
  const admin = createClient(url, service, { auth: { persistSession: false } });

  if (catalogEntityId) {
    const member = await resolveActiveInvestorMember(admin, user.id, { allowBillingLapsed: true });
    if (!member || member.catalog_entity_id !== catalogEntityId) {
      return { error: NextResponse.json({ ok: false, error: 'Not a member of this firm.' }, { status: 403 }) };
    }
    return { subject: { kind: 'firm', firmId: catalogEntityId }, admin };
  }

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) };
  if (!can(member.role as OrgRole, 'manage_org_settings')) {
    return { error: NextResponse.json({ ok: false, error: 'Only the owner/admin can edit billing details.' }, { status: 403 }) };
  }
  return { subject: { kind: 'org', orgId: member.org_id as string }, admin };
}

export const GET = withoutViewer(async function GET(req: Request) {
  const gate = await authorize(new URL(req.url).searchParams.get('catalog_entity_id'));
  if ('error' in gate) return gate.error;
  const { subject, admin } = gate;

  let name: string | null;
  let row: Record<string, unknown> | null;
  if (subject.kind === 'org') {
    const { data, error } = await admin.from('orgs').select(`legal_name, name, ${FISCAL_COLUMNS}`).eq('id', subject.orgId).maybeSingle();
    if (error || !data) return NextResponse.json({ ok: false, error: 'Could not load billing details.' }, { status: 500 });
    row = data as Record<string, unknown>;
    name = (row.legal_name as string | null) || (row.name as string);
  } else {
    const [{ data: firm, error: firmErr }, { data, error }] = await Promise.all([
      admin.from('catalog_entities').select('name').eq('id', subject.firmId).maybeSingle(),
      // No row yet is normal: a firm that never reached checkout.
      admin.from('investor_billing').select(FISCAL_COLUMNS).eq('catalog_entity_id', subject.firmId).maybeSingle(),
    ]);
    if (firmErr || error || !firm) return NextResponse.json({ ok: false, error: 'Could not load billing details.' }, { status: 500 });
    row = data as Record<string, unknown> | null;
    name = firm.name as string;
  }
  return NextResponse.json({
    ok: true,
    details: {
      name,
      fiscalId: (row?.fiscal_id as string | null) ?? null,
      address: (row?.billing_address as string | null) ?? null,
      postalCode: (row?.billing_postal_code as string | null) ?? null,
      city: (row?.billing_city as string | null) ?? null,
      country: (row?.billing_country as string | null) || 'PT',
    },
  });
});

function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, 200) : null;
}

export const POST = withoutViewer(async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const gate = await authorize(cleanStr(body.catalogEntityId));
  if ('error' in gate) return gate.error;
  const { subject, admin } = gate;
  const patch = {
    fiscal_id: cleanStr(body.fiscalId),
    billing_address: cleanStr(body.address),
    billing_postal_code: cleanStr(body.postalCode),
    billing_city: cleanStr(body.city),
    billing_country: cleanStr(body.country) || 'PT',
  };
  const { error } = subject.kind === 'org'
    ? await admin.from('orgs').update(patch).eq('id', subject.orgId)
    // An upsert: the row may not exist before the firm's first checkout. It
    // touches only these columns, so an existing row keeps its Stripe ids and
    // access_state, and a new one starts at the column defaults, which grant
    // and block nothing.
    : await admin.from('investor_billing').upsert({ catalog_entity_id: subject.firmId, ...patch }, { onConflict: 'catalog_entity_id' });
  if (error) return NextResponse.json({ ok: false, error: 'Could not save billing details.' }, { status: 500 });
  return NextResponse.json({ ok: true });
});
