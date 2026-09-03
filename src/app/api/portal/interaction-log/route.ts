// P133 (item 10) — investor-side interaction log. GET returns the unified
// timeline for one startup (manual entries + automatic decision/archive/
// MatchDeal entries); POST records a manual entry. Founder has no route
// that reads investor_interaction_log — this is the only place it's ever
// queried, and only ever with the service-role client.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { pipelineEligibleOrgIds } from '@/lib/investor-pipeline';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { interactionLogAvailable, interactionLogPersonDocumentAvailable } from '@/lib/investor-interaction-log-capability';
import { getInteractionTimeline, createManualInteractionEntry, getStartupPeople } from '@/lib/investor-interaction-log';
import { visibleDocumentsForFirm } from '@/lib/data-room-server';
import { assertNotViewer } from '@/lib/developer-viewer';

const CHANNELS = ['matchdeal', 'email', 'call', 'meeting', 'message', 'other'] as const;

// P134-D §4 — documents this firm may attach to a manual entry: exactly
// the ones already visible via a real access_grants row for THIS org, same
// resolveDocumentAccess() the Documents tab itself uses and the same
// validate-server-side-never-trust-the-client posture P134-C's messages
// already established for document_ids. Prompt 216 §C moved the body to
// visibleDocumentsForFirm (data-room-server.ts), unchanged, so
// /api/portal/actions-required can share the exact same gated path.
async function attachableDocuments(admin: SupabaseClient, orgId: string, email: string) {
  return visibleDocumentsForFirm(admin, orgId, email);
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ entries: [] }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  if (!(await interactionLogAvailable())) return NextResponse.json({ entries: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const eligibleOrgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!eligibleOrgIds.includes(orgId)) return NextResponse.json({ error: 'Not eligible for this startup.' }, { status: 403 });

  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ entries: [] });

  const [entries, people, documents] = await Promise.all([
    getInteractionTimeline(admin, { investorCatalogEntityId, email, orgId }),
    getStartupPeople(admin, orgId),
    attachableDocuments(admin, orgId, email),
  ]);
  return NextResponse.json({ entries, people, documents, personDocumentAvailable: await interactionLogPersonDocumentAvailable() });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  if (!(await interactionLogAvailable())) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as {
    orgId?: string; channel?: string; content?: string; links?: unknown; occurredAt?: string;
    personId?: string; personNameOther?: string; documentId?: string;
  };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!body.channel || !(CHANNELS as readonly string[]).includes(body.channel)) {
    return NextResponse.json({ ok: false, error: 'A valid channel is required.' }, { status: 400 });
  }
  if (!body.content?.trim()) return NextResponse.json({ ok: false, error: 'Content is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, body.orgId);
  if (closedBlock) return closedBlock;
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const eligibleOrgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!eligibleOrgIds.includes(body.orgId)) return NextResponse.json({ ok: false, error: 'Not eligible for this startup.' }, { status: 403 });

  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  // person_id, if given, must genuinely be a person at THIS startup — never
  // trusted as an opaque id from the client.
  let personId: string | null = null;
  if (body.personId) {
    const { data: personRow } = await admin.from('company_people').select('id').eq('id', body.personId).eq('org_id', body.orgId).maybeSingle();
    if (!personRow) return NextResponse.json({ ok: false, error: 'That person is not on record for this startup.' }, { status: 400 });
    personId = body.personId;
  }

  // document_id, if given, must be one this firm already has grant access
  // to — recomputed here, never trusted from the client, same posture as
  // P134-C's own document_ids validation in /api/portal/messages.
  let documentId: string | null = null;
  if (body.documentId) {
    const allowed = await attachableDocuments(admin, body.orgId, email);
    if (!allowed.some((d) => d.id === body.documentId)) {
      return NextResponse.json({ ok: false, error: 'That document is not accessible to your firm.' }, { status: 403 });
    }
    documentId = body.documentId;
  }

  const { error } = await createManualInteractionEntry(admin, {
    investorCatalogEntityId, orgId: body.orgId, userId: user.id, channel: body.channel, content: body.content, links: body.links,
    occurredAt: body.occurredAt, personId, personNameOther: body.personNameOther ?? null, documentId,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
