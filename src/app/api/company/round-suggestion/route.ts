// Prompt 541 §B — the Round tab's equivalent of intro-pitch-suggestion
// (Prompt 459), with one structural difference that the precedence rule
// forces: this route does NOT decide whether to suggest.
//
// intro-pitch-suggestion can, because its rule is "empty field only" and it
// can evaluate that itself. Here the answer depends on whether a human
// decision is recorded on the field, what that decision was, and whether the
// founder already turned this exact candidate down — so the route returns
// the raw material (current value, its provenance, the candidate and where
// it came from) and src/lib/round-field-precedence.ts decides. The same
// function runs on the client and in the tests, so what the founder sees and
// what the rule says can never drift.
//
// Everything with a decision in it lives in src/lib/round-suggestion.ts;
// this file is the fetch-and-serialise wrapper. Auth/gate shape is copied
// from 459 deliberately: same session check, same org resolution, same
// "report unavailable rather than fail" posture when a migration has not
// been applied.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { documentExtractionsAvailable, roundFieldsSourceAvailable } from '@/lib/document-extraction-capability';
import { ROUND_SOURCE_FIELDS, type RoundFieldsSource, type RoundFieldValue, type RoundSourceField } from '@/lib/round-field-precedence';
import { buildRoundSuggestions, type RoundExtractionRow } from '@/lib/round-suggestion';

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

  // Both gates, not one: extractions can exist without the provenance column
  // (0298 unapplied), and suggesting without provenance is exactly what the
  // precedence rule forbids — there would be no way to tell the founder's
  // own number from a three-week-old draft deck's. See the probe's comment.
  if (!(await documentExtractionsAvailable()) || !(await roundFieldsSourceAvailable())) {
    return NextResponse.json({ available: false });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: org } = await admin.from('orgs')
    .select(`${ROUND_SOURCE_FIELDS.join(', ')}, round_fields_source`)
    .eq('id', orgId).maybeSingle();
  if (!org) return NextResponse.json({ available: false });

  const orgRow = org as unknown as Partial<Record<RoundSourceField, RoundFieldValue>> & { round_fields_source?: RoundFieldsSource | null };

  // Same fetch-then-map shape as intro-pitch-suggestion: one org's own Vault
  // extractions is a small row count, and a JSON-path filter server-side
  // would buy nothing here.
  const { data: rows } = await admin.from('document_extractions')
    .select('extracted, created_at, document_id, documents(name)')
    .eq('org_id', orgId).eq('status', 'completed')
    .order('created_at', { ascending: false });

  // §D — `anyCandidate: false` is what makes the "upload it to your Vault"
  // pointer appear. It means no extraction in this org has ever produced a
  // single round field, which is the only state where that nudge is honest.
  const { anyCandidate, fields } = buildRoundSuggestions({
    org: orgRow,
    sources: orgRow.round_fields_source,
    extractions: (rows ?? []) as unknown as RoundExtractionRow[],
  });

  return NextResponse.json({ available: true, anyCandidate, fields });
}
