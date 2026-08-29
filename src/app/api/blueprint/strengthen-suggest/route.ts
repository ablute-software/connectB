// Prompt 358 §3.4 — "each item brings the strongest rewrite ALREADY
// proposed by Watson." Grounded in exactly what company-knowledge-db.ts
// already reads (accepted claims, team profiles, document extractions) —
// same closed, privacy-clean source list as gap-assist's own 'draft' role.
// Never invents a name/date/outcome not present in that context; says so
// plainly (sufficient:false) rather than guessing, same discipline as
// gap-assist and reconciliation.ts.
//
// Prompt 365 — orgKnowledgeText used to NEVER actually include accepted
// claims, despite this file's own header comment claiming it did: the
// exact data that fills most gaps ("2022 — WomenTechEU prize" already
// accepted as a roadmap claim, the missing YEAR for "Carla Dias is a
// WomenTechEU awardee") lives in company_claims, not in company_people or
// document_extractions — the two sources this function actually queried.
// `claims` was already fetched by the caller (to find the target claim
// itself) and simply never passed in. Confirmed live against ablute_'s real
// data before this fix: every one of 6 "Strengthen your claims" items came
// back "insufficient", including the Carla Dias fixture, because the model
// was telling the truth about what it was given — the given context was
// just incomplete by construction.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { claimsAvailable } from '@/lib/blueprint-capability';
import { readExistingClaims } from '@/lib/company-knowledge-db';
import { strengthenGaps, type StrengthenDimension } from '@/lib/company-claims';
import type { CompanyClaim } from '@/lib/types';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';

const DIMENSION_LABEL: Record<StrengthenDimension, string> = {
  who: 'exactly who is named', when: 'a date or year', outcome: 'a concrete outcome (signed, agreed, deployed, etc.)',
};

// targetClaimId is excluded so the claim never "confirms itself" — the
// model must find the missing detail SOMEWHERE ELSE on file, not just be
// handed its own unchanged statement back as if that were new information.
async function orgKnowledgeText(admin: SupabaseClient, orgId: string, allClaims: CompanyClaim[], targetClaimId: string): Promise<string> {
  const [{ data: people }, { data: extractions }] = await Promise.all([
    admin.from('company_people').select('full_name, title, bio').eq('org_id', orgId),
    admin.from('document_extractions').select('extracted').eq('org_id', orgId).eq('status', 'completed'),
  ]);
  const lines: string[] = [];
  for (const c of allClaims) {
    if (c.id === targetClaimId || c.status !== 'accepted') continue;
    lines.push(`Confirmed fact [${c.category}]: ${c.statement}`);
  }
  for (const p of (people ?? []) as { full_name: string; title: string | null; bio: string | null }[]) {
    lines.push(`Team: ${p.full_name}${p.title ? `, ${p.title}` : ''}.${p.bio ? ` ${p.bio}` : ''}`);
  }
  for (const e of (extractions ?? []) as { extracted: Record<string, unknown> }[]) {
    const ex = e.extracted;
    for (const prog of (ex.programs as { name: string }[] | undefined) ?? []) lines.push(`Document program/award: ${prog.name}`);
    for (const ent of (ex.namedEntities as { name: string; kind: string }[] | undefined) ?? []) lines.push(`Document named: ${ent.name} (${ent.kind})`);
    for (const d of (ex.dates as { label: string; date: string }[] | undefined) ?? []) lines.push(`Document date: ${d.label}: ${d.date}`);
  }
  return lines.join('\n');
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await claimsAvailable())) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });

  const { claimId } = await req.json().catch(() => ({})) as { claimId?: string };
  if (!claimId) return NextResponse.json({ ok: false, error: 'Missing claimId.' }, { status: 400 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const claims = await readExistingClaims(admin, orgId);
  const claim = claims.find((c) => c.id === claimId);
  if (!claim) return NextResponse.json({ ok: false, error: 'Claim not found.' }, { status: 404 });

  const missing = strengthenGaps(claim);
  if (!missing) return NextResponse.json({ ok: false, error: 'This claim is already specific — nothing to strengthen.' });

  const missingLabels = missing.map((d) => DIMENSION_LABEL[d]).join(', ');
  const knowledge = await orgKnowledgeText(admin, orgId, claims, claimId);
  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';

  const system = 'You rewrite ONE startup founder claim to add specific missing details, using ONLY the company '
    + 'knowledge given. Never invent a name, date, or outcome not present in that knowledge. If the knowledge given '
    + 'doesn\'t actually contain what\'s missing, say so (sufficient:false) rather than guessing. Keep the rest of the '
    + 'claim\'s own meaning and tone — you are filling a specific gap, not rewriting the whole sentence. '
    + DOCUMENT_CONTENT_INSTRUCTION;
  const userText = `Original claim: "${claim.statement}"\n\nMissing: ${missingLabels}.\n\n`
    + `Company knowledge on file:\n${wrapDocumentContent(knowledge || '(none)')}\n\n`
    + 'Return the strongest rewrite you can support, or say it\'s insufficient.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 400, system,
        messages: [{ role: 'user', content: userText }],
        tools: [{
          name: 'propose_rewrite',
          description: 'Return the rewritten claim or say it is insufficient.',
          input_schema: {
            type: 'object',
            properties: { sufficient: { type: 'boolean' }, rewrite: { type: 'string' } },
            required: ['sufficient', 'rewrite'],
          },
        }],
        tool_choice: { type: 'tool', name: 'propose_rewrite' },
      }),
    });
    if (!res.ok) throw new Error(providerErrorMessage('[strengthen-suggest]', await res.text()));
    const data = await res.json();
    // fire-and-forget-ok: logAiCall's own contract (ai-cost-log.ts) is fire-and-forget by design — errors are swallowed there, and a dropped cost-log entry never corrupts state, unlike reconciliation.
    void logAiCall({ route: '/api/blueprint/strengthen-suggest', purpose: 'strengthen_suggest', model, usage: data.usage, orgId, targetType: 'claim', targetId: claimId });
    const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
    const output = (toolUse?.input ?? {}) as { sufficient?: boolean; rewrite?: string };
    if (!output.sufficient || !output.rewrite?.trim()) {
      return NextResponse.json({ ok: true, rewrite: null, message: 'Nothing on file yet fills this in — you\'ll need to add it yourself.' });
    }
    return NextResponse.json({ ok: true, rewrite: output.rewrite.trim() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
