import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLandingPath, showsReportProblemWidget } from './report-widget-visibility';
import { PUBLIC_SITE_PAGES } from './public-site-routes';

// 30/10/2026 — the floating "Tell us" / "Report a problem" button was drawn on the landing pages, where an anonymous visitor has nothing to report.
describe('the report button is not drawn on the landing pages', () => {
  it.each(['/', '/investors', '/investors/video', '/for-startups', '/about', '/faq'])('%s: hidden', (p) => {
    expect(isLandingPath(p)).toBe(true);
    expect(showsReportProblemWidget(p)).toBe(false);
  });

  it('every marketing page of the shared public list is covered, including a sub-path', () => {
    for (const p of PUBLIC_SITE_PAGES) { expect(showsReportProblemWidget(p)).toBe(false); expect(showsReportProblemWidget(`${p}/x`)).toBe(false); }
  });

  it.each(['/contact', '/login', '/signup', '/pipeline', '/portal', '/call/abc', '/terms', '/investorsx', '/about-us-not'])('%s: keeps the button', (p) => {
    expect(showsReportProblemWidget(p)).toBe(true);
  });

  it('an unknown path (null / undefined / empty) keeps the button, as before', () => {
    for (const p of [null, undefined, '']) expect(showsReportProblemWidget(p)).toBe(true);
  });
});

describe('ReportProblemWidget decides before anything of the form exists', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/ReportProblemWidget.tsx'), 'utf8').replace(/\r\n/g, '\n');
  it('the exported component only asks the path and returns null or the inner component (no state, listener or fetch runs on a landing page)', () => {
    const wrapper = src.slice(src.indexOf('export function ReportProblemWidget()'), src.indexOf('function ReportProblemWidgetInner()'));
    expect(wrapper).toContain('const pathname = usePathname();');
    expect(wrapper).toContain('if (!showsReportProblemWidget(pathname)) return null;');
    expect(wrapper).toContain('return <ReportProblemWidgetInner />;');
    expect(wrapper).not.toContain('useState');
    expect(wrapper).not.toContain('useEffect');
  });
  it('the form, its listeners and its fetches live in the inner component, and the layout still mounts the widget once', () => {
    expect(src.slice(src.indexOf('function ReportProblemWidgetInner()'))).toContain("fetch('/api/me'");
    const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8');
    expect(layout.match(/<ReportProblemWidget \/>/g)?.length).toBe(1);
  });
});
