// IRM_SPEC §9b — AI extraction of an uploaded history file into structured
// people/entities/interactions, each with a confidence score. Text formats
// only for this pass (.txt/.csv) — .xlsx/.docx need a binary parser and the
// one available on npm (xlsx/SheetJS) has unpatched high-severity CVEs, so
// it's deliberately not added; revisit once real example files show what's
// actually needed (see DECISIONS.md).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';

const MAX_CHARS = 20_000; // token-budget guard; chunking is a future enhancement

const TEXT_EXTENSIONS = ['.txt', '.csv'];

export async function POST(req: NextRequest) {
  const { batchId } = await req.json();
  if (!batchId) return NextResponse.json({ ok: false, error: 'batchId required' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: batch, error: batchErr } = await admin.from('import_batches').select('*').eq('id', batchId).single();
  if (batchErr || !batch) return NextResponse.json({ ok: false, error: batchErr?.message ?? 'batch not found' }, { status: 404 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', batch.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const ext = batch.file_name.slice(batch.file_name.lastIndexOf('.')).toLowerCase();
  if (!TEXT_EXTENSIONS.includes(ext)) {
    await admin.from('import_batches').update({ status: 'failed', error: `${ext} isn't supported yet — only .txt/.csv for now. Export to CSV/plain text and retry.` }).eq('id', batchId);
    return NextResponse.json({ ok: false, error: `${ext} isn't supported yet — only .txt/.csv for now. Export to CSV/plain text and retry.` });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: 'Set ANTHROPIC_API_KEY in the environment to enable extraction.' });

  await admin.from('import_batches').update({ status: 'extracting' }).eq('id', batchId);

  try {
    const { data: fileBlob, error: dlErr } = await admin.storage.from('data-room').download(batch.storage_path);
    if (dlErr || !fileBlob) throw new Error(dlErr?.message ?? 'download failed');
    const text = (await fileBlob.text()).slice(0, MAX_CHARS);

    const prompt = [
      'Extract structured investor-outreach history from this file. Never silently guess identities — if you are',
      'not confident who a person/entity is, still include them but with a low confidence score and a short note',
      'explaining the ambiguity (e.g. "only first name \'David\' mentioned, no company given").',
      '',
      'FILE CONTENT:',
      text,
      '',
      'Return people[] (name, role, entity_name — which fund/company they belong to, phones[], emails[], linkedin_url),',
      'entities[] (name, website, emails[]), and interactions[] (date ISO8601 if possible, channel',
      '[linkedin_dm|linkedin_note|email|web_form|call|meeting|event|intro], direction [out|in], person_name, entity_name,',
      'summary, outcome, followup_marker), each with a confidence 0-1.',
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 4000,
        system: 'You extract structured records from messy founder-kept investor-outreach notes. You never invent facts not in the text. You always finish by calling extract_history.',
        messages: [{ role: 'user', content: prompt }],
        tools: [{
          name: 'extract_history',
          description: 'Return the extracted people, entities, and interactions.',
          input_schema: {
            type: 'object',
            properties: {
              people: { type: 'array', items: { type: 'object', properties: {
                name: { type: 'string' }, role: { type: 'string' }, entity_name: { type: 'string', description: 'the fund/company this person belongs to, if determinable' },
                phones: { type: 'array', items: { type: 'string' } },
                emails: { type: 'array', items: { type: 'string' } }, linkedin_url: { type: 'string' },
                confidence: { type: 'number' }, note: { type: 'string' },
              }, required: ['name', 'confidence'] } },
              entities: { type: 'array', items: { type: 'object', properties: {
                name: { type: 'string' }, website: { type: 'string' }, emails: { type: 'array', items: { type: 'string' } },
                confidence: { type: 'number' }, note: { type: 'string' },
              }, required: ['name', 'confidence'] } },
              interactions: { type: 'array', items: { type: 'object', properties: {
                date: { type: 'string' }, channel: { type: 'string' }, direction: { type: 'string', enum: ['out', 'in'] },
                person_name: { type: 'string' }, entity_name: { type: 'string' }, summary: { type: 'string' },
                outcome: { type: 'string' }, followup_marker: { type: 'string' }, confidence: { type: 'number' },
              }, required: ['direction', 'summary', 'confidence'] } },
            },
            required: ['people', 'entities', 'interactions'],
          },
        }],
        tool_choice: { type: 'tool', name: 'extract_history' },
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a structured extraction.');

    await admin.from('import_batches').update({ status: 'staged', extraction: toolUse.input }).eq('id', batchId);
    return NextResponse.json({ ok: true, configured: true, extraction: toolUse.input });
  } catch (e) {
    await admin.from('import_batches').update({ status: 'failed', error: (e as Error).message }).eq('id', batchId);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
