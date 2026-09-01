// Prompt 512 — a founder adds a person to an investor firm's team, with a
// link that shows that person's role there. Sherlock validates the link and,
// if it holds up, the person joins the SHARED catalog layer immediately —
// no human review queue.
//
// That last part deliberately breaks this codebase's own norm. Every other
// founder-proposed write (ContributionBox / the `contributions` table)
// requires an Accept click even for AI-generated rows. Nuno's instruction is
// explicit that this one does not: "se validado pela AI estes contacto não
// precisam de mais qualquer validação humana". Recorded as the conscious
// departure it is. What stands in for the human click:
//   - the page is fetched through the SSRF-safe gate, not by the model
//   - the model must cite what it saw, and every claim it makes is
//     re-checked against the page text before it counts
//   - a field that fails validation is founder feedback only; it never
//     reaches catalog_people / catalog_person_affiliations at all
//   - the write goes through contribute_catalog_person, which can only
//     award 1 point per validated field alongside a real catalog row
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { fetchExternalPage } from '@/lib/safe-external-fetch';
import {
  PERSON_VALIDATION_SYSTEM, PERSON_VALIDATION_TOOL_SCHEMA, toPersonValidationVerdict,
} from '@/lib/contribute-person-validation';

export const maxDuration = 60;

const ROUTE = '/api/entities/[id]/contribute-person';
// Enough of the page for a team listing; the fetch layer already caps bytes,
// this caps what the model is billed for.
const MAX_PAGE_CHARS = 20000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) {
    return NextResponse.json({ ok: false, error: 'Not available yet.' }, { status: 200 });
  }

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const body = await req.json().catch(() => ({})) as {
    fullName?: string; title?: string; sourceUrl?: string; linkedinUrl?: string;
  };
  const fullName = (body.fullName ?? '').trim();
  const title = (body.title ?? '').trim() || null;
  const sourceUrl = (body.sourceUrl ?? '').trim();
  if (!fullName) return NextResponse.json({ ok: false, error: 'A name is required.' }, { status: 400 });
  if (!sourceUrl) return NextResponse.json({ ok: false, error: 'A link showing their role is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // The entity must belong to the caller's org — read through the USER's
  // client, so RLS does the ownership check rather than a hand-written one.
  const { data: entity } = await sb.from('entities')
    .select('id, name, org_id').eq('id', params.id).maybeSingle();
  if (!entity || entity.org_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Investor not found.' }, { status: 404 });
  }

  // The contribution targets the SHARED catalog row, not the private entity:
  // that is what makes it visible in every other founder's dossier.
  const { data: delivery } = await admin.from('catalog_deliveries')
    .select('catalog_id').eq('org_id', orgId).eq('entity_id', params.id).maybeSingle();
  const catalogEntityId = delivery?.catalog_id as string | undefined;
  if (!catalogEntityId) {
    return NextResponse.json({
      ok: false,
      error: 'This investor is not linked to the shared catalog yet, so a contribution has nowhere to land.',
    }, { status: 409 });
  }

  const page = await fetchExternalPage(sourceUrl);
  if (!page.ok) return NextResponse.json({ ok: false, error: page.reason }, { status: 400 });

  const pageText = page.text.slice(0, MAX_PAGE_CHARS);
  const userText = [
    DOCUMENT_CONTENT_INSTRUCTION,
    '',
    `Investor firm: ${entity.name}`,
    `Submitted person: ${fullName}`,
    `Submitted role: ${title ?? '(none given)'}`,
    `Page URL: ${page.finalUrl}`,
    '',
    wrapDocumentContent(pageText),
    '',
    'Decide whether this page confirms this person in this role at this firm, and report it.',
  ].join('\n');

  let verdict;
  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 1000, system: PERSON_VALIDATION_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        tools: [{
          name: 'report_person_validation',
          description: 'Report whether the page confirms this person and role at this firm.',
          input_schema: PERSON_VALIDATION_TOOL_SCHEMA,
        }],
        // Forced, not 'auto': this route has exactly one useful output shape,
        // and a prose answer would have to be parsed back into it.
        tool_choice: { type: 'tool', name: 'report_person_validation' },
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: providerErrorMessage(`[${ROUTE}]`, await res.text()) }, { status: 502 },
      );
    }
    const data = await res.json();
    await logAiCall({ route: ROUTE, purpose: 'contribute_person_validation', model, usage: data.usage, orgId });
    const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
      .filter((b) => b.type === 'tool_use' && b.name === 'report_person_validation').pop();
    verdict = toPersonValidationVerdict(toolUse?.input, {
      submittedName: fullName, submittedTitle: title, pageText,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  // Nothing validated — the founder gets told why, and the shared catalog is
  // not touched at all. Explicitly NOT queued for review: the prompt puts a
  // human review queue out of scope, so a rejected field simply ends here.
  if (verdict.pointsAwarded === 0) {
    return NextResponse.json({
      ok: true, accepted: false, pointsAwarded: 0,
      rejections: verdict.rejections, reasoning: verdict.reasoning,
    });
  }

  const { data: written, error: writeErr } = await admin.rpc('contribute_catalog_person', {
    p_org_id: orgId,
    p_user_id: user.id,
    p_catalog_entity_id: catalogEntityId,
    p_full_name: verdict.nameOnPage ?? fullName,
    p_source_url: page.finalUrl,
    // English is the platform's only language, so the English rendering is
    // what the shared catalog stores; the original wording stays in the
    // source row's own trail.
    p_title: verdict.titleValidated ? (verdict.titleEnglish ?? verdict.titleOnPage) : null,
    p_kind: verdict.affiliationKind,
    p_linkedin_url: (body.linkedinUrl ?? '').trim() || null,
    p_award_name: verdict.nameValidated,
    p_award_title: verdict.titleValidated,
  });
  if (writeErr) return NextResponse.json({ ok: false, error: writeErr.message }, { status: 500 });

  const result = (written ?? {}) as { person_id?: string; points_awarded?: number; balance?: number };
  return NextResponse.json({
    ok: true,
    accepted: true,
    personId: result.person_id ?? null,
    pointsAwarded: result.points_awarded ?? verdict.pointsAwarded,
    balance: result.balance ?? 0,
    validated: {
      name: verdict.nameValidated ? (verdict.nameOnPage ?? fullName) : null,
      title: verdict.titleValidated ? (verdict.titleEnglish ?? verdict.titleOnPage) : null,
      originalTitle: verdict.titleOnPage,
      detectedLanguage: verdict.detectedLanguage,
    },
    rejections: verdict.rejections,
    reasoning: verdict.reasoning,
  });
}
