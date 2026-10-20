// Nuno, 20/10/2026 (screenshot of the left bar): Pipeline and Calls in one card, Tasks and Agenda in another, "like My Network and Messages, or Dashboard
// and Readiness & Train — only the visual card effect, not a merge of the tabs". The groups ARE the cards (WorkspaceSidebar draws each contiguous run of
// the same `group` as one card), so what is pinned here is the grouping, and that nothing else about the entries moved.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOUNDER_NAV, HELP_SUPPORT_NAV_GROUP } from './founder-nav';

const groupOf = (href: string) => FOUNDER_NAV.find((n) => n.href === href)?.group;

describe('the founder navigation — which entries share a card', () => {
  it('the cards, in order: about + Vault · Pipeline + Calls · Tasks + Agenda · My Network + Messages · Dashboard + Readiness · Plans', () => {
    const cards = new Map<number, string[]>();
    for (const n of FOUNDER_NAV) cards.set(n.group, [...(cards.get(n.group) ?? []), n.href]);
    expect([...cards.entries()].sort(([a], [b]) => a - b).map(([, hrefs]) => hrefs)).toEqual([
      ['/settings', '/documents'],
      ['/pipeline', '/calls'],
      ['/tasks', '/agenda'],
      ['/network', '/messages'],
      ['/dashboard', '/readiness'],
      ['/plans'],
    ]);
  });

  it('Pipeline and Calls are in one card and Tasks and Agenda in ANOTHER (they used to be four in one)', () => {
    expect(groupOf('/pipeline')).toBe(groupOf('/calls'));
    expect(groupOf('/tasks')).toBe(groupOf('/agenda'));
    expect(groupOf('/pipeline')).not.toBe(groupOf('/tasks'));
  });

  it('a card is a contiguous run: the sidebar draws one card per run, so a group number may never come back after another', () => {
    const groups = FOUNDER_NAV.map((n) => n.group);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });

  it('it is only the cards: every entry still has its own page, in the same order, with the same capability gates (no merged tabs)', () => {
    expect(FOUNDER_NAV.map((n) => n.href)).toEqual([
      '/settings', '/documents', '/pipeline', '/calls', '/tasks', '/agenda', '/network', '/messages', '/dashboard', '/readiness', '/plans',
    ]);
    expect(new Set(FOUNDER_NAV.map((n) => n.href)).size).toBe(FOUNDER_NAV.length);
    expect(FOUNDER_NAV.find((n) => n.href === '/calls')?.requiresCapability).toBe('calls');
    expect(FOUNDER_NAV.find((n) => n.href === '/readiness')?.requiresCapability).toBe('companyCanon');
    expect(FOUNDER_NAV.filter((n) => n.requiresCapability)).toHaveLength(2);
  });

  it('with the Calls switch off, Pipeline simply sits alone in its card (the other cards do not move)', () => {
    const visible = FOUNDER_NAV.filter((n) => !n.requiresCapability);
    const pipelineCard = visible.filter((n) => n.group === groupOf('/pipeline'));
    expect(pipelineCard.map((n) => n.href)).toEqual(['/pipeline']);
    expect(visible.filter((n) => n.group === groupOf('/tasks')).map((n) => n.href)).toEqual(['/tasks', '/agenda']);
  });

  it('Help & support joins Plans & billing in the last card (one card, no divider), and is not part of this list (it never reaches the mobile nav)', () => {
    expect(HELP_SUPPORT_NAV_GROUP).toBe(groupOf('/plans'));
    expect(FOUNDER_NAV.some((n) => n.label === 'Help & support')).toBe(false);
  });

  it('the shell takes its entries from here and no longer keeps a private copy', () => {
    const shell = readFileSync(path.resolve(__dirname, '../components/shell.tsx'), 'utf8');
    expect(shell).toContain("from '@/lib/founder-nav'");
    expect(shell).toContain('FOUNDER_NAV.filter(');
    expect(shell).toContain('group: HELP_SUPPORT_NAV_GROUP');
    expect(shell).not.toMatch(/const NAV\s*[:=]/);
  });
});
