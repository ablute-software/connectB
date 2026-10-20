// Prompt 918 (follow-up to the I1 test) — the category list of a person offers what exists, the suggestions that do not exist yet, and "+ New category…". (Static markup: the
// clicks, the timing and the undo are driven in a real browser; see the Prompt 918 follow-up report.)
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CategoryPicker, missingSuggestions } from './CategoryPicker';
import { SUGGESTED_CATEGORIES } from '@/lib/calls/permissions';

const cats = [{ id: 'a', name: 'Administrator' }, { id: 'e', name: 'Evaluator' }];
const render = (props: Partial<Parameters<typeof CategoryPicker>[0]> = {}) =>
  renderToStaticMarkup(createElement(CategoryPicker, { id: 'pick', label: 'Category of Bob', categories: cats, value: { kind: 'existing', id: 'a' }, disabled: false, className: 'c', onPick: () => {}, ...props }));

describe('the category list of a person', () => {
  it('lists the categories that exist, then the suggestions that do not (Evaluator is not offered twice), then "+ New category…"', () => {
    const html = render();
    const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
    expect(options.slice(0, 2)).toEqual([['a', 'Administrator'], ['e', 'Evaluator']]);
    expect(options.slice(2, -1).map((o) => o[1])).toEqual(SUGGESTED_CATEGORIES.filter((s) => s !== 'Evaluator'));
    expect(options[options.length - 1]).toEqual(['__new__', '+ New category…']);
    expect(html).toContain('<optgroup label="Suggested — created when you pick one">');
  });
  it('before anything exists, Evaluator, Manager and Analyst are all on offer', () => {
    expect(render({ categories: [{ id: 'a', name: 'Administrator' }] })).toMatch(/suggest:Evaluator[\s\S]*suggest:Manager[\s\S]*suggest:Analyst/);
  });
  it('suggestions are matched whatever the case, so a category called "evaluator" is not suggested again', () => {
    expect(missingSuggestions([{ name: 'evaluator' }, { name: ' MANAGER ' }])).toEqual(['Analyst', 'Finance specialist', 'Technical specialist', 'Legal']);
  });
  it('shows the selected one, and a name chosen for a new category (not yet created) as such', () => {
    expect(render({ value: { kind: 'existing', id: 'e' } })).toMatch(/<option value="e" selected="">Evaluator/);
    expect(render({ value: { kind: 'new', name: 'Head of Research' } })).toContain('Head of Research (new)');
    expect(render({ value: { kind: 'suggest', name: 'Analyst' } })).toMatch(/<option value="suggest:Analyst" selected="">Analyst/);
  });
  it('is not clickable while something is being saved or when the person cannot manage the team', () => {
    expect(render({ disabled: true })).toMatch(/<select[^>]*disabled/);
  });
});
