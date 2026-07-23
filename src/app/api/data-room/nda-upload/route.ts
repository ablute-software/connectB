// Data Room V2 (F5) — the founder uploads a real signed NDA (received via
// email/DocuSign/etc, outside this app) on behalf of a grantee. An AI
// cross-check reads the file directly (Claude's native PDF input, no
// separate text-extraction step) and compares the named parties against the
// investor and the org — a mismatch/uncertain verdict is still stored and
// still unlocks access; it only ever flags for the founder to double-check,
// never blocks (the founder decides, per the spec).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import type { NdaMatchStatus } from '@/lib/types';

export async function POST(req: NextRequest) {
  const { storagePath, fileName, personId, entityId, granteeEmail } = await req.json() as {
    storagePath?: string; fileName?: string; personId?: string; entityId?: string; granteeEmail?: string;
  };
  if (!storagePath || (!personId && !entityId && !granteeEmail)) {
    return NextResponse.json({ ok: false, error: 'storagePath and a subject (personId/entityId/granteeEmail) are required' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not an org member.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let subjectName = granteeEmail ?? '';
  let resolvedEntityId = entityId;
  if (personId) {
    const { data: p } = await admin.from('people').select('full_name, entity_id').eq('id', personId).eq('org_id', orgId).maybeSingle();
    if (p?.full_name) subjectName = p.full_name;
    if (!resolvedEntityId) resolvedEntityId = p?.entity_id ?? undefined;
  } else if (entityId) {
    const { data: e } = await admin.from('entities').select('name').eq('id', entityId).eq('org_id', orgId).maybeSingle();
    if (e?.name) subjectName = e.name;
  }
  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).single();

  let match_status: NdaMatchStatus = 'uncertain';
  let match_notes: string | undefined;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const { data: fileData, error: dlErr } = await admin.storage.from('data-room').download(storagePath);
      if (dlErr) throw dlErr;
      const base64 = Buffer.from(await fileData.arrayBuffer()).toString('base64');
      const isPdf = (fileName ?? storagePath).toLowerCase().endsWith('.pdf');

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
          max_tokens: 500,
          system: `Check whether this NDA document plausibly names "${subjectName}" as one counterparty and "${org?.name ?? ''}" as the other. `
            + 'Be lenient about exact wording (legal entity name variants, "on behalf of", trading names) — only report mismatch if the named parties clearly do not correspond. '
            + 'Always finish by calling report_match.',
          messages: [{
            role: 'user',
            content: isPdf
              ? [
                  { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
                  { type: 'text', text: 'Does this NDA plausibly involve the parties named in the system prompt?' },
                ]
              : [{ type: 'text', text: `This NDA file (${fileName ?? 'unknown'}) is not a PDF — the content could not be read directly. Report match_status "uncertain".` }],
          }],
          tools: [{
            name: 'report_match',
            description: 'Report whether the NDA parties match.',
            input_schema: {
              type: 'object',
              properties: {
                match_status: { type: 'string', enum: ['match', 'mismatch', 'uncertain'] },
                notes: { type: 'string', description: 'One short sentence explaining the verdict.' },
              },
              required: ['match_status', 'notes'],
            },
          }],
          tool_choice: { type: 'tool', name: 'report_match' },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
        const result = toolUse?.input as { match_status?: NdaMatchStatus; notes?: string } | undefined;
        if (result?.match_status) { match_status = result.match_status; match_notes = result.notes; }
      } else {
        console.error('AI NDA cross-check provider error:', (await res.text()).slice(0, 300));
      }
    } catch (e) {
      console.error('AI NDA cross-check failed:', (e as Error).message);
    }
  } else {
    match_notes = 'AI cross-check isn’t available in this workspace — verify manually.';
  }

  const { data: row, error } = await admin.from('ndas').insert({
    org_id: orgId, person_id: personId ?? null, entity_id: resolvedEntityId ?? null, grantee_email: granteeEmail ?? null,
    storage_path: storagePath, file_name: fileName ?? null, uploaded_by: user.email ?? null,
    match_status, match_notes: match_notes ?? null,
  }).select().single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Unlock: every active nda_required grant for this grantee that hasn't
  // already been accepted gets stamped now — regardless of the match
  // verdict above (never a block; the founder decides).
  const orParts: string[] = [];
  if (personId) orParts.push(`person_id.eq.${personId}`);
  if (granteeEmail) orParts.push(`grantee_email.eq.${granteeEmail}`);
  let unlockedGrantIds: string[] = [];
  if (orParts.length) {
    const { data: unlocked } = await admin.from('access_grants')
      .update({ nda_accepted_at: new Date().toISOString() })
      .eq('org_id', orgId).eq('nda_required', true).is('nda_accepted_at', null).is('revoked_at', null)
      .or(orParts.join(',')).select('id');
    unlockedGrantIds = (unlocked ?? []).map((g) => g.id as string);
  }

  return NextResponse.json({ ok: true, nda: row, unlockedGrantIds });
}
