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
      .toMatchObject({ entityMention: 'alpana ventures' });
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
    expect(hookIsAboutTheFund('Alpana backs founders bridging Switzerland and Asia', 'Alpana Ventures', 'Nathalie Chemtob')).toMatchObject({ entityMention: 'alpana' });
    expect(hookIsAboutTheFund('Raised capital for three medtech rounds', 'Alpana Ventures', 'Nathalie Chemtob')).toBeNull();
  });

  it('folds diacritics and possessives before matching', () => {
    expect(hookIsAboutTheFund("Entrée Capital's fund focuses on Israeli seed rounds", 'Entrée Capital', 'Maya Benichou')).toMatchObject({ entityMention: 'entree capital' });
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

// Prompt 641 §2 — position, not only presence. The four real cases from the
// first nine of 638's twenty: Rodrigues and Trigo da Roza must be rejected,
// Fonseca and Pereira must pass. Prompt 643 §3 makes the first two the
// negative fixtures of record.
describe('hookIsAboutTheFund — the fund as grammatical subject (641 §2)', () => {
  const rodrigues = 'Indico Capital Partners launched a €50 million Blue Economy fund focused on ocean-related startups and climate action, with Rui Rodrigues as a Partner involved in this ocean tech investment strategy alongside AI, Deep Tech, SaaS, FinTech, IoT, and SpaceTech investments.';
  const trigoDaRoza = "Co-president of Investors Portugal, which manages approximately €500 million in assets under management with €150 million planned investment over three years, supporting around 425 business angels and 300+ invested startups. Publicly advocates for building high-value-added businesses to address Portugal's economic stagnation and create qualified employment with higher salaries.";
  const fonseca = "Launched €125 million new fund at Indico Capital Partners; 'doing something mediocre is not enough'";
  const pereira = 'Built and sold U.hub, a student housing proptech business, for €130m in five years with minimal initial capital';

  it('rule 1 — the hook opens with the entity, the person is a complement at the end (Rui Rodrigues)', () => {
    expect(hookIsAboutTheFund(rodrigues, 'Indico Capital Partners', 'Rui Rodrigues')).toMatchObject({ entityMention: 'indico capital partners', rule: 'starts_with_entity' });
  });

  it('rule 3 — a relative clause hangs off the entity: the fact is the fund\'s by grammar (João Trigo da Roza)', () => {
    expect(hookIsAboutTheFund(trigoDaRoza, 'Investors Portugal', 'João Trigo da Roza')).toMatchObject({ entityMention: 'investors portugal', rule: 'relative_clause' });
  });

  it('rule 2 — the first person marker sits more than 60 characters after the entity', () => {
    const hook = 'Partner at Indico Capital Partners which has backed forty companies across Iberia and beyond over the last decade and where he leads the fintech practice';
    // "which" here is not immediately after the mention ("Partners which" — it is), so rule 3 fires first; use a case without the relative pronoun:
    const hook2 = 'Partner at Indico Capital Partners: forty companies backed across Iberia over the last decade, a €50 million ocean fund, and he now leads the fintech practice';
    expect(hookIsAboutTheFund(hook, 'Indico Capital Partners', 'Rui Rodrigues')).not.toBeNull();
    expect(hookIsAboutTheFund(hook2, 'Indico Capital Partners', 'Rui Rodrigues')).toMatchObject({ rule: 'person_after_entity' });
  });

  it('inverse — a hook that opens with a past-tense verb has the person as subject, whatever fund follows (Cristina Fonseca)', () => {
    expect(hookIsAboutTheFund(fonseca, 'Indico Capital Partners', 'Cristina Fonseca')).toBeNull();
  });

  it('inverse — an irregular past-tense opener passes too (Hugo Gonçalves Pereira)', () => {
    expect(hookIsAboutTheFund(pereira, 'Investors Portugal', 'Hugo Gonçalves Pereira')).toBeNull();
    expect(hookIsAboutTheFund('Co-founded Indico Capital Partners in 2017 after a decade at Caixa Capital', 'Indico Capital Partners', 'Rui Jerónimo')).toBeNull();
  });

  it('a pronoun opener passes even when the fund is named next', () => {
    expect(hookIsAboutTheFund('She launched the Indico Capital Partners ocean fund and chairs its investment committee', 'Indico Capital Partners', 'Cristina Fonseca')).toBeNull();
  });
});
