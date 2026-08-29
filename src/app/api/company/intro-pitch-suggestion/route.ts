// Prompt 459 §C — same "accept without rewriting" discipline as Prompt
// 456's Market Thesis suggestions: a real fact already extracted from the
// founder's own Vault documents (Prompt 459 §B's pitch_problem/
// pitch_solution), never invented, never overwriting a field the founder
// already filled in.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { documentExtractionsAvailable } from '@/lib/document-extraction-capability';

interface ExtractedPitch { pitchProblem?: string | null; pitchSolution?: string | null }

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  if (!(await documentExtractionsAvailable())) return NextResponse.json({ available: false });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: org } = await admin.from('orgs').select('intro_problem, intro_solution').eq('id', orgId).maybeSingle();
  // Never suggests over two fields that are both already real — same rule
  // as Prompt 456. Skips the (more expensive) extractions query entirely
  // in this, the common "already filled in" case.
  if (org?.intro_problem?.trim() && org?.intro_solution?.trim()) {
    return NextResponse.json({ available: true, suggestion: null });
  }

  // The most-recent-with-a-pitch-fact match is found in JS rather than a
  // JSON-path OR filter server-side — one org's own Vault extractions is a
  // small row count, and this is the same fetch-then-map pattern sherlock-
  // prep/route.ts's own readExtractions already uses for this exact table.
  const { data: rows } = await admin.from('document_extractions')
    .select('extracted, documents(name)')
    .eq('org_id', orgId).eq('status', 'completed')
    .order('created_at', { ascending: false });

  const match = ((rows ?? []) as { extracted: ExtractedPitch | null; documents: { name?: string } | null }[])
    .find((r) => r.extracted?.pitchProblem?.trim() || r.extracted?.pitchSolution?.trim());
  if (!match) return NextResponse.json({ available: true, suggestion: null });

  // Per-field, same rule as 456: never suggests intro_solution if a real
  // one already exists, even when the extraction also found a pitchSolution.
  const suggestion: { problem?: string; solution?: string; sourceDocumentName: string } = {
    sourceDocumentName: match.documents?.name ?? 'a document in your Vault',
  };
  if (!org?.intro_problem?.trim() && match.extracted?.pitchProblem?.trim()) suggestion.problem = match.extracted.pitchProblem.trim();
  if (!org?.intro_solution?.trim() && match.extracted?.pitchSolution?.trim()) suggestion.solution = match.extracted.pitchSolution.trim();
  if (!suggestion.problem && !suggestion.solution) return NextResponse.json({ available: true, suggestion: null });

  return NextResponse.json({ available: true, suggestion });
}
