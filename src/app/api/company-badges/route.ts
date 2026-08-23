// Prompt 326 — badges/awards. GET: the founder's own org's badges (list,
// workspace view — includes verification_note/evidence_document_id, since
// this is the founder's own data about their own company). POST: create
// one, always starting 'unverified' until a real verification runs
// (Pedido B's own "decide by reading what's most honest" resolved to:
// never claim confidence before the check actually happens).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { findMatchingClaimForBadge } from '@/lib/company-badges';

async function orgAndAdmin(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  return { admin, orgId: member.org_id as string };
}

export async function GET(req: Request) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, orgId } = resolved;

  const { data, error } = await admin.from('company_badges').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, badges: data });
}

export async function POST(req: Request) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, orgId } = resolved;

  const body = await req.json().catch(() => ({})) as {
    name?: string; description?: string; year?: number; logoStoragePath?: string; evidenceDocumentId?: string;
    linkedClaimId?: string; skipDuplicateCheck?: boolean;
  };
  if (!body.name?.trim()) return NextResponse.json({ ok: false, error: 'Name is required.' }, { status: 400 });

  // Pedido C — surfaced to the founder BEFORE insert, so the badge is never
  // created twice (once unlinked, then again linked) once they decide. The
  // client resubmits with either linkedClaimId ("yes, link") or
  // skipDuplicateCheck ("keep separate") to actually create it; the first
  // attempt (neither set) only ever checks and returns, never inserts.
  if (!body.linkedClaimId && !body.skipDuplicateCheck) {
    const { data: claims } = await admin.from('company_claims').select('id, statement, status, evidence_class').eq('org_id', orgId);
    const pool = (claims ?? []).map((c) => ({ id: c.id as string, statement: c.statement as string, status: c.status as 'proposed' | 'accepted' | 'rejected', evidenceClass: c.evidence_class as 1 | 2 | 3 | 4 | 5 }));
    const duplicateOf = findMatchingClaimForBadge({ name: body.name, description: body.description ?? null }, pool);
    if (duplicateOf) return NextResponse.json({ ok: true, duplicateOf });
  }

  const { data, error } = await admin.from('company_badges').insert({
    org_id: orgId, name: body.name.trim(), description: body.description?.trim() || null,
    year: body.year ?? null, logo_storage_path: body.logoStoragePath ?? null,
    evidence_document_id: body.evidenceDocumentId ?? null, linked_claim_id: body.linkedClaimId ?? null,
  }).select('*').single();
  if (error || !data) return NextResponse.json({ ok: false, error: error?.message ?? 'Could not create badge.' }, { status: 500 });

  return NextResponse.json({ ok: true, badge: data });
}
