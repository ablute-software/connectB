-- Prompt 115 Block D — cross-document coherence analysis. Additive enum
-- value, pre-authorized to apply directly (unlike Block E's
-- round_valuation_basis, which is propose-only). Consumed by
-- /api/ai-review/route.ts's new cross_document_review kind: the model
-- compares two structured reviews already stored in ai_reviews and returns
-- contradictions with dual citations (sideA/sideB, each {kind, quote}) —
-- never a bare claim without both sides quoted.
alter type public.ai_review_kind add value 'cross_document_review';
