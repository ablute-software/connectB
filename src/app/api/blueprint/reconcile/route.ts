// Prompt 358 Phase 2.1 — "reconciliation must also run on every document
// upload/rename." Upload already goes through the extraction pipeline
// (document-extraction-pipeline.ts calls runReconciliationForOrg itself);
// a RENAME never triggers extraction (the file's content didn't change,
// only its name — which extraction has no reason to re-run for), so it
// needs this separate, lightweight trigger instead. Fire-and-forget from
// the client (store-supabase.tsx's renameDocument), same shape as
// triggerDocumentExtraction — never blocks the rename itself.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { gapReconciliationsAvailable } from '@/lib/document-extraction-capability';
import { runReconciliationForOrg } from '@/lib/reconciliation';

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await gapReconciliationsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const outcome = await runReconciliationForOrg(admin, apiKey, orgId);
  return NextResponse.json({ ok: true, ...outcome });
}
