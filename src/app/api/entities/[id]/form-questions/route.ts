// Prompt 265 §3/§7/§8 — auto-extracts an investor's web-submission-form
// question list from its URL, for the /log page's Web form assistant panel.
// Founder-facing, org-scoped (same shape as .../enrich): any org member may
// trigger this for their own entity.
//
// Real, tested finding (against the prompt's own Karista.vc example) that
// shapes this whole route: most "submit your pitch" pages are thin wrappers
// embedding a third-party form widget (Typeform, Kushim/Edda, Airtable,
// Google Forms) whose actual fields are rendered client-side by JavaScript —
// invisible to a plain web_fetch. A single forced tool-call attempt
// (tool_choice: {type:'tool', name:'extract_form_questions'}) was found to
// SKIP fetching entirely and confabulate a plausible-sounding wrong answer
// (it once guessed "Airtable" for a page that was actually Kushim/Edda,
// having never fetched anything). Fixed with a two-step call instead:
//   1. tool_choice: {type:'any'}, ONLY web_fetch offered — forces at least
//      one real fetch; the model is instructed to chase a same-domain-
//      mismatch embed URL within this same turn, and often does (chained
//      3 real fetches in testing, unprompted per-call).
//   2. A follow-up turn in the SAME conversation (step 1's real fetch
//      results included verbatim), tool_choice forced to
//      extract_form_questions — now grounded in whatever was actually
//      fetched. When the real fields are JS-rendered and unreachable, this
//      step reliably reports an EMPTY list with an honest `note` instead of
//      guessing — confirmed against the real Karista page.
// Never silently returns generic/invented fields — empty + explanation is
// the correct output when extraction genuinely isn't possible, same
// "drop rather than guess" principle as entity-enrichment.ts.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { catalogFormQuestionsAvailable } from '@/lib/form-questions-capability';
import { logAiCall } from '@/lib/ai-cost-log';

const NOT_CONFIGURED_MSG = 'Form question extraction isn’t available in your workspace yet — paste the questions yourself instead.';

interface ExtractedQuestion { label: string; type?: string }

async function anthropicCall(apiKey: string, model: string, body: Record<string, unknown>, orgId: string | null) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-fetch-2025-09-10', 'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 2000, ...body }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  void logAiCall({ route: '/api/entities/[id]/form-questions', purpose: 'form_questions_extract', model, usage: data.usage, orgId });
  return data;
}

const EXTRACT_SYSTEM = 'You extract the list of distinct question/field labels from an investor submission web form, '
  + 'given its URL. Fetch the URL and read the actual form fields. Many investor "submit your pitch" pages are just a '
  + 'thin wrapper embedding a third-party form widget (Typeform, Kushim/Edda, Airtable, Google Forms, etc.) via an '
  + 'iframe or a bare link to a different domain — if the page you fetch is one of those, fetch the embedded form\'s '
  + 'own URL too, in the same turn, before you stop. If the real fields are loaded dynamically by JavaScript and are '
  + 'not present in the fetched text, you will not be able to see them — never guess or invent generic fields as a '
  + 'substitute for what you couldn\'t read.';

