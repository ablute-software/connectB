// TEMA A completeness: "nomes de pessoas mencionadas" — the source text is
// free-flowing Portuguese prose (no structured person column, unlike the
// CSV pack), so regex extraction would be unreliable. One Claude call per
// entity section proposes candidate people with a confidence + evidence
// quote; nothing is trusted automatically — every proposal is reviewed in
// staging exactly like the rest of this importer. Called once per section
// from the client in a loop (idempotent — overwrites that section's
// proposals each time), so the UI can show real progress across ~111
// sections instead of one long opaque call.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

interface ProposedPerson { name: string; role?: string; confidence: number; evidence: string }

export async function POST(req: NextRequest) {
  const { batchId, sectionIndex } = await req.json() as { batchId?: string; sectionIndex?: number };
  if (!batchId || sectionIndex === undefined) return NextResponse.json({ ok: false, error: 'batchId and sectionIndex required' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: batch, error: batchErr } = await admin.from('import_batches').select('org_id, extraction').eq('id', batchId).single();
  if (batchErr || !batch) return NextResponse.json({ ok: false, error: batchErr?.message ?? 'batch not found' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', batch.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const extraction = batch.extraction as { sections: { name: string; interactions: { text: string }[]; proposedPeople?: ProposedPerson[] }[] };
  const section = extraction?.sections?.[sectionIndex];
  if (!section) return NextResponse.json({ ok: false, error: 'sectionIndex out of range' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: 'AI-assisted people detection isn’t available in your workspace yet — the rest of the import works without it.' });

  const text = section.interactions.map((i) => i.text).join('\n').slice(0, 6000);
  if (!text.trim()) {
    section.proposedPeople = [];
    await admin.from('import_batches').update({ extraction }).eq('id', batchId);
    return NextResponse.json({ ok: true, configured: true, proposedPeople: [] });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: `You extract named individuals mentioned in messy Portuguese founder outreach notes about the fund "${section.name}". `
          + 'Only real personal names (not company names, not generic titles) — skip anyone you are not reasonably confident about. '
          + 'Never invent a name not in the text. Always finish by calling propose_people, with an empty array if none.',
        messages: [{ role: 'user', content: text }],
        tools: [{
          name: 'propose_people',
          description: 'Return the people mentioned in this text.',
          input_schema: {
            type: 'object',
            properties: {
              people: { type: 'array', items: { type: 'object', properties: {
                name: { type: 'string' }, role: { type: 'string', description: 'their apparent role/title, if stated' },
                confidence: { type: 'number' }, evidence: { type: 'string', description: 'short quote from the text naming them' },
              }, required: ['name', 'confidence', 'evidence'] } },
            },
            required: ['people'],
          },
        }],
        tool_choice: { type: 'tool', name: 'propose_people' },
      }),
    });
    if (!res.ok) {
      console.error('AI people-detection provider error:', (await res.text()).slice(0, 300));
      throw new Error('AI-assisted people detection failed for this section — try again in a moment.');
    }
    const data = await res.json();
    const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
    const proposedPeople = (toolUse?.input as { people?: ProposedPerson[] } | undefined)?.people ?? [];

    section.proposedPeople = proposedPeople;
    const { error } = await admin.from('import_batches').update({ extraction }).eq('id', batchId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, configured: true, proposedPeople });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
