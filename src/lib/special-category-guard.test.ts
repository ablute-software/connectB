import { describe, expect, it } from 'vitest';
// Deliberately imports the WORKER's own module, not a copy: what is tested
// here is byte-for-byte what supabase/functions/enrichment-worker deploys.
import {
  findSpecialCategoryMention, hookContainsKillWord, stripSpecialCategoryFields,
} from '../../supabase/functions/enrichment-worker/special-category';

// Prompt 634 §5.1 — "confirma que a guarda distingue 'born with diabetes' de
// 'invests in diabetes care', com os dois casos como teste."
describe('special-category net (Prompt 634 §3.1)', () => {
  it('rejects the sentence that started this: the Bürk background', () => {
    const hit = findSpecialCategoryMention('Born with diabetes, which he described as motivation to prove himself. Eldest of six siblings raised in entrepreneurial household.');
    expect(hit).not.toBeNull();
    expect(hit!.term.toLowerCase()).toBe('diabet');
    expect(hit!.marker.toLowerCase()).toBe('born with');
  });

  it('lets a digital-health investor keep their market', () => {
    expect(findSpecialCategoryMention('Invests in diabetes care, remote monitoring and digital health platforms across Europe.')).toBeNull();
    expect(findSpecialCategoryMention('Portfolio includes cancer diagnostics and oncology therapeutics companies.')).toBeNull();
    expect(findSpecialCategoryMention('Led the Series A of a mental-health startup focused on anxiety and depression apps.')).toBeNull();
  });

  it('rejects a condition attached to the person by any of the markers', () => {
    expect(findSpecialCategoryMention('She was diagnosed with cancer at 30 and later founded the firm.')).not.toBeNull();
    expect(findSpecialCategoryMention('He has spoken about his own struggle with depression.')).not.toBeNull();
    expect(findSpecialCategoryMention('A survivor of a chronic illness, she…')).not.toBeNull();
  });

  it('rejects non-health special categories with a personal marker, and only then', () => {
    expect(findSpecialCategoryMention('He struggled as a refugee before founding the fund.')).not.toBeNull();
    expect(findSpecialCategoryMention('The fund backs refugee-founded startups.')).toBeNull();
    expect(findSpecialCategoryMention('Invests in political-risk analytics tools.')).toBeNull();
  });

  it('the window is a window: a marker 41+ characters away does not count', () => {
    const far = 'He suffered a setback in 2019 when the fund closed. ' + 'x'.repeat(60) + ' The portfolio spans diabetes care.';
    expect(findSpecialCategoryMention(far)).toBeNull();
  });

  it('drops the field, never the job', () => {
    const { kept, rejected } = stripSpecialCategoryFields({
      hook: 'Joined b2venture as Partner, focusing on marketplaces after leaving Speedinvest in July 2024.',
      background: 'Born with diabetes, which he described as motivation to prove himself.',
      intro_path: 'Warm intro via a portfolio founder.',
      watch_outs: null,
    });
    expect(kept.hook).toContain('b2venture');
    expect(kept.background).toBeNull();
    expect(kept.intro_path).toContain('Warm intro');
    expect(kept.watch_outs).toBeNull();
    expect(rejected).toHaveLength(1);
    expect(rejected[0].field).toBe('background');
  });
});

// Prompt 634 §3.3 — "a mesma chamada listou 'youngest partners ever' como
// palavra a evitar e pô-la na linha de abertura."
describe('hook vs its own kill words (Prompt 634 §3.3)', () => {
  it('catches the Bürk case, which is NOT a literal substring', () => {
    const hook = 'Partner at b2venture focusing on digital health; became partner in 2021 at age 28, one of the youngest VC partners ever.';
    expect(hookContainsKillWord(hook, ['youngest partners ever', "Builders' Circle", 'tennis'])).toBe('youngest partners ever');
  });

  it('catches a literal one', () => {
    expect(hookContainsKillWord('Former professional skiing champion turned investor.', ['professional skiing'])).toBe('professional skiing');
  });

  it('does not fire on a shared word alone', () => {
    expect(hookContainsKillWord('Backs export-led SaaS companies in Iberia.', ['import-export business'])).toBeNull();
    expect(hookContainsKillWord('Led the Series A of a tennis-analytics startup in 2025.', ['tennis career'])).toBeNull();
  });

  it('is null-safe', () => {
    expect(hookContainsKillWord(null, ['x'])).toBeNull();
    expect(hookContainsKillWord('anything', [])).toBeNull();
    expect(hookContainsKillWord('anything', undefined)).toBeNull();
  });
});
