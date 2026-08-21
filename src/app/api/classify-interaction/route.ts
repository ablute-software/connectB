// Prompt 208 §D.2 — classificar uma resposta recebida com AI.
//
// Serve os dois caminhos: o momento do log (conteúdo colado, ainda sem
// interação gravada) e o retroactivo (uma interação que já existe). Por isso
// aceita `content` directamente — a rota nunca precisa de saber qual é.
//
// Fora da quota Watson de propósito (decisão do Nuno): o gate é a presença
// da ANTHROPIC_API_KEY. Contar isto contra a quota de *drafts* misturava
// duas coisas diferentes no mesmo contador — e classificar é barato.
// Modelo próprio: AI_CLASSIFY_MODEL, default claude-haiku-4-5.
import { NextResponse, type NextRequest } from 'next/server';
import { buildClassifyPrompt, parseClassifyResponse, CLASSIFY_MODEL_DEFAULT } from '@/lib/classify-ai';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { logAiCall } from '@/lib/ai-cost-log';

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // `configured: false` e não um erro: sem chave o /log continua a exigir
  // classificação manual, que é o comportamento normal, não uma avaria.
  if (!apiKey) return NextResponse.json({ configured: false });

  // Só um utilizador autenticado gasta a nossa chave. Sem isto, a rota era
  // um proxy aberto para a API do Anthropic à conta do projecto.
  // Prompt 293 §1 — org_id also resolved here now (it wasn't before): this
  // is a per-org call (classifying THIS founder's own interaction), never
  // shared-catalog work, so it must never log as org_id=null (that would
  // misreport it as platform-shared cost in the AI Costs tab).
  let orgId: string | null = null;
  if (authEnabled) {
    const sb = await serverClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
    orgId = (member?.org_id as string | undefined) ?? null;
  }

  const body = await req.json().catch(() => ({})) as { content?: string };
  const content = (body.content ?? '').trim();
  if (content.length < 20) return NextResponse.json({ configured: true, suggestion: null });

  const model = process.env.AI_CLASSIFY_MODEL ?? CLASSIFY_MODEL_DEFAULT;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [{ role: 'user', content: buildClassifyPrompt(content.slice(0, 6000)) }],
      }),
    });
    if (!res.ok) {
      // O corpo do erro vai para o log, NUNCA para a resposta: pode trazer
      // detalhe da chave/conta.
      console.error('[classify-interaction] provider error:', (await res.text()).slice(0, 300));
      return NextResponse.json({ configured: true, suggestion: null });
    }
    const data = await res.json();
    void logAiCall({ route: '/api/classify-interaction', purpose: 'classify_interaction', model, usage: data.usage, orgId });
    const text = (data.content as { type: string; text?: string }[] | undefined)
      ?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('') ?? '';
    return NextResponse.json({ configured: true, suggestion: parseClassifyResponse(text) });
  } catch (e) {
    console.error('[classify-interaction] failed:', (e as Error).message);
    // Falhar a classificar nunca pode partir o fluxo: o founder classifica
    // à mão, que é o caminho que já existia.
    return NextResponse.json({ configured: true, suggestion: null });
  }
}