async function extractFormQuestions(apiKey: string, model: string, url: string, orgId: string | null): Promise<{ questions: ExtractedQuestion[]; note?: string }> {
  const step1 = await anthropicCall(apiKey, model, {
    system: EXTRACT_SYSTEM,
    messages: [{ role: 'user', content: `Investigate this form URL and its content: ${url}` }],
    tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5 }],
    tool_choice: { type: 'any' },
  }, orgId);

  const toolSchema = {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'One entry per distinct question/field actually read from the fetched page(s), in form order.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            type: { type: 'string', description: 'best guess, e.g. text, textarea, email, url, select, file' },
          },
          required: ['label'],
        },
      },
      note: { type: 'string', description: 'Required when questions is empty — explain exactly what happened (e.g. fields load via JavaScript).' },
    },
    required: ['questions'],
  };

  const step2 = await anthropicCall(apiKey, model, {
    system: EXTRACT_SYSTEM,
    messages: [
      { role: 'user', content: `Investigate this form URL and its content: ${url}` },
      { role: 'assistant', content: step1.content },
      { role: 'user', content: 'Based on everything you just fetched, report the form questions now.' },
    ],
    tools: [{ name: 'extract_form_questions', description: 'Report the extracted form questions.', input_schema: toolSchema }],
    tool_choice: { type: 'tool', name: 'extract_form_questions' },
  }, orgId);

  const toolUse = (step2.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  if (!toolUse) return { questions: [], note: 'Extraction failed — try again in a moment.' };
  const out = toolUse.input as { questions?: ExtractedQuestion[]; note?: string };
  return { questions: (out.questions ?? []).filter((q) => q.label?.trim()), note: out.note };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: entity, error: entityErr } = await admin.from('entities').select('id, org_id, submission_channel, submission_channel_type').eq('id', id).maybeSingle();
  if (entityErr || !entity) return NextResponse.json({ ok: false, error: entityErr?.message ?? 'Entity not found.' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { url?: string; refresh?: boolean };
  const requestedUrl = body.url?.trim() || undefined;

  // Resolve this entity to its shared catalog identity, if any — only
  // catalog-sourced entities (source:'catalog'/delivered via a pack) have a
  // catalog_deliveries row; a manually-typed entity has no reliable link
  // (see deal-messages.ts's own comment on this), and simply doesn't
  // participate in the shared cache — extraction still works, just always
  // fresh, never cached/shared.
  const cacheAvailable = await catalogFormQuestionsAvailable();
  let catalogId: string | null = null;
  if (cacheAvailable) {
    const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('entity_id', id).maybeSingle();
    catalogId = (delivery?.catalog_id as string | undefined) ?? null;
  }

  // No URL given, and this entity has never saved one: offer whatever the
  // shared catalog cache already has (another org's prior extraction) as a
  // SUGGESTION only — never silently written onto this founder's own
  // entity. The client shows it as "found from another startup" and only
  // saves it here once the founder explicitly confirms/uses it (a normal
  // follow-up call with url set).
  if (!requestedUrl && !entity.submission_channel && catalogId) {
    const { data: cached } = await admin.from('catalog_form_questions').select('form_url, questions, extracted_at').eq('catalog_id', catalogId).maybeSingle();
    if (cached) {
      return NextResponse.json({
        ok: true, source: 'community', url: cached.form_url, questions: cached.questions,
        extractedAt: cached.extracted_at,
      });
    }
  }

  const effectiveUrl = requestedUrl ?? entity.submission_channel ?? undefined;
  if (!effectiveUrl) return NextResponse.json({ ok: false, error: 'No form URL yet — paste one first.' }, { status: 400 });

  // A URL was explicitly given (typed, pasted, or a community suggestion
  // the founder confirmed): save it as this entity's own official channel.
  if (requestedUrl && requestedUrl !== entity.submission_channel) {
    await admin.from('entities').update({ submission_channel: requestedUrl, submission_channel_type: 'form' }).eq('id', id);
  }

  // Reuse the shared cache when it already covers this exact URL and a
  // refresh wasn't explicitly requested — the whole point of §7 is a
  // startup that's already been through this for the same investor spends
  // no AI call at all.
  if (!body.refresh && catalogId) {
    const { data: cached } = await admin.from('catalog_form_questions').select('form_url, questions, extracted_at').eq('catalog_id', catalogId).eq('form_url', effectiveUrl).maybeSingle();
    if (cached) {
      return NextResponse.json({ ok: true, source: 'cached', url: effectiveUrl, questions: cached.questions, extractedAt: cached.extracted_at });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: NOT_CONFIGURED_MSG, url: effectiveUrl });

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    // Prompt 293 §1 — null (shared-catalog) when this result gets cached
    // for every future org via catalog_form_questions; this org's own id
    // otherwise (a manually-typed, non-catalog entity never shares).
    const { questions, note } = await extractFormQuestions(apiKey, model, effectiveUrl, catalogId ? null : (entity.org_id as string));

    if (questions.length > 0 && catalogId) {
      await admin.from('catalog_form_questions').upsert(
        { catalog_id: catalogId, form_url: effectiveUrl, questions, extracted_at: new Date().toISOString() },
        { onConflict: 'catalog_id' },
      );
    }

    return NextResponse.json({ ok: true, configured: true, source: 'fresh', url: effectiveUrl, questions, note });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
