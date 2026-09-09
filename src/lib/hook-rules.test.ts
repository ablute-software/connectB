import { describe, expect, it } from 'vitest';
// Deliberately imports the WORKER's own module, not a copy: what is tested
// here is byte-for-byte what supabase/functions/enrichment-worker deploys.
import { foldTokens, hookIsAboutTheFund } from '../../supabase/functions/enrichment-worker/hook-rules';

// Prompt 638 §3.2 — "Alpana Ventures focuses on bridging Swiss and European
// startups" tem de ser rejeitado, e "Schweitzer says b2venture's entire
// unicorn track record originated from angels" tem de passar.
describe('hookIsAboutTheFund — rule (a) of the hook bar, checked by code', () => {
  it('rejects the Alpana shape: the fund is named, the person never is', () => {
    expect(hookIsAboutTheFund('Alpana Ventures focuses on bridging Swiss and European startups to Silicon Valley and Asia', 'Alpana Ventures', 'NATHALIE CHEMTOB'))
      .toEqual({ entityMention: 'alpana ventures' });
    expect(hookIsAboutTheFund('Alpana Ventures employs a unique early-stage investment model combining capital deployment', 'Alpana Ventures', 'PASCAL H. WIDMER'))
      .not.toBeNull();
  });

  it('passes the Schweitzer shape: the fund is named, but so is the person, with a verb of declaration', () => {
    expect(hookIsAboutTheFund("Schweitzer says b2venture's entire unicorn track record originated from angels", 'b2venture', 'Florian Schweitzer')).toBeNull();
  });

  it("a hook that never names the entity is left to the model's own rule", () => {
    expect(hookIsAboutTheFund('Supervises finance and logistics operations for an early-stage VC firm focused on digital health', 'Alpana Ventures', 'CHRISTOPHE CHEMTOB')).toBeNull();
  });

  it('a pronoun is a person marker', () => {
    expect(hookIsAboutTheFund('At b2venture she led the Series A in a Berlin insurtech', 'b2venture', 'Jane Doe')).toBeNull();
  });

  it("the person's first name counts, whatever the case of the stored name", () => {
    expect(hookIsAboutTheFund('At Alpana Ventures, Nathalie built the Swiss deal flow', 'Alpana Ventures', 'NATHALIE CHEMTOB')).toBeNull();
  });

  it('the distinctive token of the entity name is a mention; a generic word alone is not', () => {
    expect(hookIsAboutTheFund('Alpana backs founders bridging Switzerland and Asia', 'Alpana Ventures', 'Nathalie Chemtob')).toEqual({ entityMention: 'alpana' });
    expect(hookIsAboutTheFund('Raised capital for three medtech rounds', 'Alpana Ventures', 'Nathalie Chemtob')).toBeNull();
  });

  it('folds diacritics and possessives before matching', () => {
    expect(hookIsAboutTheFund("Entrée Capital's fund focuses on Israeli seed rounds", 'Entrée Capital', 'Maya Benichou')).toEqual({ entityMention: 'entree capital' });
    expect(foldTokens("Entrée Capital's")).toEqual(['entree', 'capital', 's']);
  });

  it('fund-subject verbs (invests, manages) do not rescue a fund-only hook', () => {
    expect(hookIsAboutTheFund('Alpana Ventures invests in early-stage Swiss startups and manages CHF 50M', 'Alpana Ventures', 'Nathalie Chemtob')).not.toBeNull();
  });

  it('null and empty inputs are never hits', () => {
    expect(hookIsAboutTheFund(null, 'Alpana Ventures', 'X')).toBeNull();
    expect(hookIsAboutTheFund('', 'Alpana Ventures', 'X')).toBeNull();
    expect(hookIsAboutTheFund('Alpana Ventures focuses on X', null, 'X')).toBeNull();
  });
});
