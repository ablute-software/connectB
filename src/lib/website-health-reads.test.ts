// Prompt 919 F — the "don't" list, enforced where it can be enforced: by reading the sources. A convention that lives in a prompt is not a
// control; these fail the build the day someone adds a path the prompt ruled out.
//
//   · the score is not shown in investor listings / search / MatchDeal / Pipeline          → the set of files that touch website health is CLOSED
//   · it is not part of completeness, the gate, notifications or the Action plan           → same closed set
//   · no cron, no sweep over all orgs                                                      → vercel.json, and who may call Google
//   · the Google analysis is free                                                          → only the summary route charges
//   · the API key is never in the repo, never public, and read in exactly two places       → scan
//   · a GET reads; it does not call out, write, or charge                                  → the GET file is checked line by line
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git' || name === '__fixtures__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
/** The code of a file with its comments removed: a comment may MENTION the wallet or the table, only code can USE them. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/.*$/, '')).join('\n');
const SRC = walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)).map(rel).sort();

const TOUCHES = /website[-_]health|WebsiteHealth|org_website_audits|website_score_visible|PAGESPEED_API_KEY|pagespeed/i;

describe('the set of files that touch website health is closed', () => {
  const touching = SRC.filter((f) => TOUCHES.test(read(f)));

  it('is exactly the files this prompt put it in — a new consumer must be a conscious decision, not an accident', () => {
    expect(touching).toEqual([
      'src/app/api/backoffice/website-health/[orgId]/route.ts',
      'src/app/api/portal/startup/[orgId]/route.ts',
      'src/app/api/settings/dossier-preview/route.ts',
      'src/app/api/website-health/check/route.ts',
      'src/app/api/website-health/route.ts',
      'src/app/api/website-health/summary/route.ts',
      'src/app/api/website-health/visibility/route.ts',
      'src/app/backoffice/ficha-cliente/[kind]/[id]/page.tsx',
      'src/components/backoffice/WebsiteHealthBackofficeCard.tsx',
      'src/components/portal/DossierOverviewSections.tsx',
      'src/components/portal/InvestorWebsiteHealth.tsx',
      'src/components/readiness/ReadinessPanel.tsx',
      'src/components/readiness/WebsiteHealthCard.tsx',
      'src/lib/audit-log-format.ts',
      'src/lib/dossier-fetch.ts',
      'src/lib/investor-interest-level.ts',
      'src/lib/website-health-capability.ts',
      'src/lib/website-health-psi.ts',
      'src/lib/website-health-run.ts',
      'src/lib/website-health-state.ts',
      'src/lib/website-health-summary.ts',
      'src/lib/website-health.ts',
    ]);
  });

  it('none of them is an investor listing, search, MatchDeal, Pipeline, completeness, gate, notification or Action-plan file', () => {
    const forbidden = /investor-pipeline|pipeline|matchdeal|search|listing|completeness|gate|notif|action-plan|ActionPlan|blueprint|readiness-score|checklist/i;
    // ReadinessPanel is the SCREEN that hosts the card (a tab, not the completeness computation); the dossier files are the one investor
    // path, reviewed in website-health-investor.test.ts.
    const screens = new Set(['src/components/readiness/ReadinessPanel.tsx']);
    expect(touching.filter((f) => forbidden.test(f) && !screens.has(f))).toEqual([]);
  });
});

describe('the table is read in exactly the places that may', () => {
  const readers = SRC.filter((f) => /from\('org_website_audits'\)/.test(code(f)));
  it('the capability probe, the founder\'s routes, the back office\'s route and the investor dossier — no one else', () => {
    expect(readers).toEqual([
      'src/app/api/backoffice/website-health/[orgId]/route.ts',
      'src/app/api/website-health/check/route.ts',
      'src/app/api/website-health/route.ts',
      'src/app/api/website-health/summary/route.ts',
      'src/lib/dossier-fetch.ts',
      'src/lib/website-health-capability.ts',
    ]);
  });
  it('the investor dossier selects the investor columns only, and reads them only after the founder\'s switch', () => {
    const src = read('src/lib/dossier-fetch.ts');
    const flag = src.indexOf("website_score_visible === true");
    const table = src.indexOf("from('org_website_audits')");
    expect(flag).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(flag);
    expect(src).toContain(".select(INVESTOR_AUDIT_COLUMNS)");
    expect(src.slice(table, table + 700)).not.toMatch(/'audits'|\bsummary\b|, audits|audits,/);
  });
});

describe('what an investor surface may import', () => {
  it('the investor block imports only the public type and the date formatter — no summary, no state, no colour scale', () => {
    const src = read('src/components/portal/InvestorWebsiteHealth.tsx');
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@/lib/website-health']);
    expect(src).not.toMatch(/BAND_COLOR|scoreBand|website-health-summary|website-health-state/);
  });
  it('the dossier fetch imports the pure rules and the capability probe only', () => {
    const src = read('src/lib/dossier-fetch.ts');
    const imports = [...src.matchAll(/from '(\.\/website-health[^']*)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['./website-health', './website-health-capability']);
  });
  it('the dossier projection takes the public type from the pure rules', () => {
    expect(read('src/lib/investor-interest-level.ts')).toContain("import type { WebsiteHealthPublic } from './website-health';");
  });
  it('both dossier routes hand the SAME field to the same projection (the real investor\'s and the founder\'s preview)', () => {
    for (const f of ['src/app/api/portal/startup/[orgId]/route.ts', 'src/app/api/settings/dossier-preview/route.ts']) {
      expect(read(f), f).toContain('raw.media, raw.websiteHealth)');
    }
  });
});

describe('no cron, no sweep over all orgs', () => {
  it('vercel.json schedules only /api/automations — and that route knows nothing of website health', () => {
    const cfg = JSON.parse(read('vercel.json')) as { crons: { path: string; schedule: string }[] };
    expect(cfg.crons.map((c) => c.path)).toEqual(['/api/automations']);
    const automations = SRC.filter((f) => f.startsWith('src/app/api/automations/'));
    expect(automations.length).toBeGreaterThan(0);
    for (const f of automations) expect(TOUCHES.test(read(f)), f).toBe(false);
  });
  it('Google is asked from exactly two places, both an explicit click: the founder\'s check and the back office\'s "Force re-check"', () => {
    const callers = SRC.filter((f) => /fetchPageSpeedAnalysis\(|runWebsiteCheck\(/.test(read(f)) && !/^src\/lib\/website-health-(psi|run)\.ts$/.test(f));
    expect(callers).toEqual(['src/app/api/backoffice/website-health/[orgId]/route.ts', 'src/app/api/website-health/check/route.ts']);
    for (const f of callers) expect(read(f), f).toMatch(/export (const|async function) POST\b/);
  });
});

describe('the Google analysis is free; only the summary is charged', () => {
  it('chargeAiAction appears in the summary route and nowhere else in website health', () => {
    const chargers = SRC.filter((f) => TOUCHES.test(read(f)) && /chargeAiAction\(|charge_ai_action/.test(code(f)));
    expect(chargers).toEqual(['src/app/api/website-health/summary/route.ts']);
  });
  it('the check routes and the libs they use do not even mention the wallet', () => {
    for (const f of ['src/app/api/website-health/check/route.ts', 'src/app/api/backoffice/website-health/[orgId]/route.ts', 'src/lib/website-health-psi.ts']) {
      expect(read(f), f).not.toMatch(/ai-credits|chargeAiAction|charge_ai_action|ai_credit/);
    }
  });
});

describe('a GET reads and nothing else (Developer Viewer rule)', () => {
  it('the card\'s state route has no write, no call out, no charge', () => {
    const src = read('src/app/api/website-health/route.ts').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(|chargeAiAction|fetchPageSpeedAnalysis|runWebsiteCheck|runWebsiteSummary|\bfetch\(/);
    expect(src).toContain('export const GET = withActingOrg(');
  });
  it('every write handler of the founder-side routes is wrapped (a viewer session answers 403 before it runs)', () => {
    for (const r of ['check', 'summary', 'visibility']) {
      expect(read(`src/app/api/website-health/${r}/route.ts`), r).toMatch(/export const POST = withActingOrg\(/);
    }
  });
  it('both back-office handlers begin with the platform-admin check', () => {
    const src = read('src/app/api/backoffice/website-health/[orgId]/route.ts');
    for (const m of ['GET', 'POST']) {
      const body = src.slice(src.indexOf(`export async function ${m}(`));
      expect(body.slice(0, 200), m).toContain('requirePlatformAdmin()');
    }
  });
});

describe('the Google key', () => {
  it('is read in exactly two places (the founder\'s check and the back office\'s force), never public', () => {
    const readers = SRC.filter((f) => /process\.env\.PAGESPEED_API_KEY/.test(read(f)));
    expect(readers).toEqual(['src/app/api/backoffice/website-health/[orgId]/route.ts', 'src/app/api/website-health/check/route.ts']);
    expect(SRC.filter((f) => /NEXT_PUBLIC_PAGESPEED/.test(read(f)))).toEqual([]);
  });
  it('no Google API key is written anywhere a repo carries one: sources, docs, scripts, migrations, env example', () => {
    const files = [...SRC, ...walk(path.join(ROOT, 'docs')).map(rel), ...walk(path.join(ROOT, 'scripts')).map(rel), ...walk(path.join(ROOT, 'supabase/migrations')).map(rel), '.env.example']
      .filter((f) => !/\.test\.tsx?$/.test(f) && /\.(ts|tsx|md|mjs|js|sql|json|example)$/.test(f));
    const hits = files.filter((f) => /AIza[0-9A-Za-z_-]{35}/.test(read(f)));
    expect(hits).toEqual([]);
  });
  it('the request builder adds the key only as the `key` parameter of the Google URL, and error text is scrubbed of it', () => {
    const src = read('src/lib/website-health-psi.ts');
    expect(src).toContain("if (apiKey) params.set('key', apiKey);");
    expect(src).toMatch(/const scrub = /);
  });
});

describe('the configuration is recorded where the project says configuration lives (CLAUDE.md "Config registry")', () => {
  it('.env.example documents the name — without a value', () => {
    const env = read('.env.example');
    expect(env).toMatch(/^#?\s*PAGESPEED_API_KEY=\s*$/m);
  });
  it('docs/ops/CONFIG_REGISTRY.md has a row for it, pending, with the exact instruction', () => {
    const reg = read('docs/ops/CONFIG_REGISTRY.md');
    expect(reg).toContain('PAGESPEED_API_KEY');
    expect(reg).toMatch(/PAGESPEED_API_KEY[^\n]*pendente/);
    expect(reg).toMatch(/PageSpeed Insights API/);
  });
});
