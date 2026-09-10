// Prompt 585 §D.3 — a founder proposing public evidence about a person in
// their own pipeline. Always lands `quarantined`; never scores for the
// proposing org even once verified (catalog_topic_signal's own
// `created_by_org_id is distinct from p_org_id` filter, migration 0345 —
// unchanged by this route). Auto-verifies at 3 distinct non-test orgs on
// the same normalized url via the `trg_catalog_evidence_consensus_check`
// trigger (migration 0347); otherwise sits for an admin to review (§G.1).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { validateEvidenceProposal } from '@/lib/catalog-evidence-propose';

async function requireOrgMember(req: Request) {
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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireOrgMember(req);
  if ('error' in auth) return auth.error;
  const { admin, orgId } = auth;
  const personId = params.id;

  // Only for a person genuinely in this org's pipeline — the same
  // "delivered to your org" barrier catalog_evidence_read (0344) already
  // enforces for reading, checked again here before accepting a write.
  // catalog_person_affiliations and catalog_deliveries share no direct FK
  // (both merely reference catalog_entities), so this is two queries, not
  // a PostgREST embed.
  const { data: currentAffiliations } = await admin
    .from('catalog_person_affiliations').select('entity_id').eq('person_id', personId).eq('current', true);
  const entityIds = (currentAffiliations ?? []).map((a) => a.entity_id as string);
  let inPipeline = false;
  if (entityIds.length > 0) {
    const { data: delivered } = await admin
      .from('catalog_deliveries').select('catalog_id').eq('org_id', orgId).in('catalog_id', entityIds).limit(1);
    inPipeline = !!delivered && delivered.length > 0;
  }
  if (!inPipeline) {
    return NextResponse.json({ ok: false, error: 'This person isn’t in your pipeline.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const validation = validateEvidenceProposal(body);
  if (!validation.ok || !validation.normalized) {
    return NextResponse.json({ ok: false, error: validation.errors.join(' ') }, { status: 400 });
  }
  const { url, kind, title, excerpt, publishedAt } = validation.normalized;

  // strength defaults to 2 ("participation/mention-level") — a founder
  // proposing evidence isn't asked to self-assess evidentiary strength on
  // the 1-4 scale §A defines (4 requires a direct personal quote in an
  // interview/podcast); an admin can raise it on review.
  const { data: evidence, error: insertErr } = await admin
    .from('catalog_evidence')
    .insert({
      person_id: personId, kind, title, url, excerpt, published_at: publishedAt,
      polarity: 'neutral', strength: 2, is_personal: false,
      origin: 'founder', status: 'quarantined', created_by_org_id: orgId,
    })
    .select('id, title, excerpt, status')
    .single();
  if (insertErr || !evidence) {
    return NextResponse.json({ ok: false, error: insertErr?.message ?? 'Could not save.' }, { status: 500 });
  }

  const { data: tagCount } = await admin.rpc('catalog_tag_evidence_dictionary', { p_evidence_id: evidence.id });
  if (!tagCount || tagCount === 0) {
    const textLen = (title?.length ?? 0) + (excerpt?.length ?? 0);
    if (textLen >= 300) {
      await admin.from('evidence_tagging_queue').insert({ evidence_id: evidence.id });
    }
  }

  return NextResponse.json({ ok: true, evidence });
}
