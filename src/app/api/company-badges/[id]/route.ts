// Prompt 326 — edit/delete one badge. Same org-scoped ownership check
// (explicit .eq('org_id', orgId), never relying on RLS alone) as every
// other founder-write route in this app.
//
// Prompt 918 — an edit that changes the name, the year or the source link of a badge Sherlock already ruled on sends it back to
// "unverified" (private again): what was verified was ONE name, ONE year and ONE source (buildBadgePatch). The verdict's own fields
// — status, note, date, found title, found logo — are never accepted from the founder; only a verification writes them.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';
import { buildBadgePatch, isOwnStoragePath, normalizeSourceUrl, type BadgeBeforeEdit, type BadgeEditBody } from '@/lib/company-badges';

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

  const raw = await req.json().catch(() => ({})) as BadgeEditBody;
  // Only the fields a founder may set are read from the body (buildBadgePatch ignores anything else, the verdict's columns included).
  const body: BadgeEditBody = {
    name: raw.name, description: raw.description, year: raw.year, kind: raw.kind, sourceUrl: raw.sourceUrl,
    logoStoragePath: raw.logoStoragePath, evidenceDocumentId: raw.evidenceDocumentId, linkedClaimId: raw.linkedClaimId,
  };
  // An empty source link means "remove it"; a non-empty one that is not a public web address is refused, never silently turned into "remove".
  if (typeof body.sourceUrl === 'string') {
    if (!body.sourceUrl.trim()) body.sourceUrl = null;
    else if (!normalizeSourceUrl(body.sourceUrl)) return NextResponse.json({ ok: false, error: 'The source link must be a public web address, like https://example.com/award.' }, { status: 400 });
  }
  if (body.name !== undefined && !body.name.trim()) return NextResponse.json({ ok: false, error: 'Name is required.' }, { status: 400 });
  // The logo is streamed back by a route that signs with the service role: it can only ever be a file in THIS org's own folder.
  if (body.logoStoragePath && !isOwnStoragePath(orgId, body.logoStoragePath)) return NextResponse.json({ ok: false, error: 'That logo file is not one of your organisation’s uploads.' }, { status: 400 });

  const { data: before } = await admin.from('company_badges')
    .select('name, year, source_url, verification_status, source_found_by').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!before) return NextResponse.json({ ok: false, error: 'Badge not found.' }, { status: 404 });

  const { patch, resetsVerification } = buildBadgePatch(before as BadgeBeforeEdit, body);
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });

  const { error } = await admin.from('company_badges').update(patch).eq('id', params.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, resetsVerification });
});

export const DELETE = withActingOrg(async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const resolved = await orgAndAdmin(req);
  if ('error' in resolved) return resolved.error;
  const { admin, orgId } = resolved;

  const { error } = await admin.from('company_badges').delete().eq('id', params.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
