// Prompt 313 §A — triggered fire-and-forget by store-supabase.tsx right
// after a document (or a new version of one) is created with
// malware_scan_status 'clean'. Never blocks the upload itself — the client
// call is a bare .catch(() => {}), same spirit as triggerEnrichmentEnqueue.
//
// Auth mirrors verify-upload/route.ts exactly (org membership via
// org_members, viewer block) — this route reads real document content and
// spends real Anthropic budget, so it gets the same bar as an upload itself,
// not a looser one.
//
// Prompt 465 §A.1 — coverage matrix: this route is the single caller of
// extractDocument that's reachable from a FOUNDER action, hit by two
// distinct client triggers, both policy IMMEDIATE_CLIENT:
//   - store-supabase.tsx's triggerDocumentExtraction (upload of a new PDF)
//   - MarketDataPanel.tsx's runDocumentExtraction (464 — "Read my
//     documents"), which itself calls this once per document in series
// Both now chain an explicit, awaited POST /api/reconciliation/run once
// extraction finishes (store-supabase.tsx: chained .then(), still fire-
// and-forget from the caller's own side; MarketDataPanel: awaited outright)
// — extractDocument's own dead `void runReconciliationForOrg(...)` trigger
// is gone (465 §A). extractDocument's OTHER real caller, ensureDocumentSummary
// (an investor opening a document summary in the portal), is deliberately
// CRON_ONLY instead — see its own comment.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { documentExtractionsAvailable } from '@/lib/document-extraction-capability';
import { extractDocument } from '@/lib/document-extraction-pipeline';

// Same ceiling every other PDF-reading/upload route in this codebase uses
// (verify-upload, nda-upload, blueprint/gap-assist) — confirmed by grep
// before picking this number, not a guess.
//
// Prompt 464 §B — this route now also gets a second, heavier caller:
// MarketDataPanel.tsx calls it once per document right after "Read my
// documents", awaited, for documents that can run to 11MB/30 pages (the
// ablute_ deck). 30s may not be enough for that document specifically. If
// it isn't, it fails VISIBLY — this route returns an error and the
// caller's own §B.4 shows it by name — instead of vanishing the way the
// old fire-and-forget did. Bump to 60 (the Hobby plan's own ceiling) in a
// follow-up prompt if that's confirmed with a real measurement — not a
// guess made here.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not an org member.' }, { status: 403 });
  const orgId = member.org_id as string;

  if (!(await documentExtractionsAvailable())) return NextResponse.json({ ok: true, skipped: true });

  const { documentId } = await req.json().catch(() => ({})) as { documentId?: string };
  if (!documentId) return NextResponse.json({ ok: false, error: 'Missing documentId.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const outcome = await extractDocument(admin, apiKey, orgId, documentId);
  return NextResponse.json(outcome);
}
