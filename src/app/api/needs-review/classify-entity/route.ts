// Needs-review redesign — one AI call per entity dossier, batched from the
// client in a loop exactly like /api/import/md/extract-people (one round
// trip per unit of work so the UI can show real progress across ~111
// entities). Only ever called for interactions the deterministic mechanical
// pass (needs-review-logic.ts) couldn't already resolve for free — see the
// client's cost-guard loop in /needs-review.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import type { Channel, Classification, Direction } from '@/lib/types';

interface InputInteraction { id: string; direction: Direction; channel: Channel; content: string; occurredAt: string }
interface AiProposal {
  interactionId: string;
  kind: 'metadata_card' | 'interaction';
  proposedClassification?: Classification;
  directionCorrection?: Direction;
  channelCorrection?: Channel;
  confidence: 'high' | 'low';
  reason: string;
}

const CLASSIFICATIONS: Classification[] = ['awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear'];
const CHANNELS: Channel[] = ['linkedin_dm', 'linkedin_note', 'email', 'web_form', 'call', 'meeting', 'event', 'intro', 'stage_change'];

export async function POST(req: NextRequest) {
  const { entityId, interactions } = await req.json() as { entityId?: string; interactions?: InputInteraction[] };
  if (!entityId || !interactions?.length) {
    return NextResponse.json({ ok: false, error: 'entityId and interactions required' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: entity, error: entityErr } = await admin.from('entities').select('org_id, name').eq('id', entityId).single();
  if (entityErr || !entity) return NextResponse.json({ ok: false, error: entityErr?.message ?? 'entity not found' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: true, configured: false, message: 'AI pre-classification isn’t available in your workspace yet — review manually below.' });
  }

  const text = interactions
    .map((i) => `[${i.id}] (${i.direction === 'out' ? 'outbound' : 'inbound'}, ${i.channel}, ${i.occurredAt.slice(0, 10)}) ${i.content}`.slice(0, 1200))
    .join('\n---\n')
    .slice(0, 8000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 1500,
        system: `You are triaging imported historical investor-outreach interactions for the fund "${entity.name}" so a founder can confirm what actually happened. `
          + 'Each interaction is EITHER a real outreach interaction, OR a contact-details card (someone’s auto-reply/signature/contact-form confirmation containing an email, phone, address, or website — not a real outreach signal). '
          + `For each, decide "kind": "metadata_card" or "interaction". For "interaction", propose the most likely classification from: ${CLASSIFICATIONS.join(', ')}. `
          + 'Only mark confidence "high" when you are quite sure — a wrong auto-applied classification is worse than leaving it for human review; default to "low" whenever the text is ambiguous, off-topic, or too short to tell. '
          + 'Only propose directionCorrection/channelCorrection when the given value looks evidently wrong given the text. Never invent facts not in the text. '
          + 'Always finish by calling propose_classifications, with exactly one entry per interaction id given, using the exact ids provided.',
        messages: [{ role: 'user', content: text }],
        tools: [{
          name: 'propose_classifications',
          description: 'Return one classification proposal per interaction id.',
          input_schema: {
            type: 'object',
            properties: {
              proposals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    interactionId: { type: 'string' },
                    kind: { type: 'string', enum: ['metadata_card', 'interaction'] },
                    proposedClassification: { type: 'string', enum: CLASSIFICATIONS },
                    directionCorrection: { type: 'string', enum: ['out', 'in'] },
                    channelCorrection: { type: 'string', enum: CHANNELS },
                    confidence: { type: 'string', enum: ['high', 'low'] },
                    reason: { type: 'string', description: 'One short sentence.' },
                  },
                  required: ['interactionId', 'kind', 'confidence', 'reason'],
                },
              },
            },
            required: ['proposals'],
          },
        }],
        tool_choice: { type: 'tool', name: 'propose_classifications' },
      }),
    });
    if (!res.ok) {
      console.error('AI needs-review classification provider error:', (await res.text()).slice(0, 300));
      throw new Error('AI pre-classification failed for this entity — try again in a moment.');
    }
    const data = await res.json();
    const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
    const proposals = (toolUse?.input as { proposals?: AiProposal[] } | undefined)?.proposals ?? [];
    return NextResponse.json({ ok: true, configured: true, proposals });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
