import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 706 Bloco B.3/E.1 — "confirmar por grep exaustivo que não ficou
// nenhuma rota sem a chamada a chargeAiAction." The RPC's own correctness
// (is_test/is_internal exemption, the exact-limit boundary, the disabled-
// action lockout, the lazy reset persisting BOTH columns together even on
// a refused call) was verified live against production via BEGIN/ROLLBACK
// transactions — see this session's own report for the exact assertions
// and results; that isn't repeated here since it needs a real Postgres
// connection, not a unit test. What a unit test CAN do, and must keep
// doing on every future edit to these 15 route files, is confirm the
// wiring itself never quietly regresses: every one of the 18 ai_actions
// keys has a chargeAiAction(...) call in its route, positioned before that
// route's own real model call, not after it and not missing entirely. A
// route edited later without this test breaking is a route this feature
// silently stopped protecting — the exact failure mode
// blueprint_analyses.consumed_kind already proved this codebase is capable
// of (a column that looked like it tracked something and never did).
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// action key -> [route file, the string that marks where the real AI call
// begins in that file]. Where a helper function centralizes the fetch
// (gap-assist's callClaude, entities/enrich's callClaude, mini-pitch's
// synthesizeSlides, market-thesis/hypotheses' fetch, etc.), the marker is
// the call site closest to the charge, not the helper's own internal fetch
// — chargeAiAction only needs to run before THAT call site is reached.
const ROUTES: { actionKey: string; file: string; beforeMarker: string }[] = [
  { actionKey: 'investability_report', file: 'src/app/api/review/investability/route.ts', beforeMarker: "fetch('https://api.anthropic.com/v1/messages'" },
  { actionKey: 'strengthen_suggest', file: 'src/app/api/blueprint/strengthen-suggest/route.ts', beforeMarker: "fetch('https://api.anthropic.com/v1/messages'" },
  { actionKey: 'blueprint_gap_polish', file: 'src/app/api/blueprint/gap-assist/route.ts', beforeMarker: "name: 'polish_answer'" },
  { actionKey: 'blueprint_gap_draft', file: 'src/app/api/blueprint/gap-assist/route.ts', beforeMarker: "name: 'draft_answer'" },
  { actionKey: 'answer_routing', file: 'src/app/api/blueprint/answer/route.ts', beforeMarker: 'await routeFreeTextAnswer(' },
  { actionKey: 'reconciliation', file: 'src/app/api/reconciliation/run/route.ts', beforeMarker: 'outcome = await runReconciliationForOrg(' },
  { actionKey: 'cross_document_review', file: 'src/app/api/ai-review/route.ts', beforeMarker: "fetch('https://api.anthropic.com/v1/messages'" },
  { actionKey: 'market_research', file: 'src/app/api/market-data/research/route.ts', beforeMarker: 'runResearchPass(' },
  { actionKey: 'market_document_extract', file: 'src/app/api/market-data/document-extract/route.ts', beforeMarker: 'maxOutputTokensForBudget(' },
  { actionKey: 'market_thesis_document_suggest', file: 'src/app/api/market-thesis/suggest-from-documents/route.ts', beforeMarker: "fetch('https://api.anthropic.com/v1/messages'" },
  { actionKey: 'market_thesis_hypotheses_generate', file: 'src/app/api/market-thesis/hypotheses/generate/route.ts', beforeMarker: "fetch('https://api.anthropic.com/v1/messages'" },
  { actionKey: 'entity_enrich', file: 'src/app/api/entities/[id]/enrich/route.ts', beforeMarker: 'callClaude(apiKey, model, buildEntityEnrichmentPrompt' },
  { actionKey: 'compose_outreach', file: 'src/app/api/compose/route.ts', beforeMarker: 'callClaude(apiKey, model, buildPrompt' },
  { actionKey: 'roadmap_suggest', file: 'src/app/api/roadmap/suggest-events/route.ts', beforeMarker: 'runSuggestionPass(' },
  { actionKey: 'mini_pitch_synthesis', file: 'src/app/api/mini-pitch/route.ts', beforeMarker: 'await synthesizeSlides({ apiKey, model, orgId, requests: aiRequests })' },
  { actionKey: 'team_sherlock_research', file: 'src/app/api/company/team-sherlock-research/route.ts', beforeMarker: "fetch('https://api.anthropic.com/v1/messages'" },
];

describe('every ai_actions key with a single route has chargeAiAction wired before its real model call', () => {
  for (const { actionKey, file, beforeMarker } of ROUTES) {
    it(`${actionKey} — ${file}`, () => {
      const src = read(file);
      const chargeIdx = src.indexOf(`chargeAiAction(`);
      const chargeKeyIdx = src.indexOf(`'${actionKey}'`);
      const callIdx = src.indexOf(beforeMarker);
      expect(chargeIdx, `${file} has no chargeAiAction(...) call at all`).toBeGreaterThan(-1);
      expect(chargeKeyIdx, `${file} never charges the '${actionKey}' action key`).toBeGreaterThan(-1);
      expect(callIdx, `${file} marker "${beforeMarker}" not found — update this test's marker`).toBeGreaterThan(-1);
      expect(chargeKeyIdx, `${file}: the '${actionKey}' charge must appear BEFORE the real model call, not after`).toBeLessThan(callIdx);
    });
  }
});

describe('/api/ai-review — the three-way split (document_review / cross_document_review / market_data_review)', () => {
  const src = read('src/app/api/ai-review/route.ts');

  it('the generic branch resolves market_data to market_data_review and everything else (except message_review) to document_review', () => {
    expect(src).toContain("kind === 'market_data' ? 'market_data_review' : 'document_review'");
  });

  it('message_review is explicitly excluded from the charge — the disabled Watson draft-review card, not one of the three billable buttons', () => {
    expect(src).toContain("kind !== 'message_review' && member");
  });
});

describe('reconciliation — charged only on the one deliberate trigger, never the three automatic ones', () => {
  it('/api/reconciliation/run gates the charge on an explicit trigger flag', () => {
    const src = read('src/app/api/reconciliation/run/route.ts');
    expect(src).toContain("trigger === 'button'");
  });

  it('MarketDataPanel is the one caller that sends trigger:\'button\'', () => {
    const src = read('src/components/readiness/MarketDataPanel.tsx');
    expect(src).toContain("trigger: 'button'");
  });

  it('store-supabase.tsx\'s automatic post-upload/rename triggers are unmodified — no trigger flag added there', () => {
    const src = read('src/lib/store-supabase.tsx');
    expect(src).toContain("fetch('/api/reconciliation/run', { method: 'POST' })");
    expect(src).not.toContain("trigger: 'button'");
  });
});

describe('excluded routes never charge — confirmed by absence, not just omission from the list above', () => {
  const excluded = [
    'src/app/api/needs-review/classify-entity/route.ts',
    'src/app/api/classify-interaction/route.ts',
    'src/app/api/reawakening/evaluate/route.ts',
    'src/app/api/reawakening/neglect-evaluate/route.ts',
    'src/app/api/reawakening/rejection-filter/route.ts',
    'src/app/api/backoffice/research/route.ts',
  ];
  for (const file of excluded) {
    it(`${file} has no chargeAiAction call`, () => {
      expect(read(file)).not.toContain('chargeAiAction(');
    });
  }
});
