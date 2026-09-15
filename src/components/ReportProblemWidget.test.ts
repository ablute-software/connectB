import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 701 — this repository has no DOM test environment (no jsdom, no
// @testing-library, and vitest has no JSX plugin — see FrostedGate.test.ts's
// own header), so this checks the fix the same honest way every other
// component test here does: against the real source, never a rendered tree.
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('ReportProblemWidget — category no longer stuck on "Pipeline" (Prompt 701 §2)', () => {
  const src = read('src/components/ReportProblemWidget.tsx');
  const body = code(src);

  it('shares ONE area vocabulary with areaFromPath, not a second hand-picked list', () => {
    expect(body).toContain("import { areaFromPath, SUPPORT_AREAS, type SupportArea } from '@/lib/support-area';");
    expect(body).toContain('const AREAS = SUPPORT_AREAS;');
  });

  it('seeds `area` from the current page, not a fixed literal', () => {
    expect(body).toContain('useState<SupportArea>(() => areaFromPath(pathname))');
    // The old bug, byte for byte: this must never come back.
    expect(body).not.toMatch(/useState\(AREAS\[0\]\)/);
  });

  it('re-derives `area` from the page every time the widget is opened', () => {
    expect(body).toMatch(/function openWidget\(\)\s*\{\s*setArea\(areaFromPath\(pathname\)\);/);
    expect(body).toContain('<button onClick={openWidget}');
  });

  it('reset() no longer snaps the category back to a fixed AREAS[0]', () => {
    expect(body).not.toMatch(/setArea\(AREAS\[0\]\)/);
    expect(body).toContain("setArea(areaFromPath(pathname))");
  });
});

describe('ReportProblemWidget — the eligibility gate is display-only and org-badge-based, never role-based (Prompt 701 §1)', () => {
  const src = read('src/components/ReportProblemWidget.tsx');
  const body = code(src);

  it('canSuggest has a real tri-state — "still checking" is distinct from an explicit false', () => {
    expect(body).toContain('useState<boolean | null>(null)');
  });

  it('the discoverability hint fires only on an explicit false, never during the loading window', () => {
    expect(body).toContain('canSuggest === false &&');
    // Loosely equivalent but wrong: would also fire while canSuggest is
    // still null, flashing for an eligible account before the fetch resolves.
    expect(body).not.toContain('!canSuggest &&');
  });

  it('there is no role check anywhere in this file — the gate lives entirely in /api/suggestions/eligibility', () => {
    expect(body).not.toMatch(/role\s*===\s*['"]developer['"]/);
  });
});

describe('the eligibility route itself gates on the org\'s active badges, not on role', () => {
  const src = read('src/app/api/suggestions/eligibility/route.ts');
  const body = code(src);

  it('resolves eligibility from org_members + platform badges, never platform_admins/role', () => {
    expect(body).toContain("admin.from('org_members')");
    expect(body).toContain('loadOrgPlatformBadges');
    expect(body).not.toContain('platform_admins');
  });
});

describe('support-area.ts — Readiness & Train is a real route, no longer falls through to Other', () => {
  const src = read('src/lib/support-area.ts');

  it('SUPPORT_AREAS includes it', () => {
    expect(src).toContain("'Readiness & Train'");
  });

  it('the /readiness prefix maps to it', () => {
    expect(src).toMatch(/\{ prefix: '\/readiness', area: 'Readiness & Train' \}/);
  });
});
