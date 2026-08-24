// Prompt 355 §B/C — "Sherlock summary": on-demand, shared-cache summary of
// one document. Access is resolved via visibleDocumentsForFirm
// (data-room-server.ts) — the EXACT SAME function /api/portal/interaction-log
// and /api/portal/actions-required already use — never a second, divergent
// access check for the same document.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { visibleDocumentsForFirm } from '@/lib/data-room-server';
import { ensureDocumentSummary } from '@/lib/document-extraction-pipeline';
import { assertNotViewer } from '@/lib/developer-viewer';

export const maxDuration = 30;

// Prompt 354/355 — cache-ONLY read, for the deal memo's "include summaries
// of documents you rated, when they exist" (never trigger a fresh AI call
// just because the memo happened to render — that's POST's job, on an
// explicit investor click).
export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ summaries: {} });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const reqUrl = new URL(req.url);
  const orgId = reqUrl.searchParams.get('orgId');
  const documentIds = reqUrl.searchParams.getAll('documentId');
  if (!orgId || documentIds.length === 0) return NextResponse.json({ summaries: {} });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const visibleDocs = await visibleDocumentsForFirm(admin, orgId, email);
  const visibleIds = new Set(visibleDocs.map((d) => d.id));
  const requestedVisibleIds = documentIds.filter((id) => visibleIds.has(id));
  if (requestedVisibleIds.length === 0) return NextResponse.json({ summaries: {} });

  const { data: rows } = await admin.from('document_summaries').select('document_id, summary, highlights')
    .in('document_id', requestedVisibleIds).eq('status', 'completed');
  const summaries: Record<string, { summary: string; highlights: string[] }> = {};
  for (const r of rows ?? []) summaries[r.document_id as string] = { summary: r.summary as string, highlights: (r.highlights as string[] | null) ?? [] };
  return NextResponse.json({ summaries });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) return NextResponse.json({ ok: false, error: 'Not available yet.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string; documentId?: string };
  if (!body.orgId || !body.documentId) return NextResponse.json({ ok: false, error: 'orgId and documentId are required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const visibleDocs = await visibleDocumentsForFirm(admin, body.orgId, email);
  if (!visibleDocs.some((d) => d.id === body.documentId)) {
    return NextResponse.json({ ok: false, error: 'This document is not visible to you.' }, { status: 403 });
  }

  const outcome = await ensureDocumentSummary(admin, apiKey, body.orgId, body.documentId);
  if (!outcome.ok || !outcome.summary) {
    return NextResponse.json({ ok: false, error: 'Could not generate a summary for this document.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, summary: outcome.summary, highlights: outcome.highlights ?? [], cached: !!outcome.cached });
}
