// Prompt 326 — edit/delete one badge. Same org-scoped ownership check
// (explicit .eq('org_id', orgId), never relying on RLS alone) as every
// other founder-write route in this app.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';

async function orgAndAdmin(req: Request): Promise<{ error: NextResponse } | { admin: SupabaseClient; orgId: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  return { admin, orgId: acting.orgId };
}

export const PATCH = withActingOrg(async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, orgId } = resolved;

  const body = await req.json().catch(() => ({})) as {
    name?: string; description?: string | null; year?: number | null; logoStoragePath?: string | null; evidenceDocumentId?: string | null; linkedClaimId?: string | null;
  };
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description?.trim() || null;
  if (body.year !== undefined) patch.year = body.year;
  if (body.logoStoragePath !== undefined) patch.logo_storage_path = body.logoStoragePath;
  if (body.evidenceDocumentId !== undefined) patch.evidence_document_id = body.evidenceDocumentId;
  if (body.linkedClaimId !== undefined) patch.linked_claim_id = body.linkedClaimId;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });

  const { error } = await admin.from('company_badges').update(patch).eq('id', params.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

export const DELETE = withActingOrg(async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, orgId } = resolved;

  const { error } = await admin.from('company_badges').delete().eq('id', params.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
