// Prompt 922 (I1) — reading an evaluation grid with the platform's OWN reader, and the guarantee that matters most: a grid is NEVER sent to an AI provider. The test fails if this reader — or anything it
// imports — can reach one.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffProposal, proposalToCriteria, proposeGrid, splitCells } from './eval-grid-reader';
import { parseCriteriaPayload } from './eval-grid';

const PV = `Evaluation grid — Portugal Ventures (scale 1 to 5)
Criterion | Weight | Description
Team | 25% | Experience and complementarity of the founders
Technology & IP | 10% | Maturity and defensibility
Market | 20% | Size and growth of the market
Traction | 25% | Customers, revenue and growth
Fit with the programme | 20% | Alignment with the call's objectives`;

describe('a table from a Word document (cells joined by |)', () => {
  it('reads the criteria, the weights, the descriptions and the scale of the document, with where each came from', () => {
    const p = proposeGrid(PV);
    expect(p.criteria.map((c) => [c.name, c.weight])).toEqual([['Team', 25], ['Technology & IP', 10], ['Market', 20], ['Traction', 25], ['Fit with the programme', 20]]);
    expect(p.scaleGuess).toEqual({ min: 1, max: 5 });
    expect(p.criteria[0].guidance).toBe('Experience and complementarity of the founders');
    expect(p.criteria[0].source).toEqual({ line: 3, text: 'Team | 25% | Experience and complementarity of the founders' });
    expect(p.notes).toEqual([]);
  });
  it('the payload it gives the editor is a valid grid, on the scale of the document', () => {
    const r = parseCriteriaPayload(proposalToCriteria(proposeGrid(PV)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.criteria.every((c) => c.scaleMin === 1 && c.scaleMax === 5)).toBe(true);
  });
});

describe('other shapes the same grid comes in', () => {
  it('an Excel sheet (CSV lines), weights written as plain numbers adding up to 100, and a scale per row', () => {
    const csv = `## Sheet: Grid\nCriterion,Weight,Scale\nTeam,40,1-5\n"Market, size and growth",35,0-10\nTraction,25,1-5`;
    const p = proposeGrid(csv);
    expect(p.criteria.map((c) => [c.name, c.weight, c.scaleMin, c.scaleMax])).toEqual([['Team', 40, 1, 5], ['Market, size and growth', 35, 0, 10], ['Traction', 25, 1, 5]]);
    expect(p.notes).toEqual([]);
  });
  it('plain lines with the weight after the name, numbering and bullets', () => {
    const p = proposeGrid('1. Team – 30 %\n2. Technology (20%)\n- Market: 50%');
    expect(p.criteria.map((c) => [c.name, c.weight])).toEqual([['Team', 30], ['Technology', 20], ['Market', 50]]);
  });
  it('sections: a short heading with no number above weighted rows', () => {
    const p = proposeGrid('PEOPLE\nTeam | 30%\nAdvisors | 10%\nBUSINESS\nMarket | 30%\nTraction | 30%');
    expect(p.criteria.map((c) => [c.name, c.section])).toEqual([['Team', 'PEOPLE'], ['Advisors', 'PEOPLE'], ['Market', 'BUSINESS'], ['Traction', 'BUSINESS']]);
  });
  it('descriptions of levels under a criterion, by level and by range', () => {
    const p = proposeGrid('Scale 1-10\nTeam | 100%\n1-3: weak\n4 - 7: good\n10 = outstanding');
    expect(p.criteria[0].levels).toEqual([{ from: 1, to: 3, text: 'weak' }, { from: 4, to: 7, text: 'good' }, { from: 10, to: 10, text: 'outstanding' }]);
    expect(p.notes.join(' ')).toContain('Descriptions of levels were read');
  });
});

describe('what it cannot read, it says', () => {
  it('weights that do not add up; a repeated criterion; no criteria at all; no scale', () => {
    expect(proposeGrid('Team | 40%\nMarket | 40%').notes.join(' ')).toContain('add up to 80 %, not 100 %');
    expect(proposeGrid('Team | 50%\nTeam | 50%').notes.join(' ')).toContain('appears more than once');
    expect(proposeGrid('A paragraph about the call and nothing else.').notes.join(' ')).toContain('No criteria with a weight were found');
    expect(proposeGrid('Team | 100%').notes.join(' ')).toContain('No scale was found');
  });
  it('the same text always gives the same proposal', () => {
    expect(JSON.stringify(proposeGrid(PV))).toBe(JSON.stringify(proposeGrid(PV)));
  });
  it('cells: |, tab, CSV with quotes, wide gaps', () => {
    expect(splitCells('a | b | c')).toEqual(['a', 'b', 'c']);
    expect(splitCells('a\tb\tc')).toEqual(['a', 'b', 'c']);
    expect(splitCells('"a, b",2,3')).toEqual(['a, b', '2', '3']);
    expect(splitCells('a     b   c')).toEqual(['a', 'b', 'c']);
  });
});

describe('what the administrator corrects is kept (so the reader can improve)', () => {
  it('renamed, re-weighted, re-scaled, removed and added items, compared with the proposal', () => {
    const p = proposeGrid(PV);
    const applied = [
      { name: 'Team', weight: 30, scaleMin: 1, scaleMax: 5, section: null, levels: [] },
      { name: 'Technology & IP', weight: 10, scaleMin: 0, scaleMax: 10, section: null, levels: [] },
      { name: 'Market', weight: 20, scaleMin: 1, scaleMax: 5, section: null, levels: [] },
      { name: 'Traction', weight: 25, scaleMin: 1, scaleMax: 5, section: null, levels: [] },
      { name: 'Impact', weight: 15, scaleMin: 1, scaleMax: 5, section: null, levels: [] },
    ];
    const d = diffProposal(p, applied);
    expect(d).toEqual(expect.arrayContaining([
      { kind: 'weight', name: 'Team', from: 25, to: 30 }, { kind: 'scale', name: 'Technology & IP', from: '1-5', to: '0-10' },
      { kind: 'removed', name: 'Fit with the programme' }, { kind: 'added', name: 'Impact' },
    ]));
    expect(d).toHaveLength(4);
    expect(diffProposal(p, proposalToCriteria(p) as never)).toEqual([]);
  });
});

describe('a grid is NEVER sent to an AI provider', () => {
  const dir = path.join(process.cwd(), 'src/lib/calls');
  const FORBIDDEN = /anthropic|openai|ai-import\/(anthropic|propose|prompt|job)|callClaude|fetch\s*\(|XMLHttpRequest|\bsdk\b/i;
  /** The files this reader and its route are made of: none may name a provider, an AI client, or make a network call. */
  const files = ['eval-grid-reader.ts', 'eval-grid.ts', 'eval-grid-import.ts'].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
  it('the reader, the grid and the importer name no provider and make no network call', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const code = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(FORBIDDEN.test(code), `${path.basename(f)} must not reach an AI provider`).toBe(false);
    }
  });
  it('and what they import cannot either (only the reader of documents, which is local)', () => {
    for (const f of files) {
      const imports = [...fs.readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const i of imports) expect(i, `${path.basename(f)} imports ${i}`).not.toMatch(/anthropic|propose|prompt|ai-import\/job|ai-import\/notify|openai/);
    }
  });
});
