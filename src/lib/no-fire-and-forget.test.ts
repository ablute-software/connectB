import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Prompt 465 §E — a promise left running after a serverless function's
// response is sent gets no more CPU: the instance is frozen the instant the
// response goes out. Confirmed in production TWICE independently
// (support/submit's own header comment, and Prompt 463 §C's `void
// extractDocument(...)` after `return`, which produced zero new
// document_extractions rows and zero ai_call_log entries for 60+ seconds —
// fixed in Prompt 464 — and again in document-extraction-pipeline.ts's own
// `void runReconciliationForOrg(...)`, fixed here in §A). From Prompt 465
// on: no work after the response — only work explicitly requested by a
// caller that can await it (a client call, or the daily cron safety net).
//
// WHAT THIS TEST IS, AND WHAT IT IS NOT (Prompt 465 §E, verbatim intent):
// this is a guard against the CONCRETE pattern that has already burned this
// codebase twice — a bare `void <identifier>(...)` statement in server
// code — never the general invariant "no floating promise in server code".
// A plain regex over source text cannot see `void service.save()` (a
// member-expression call), `foo?.()`, a `promise.then(...)` with no
// `.catch()`, or an async call made with neither `void` nor `await` at
// all. Catching those needs real static analysis
// (@typescript-eslint/no-floating-promises) — the right reinforcement
// long-term, and explicitly out of scope for this prompt. A green run of
// this test is proof the ONE known pattern hasn't come back, nothing more.
//
// Also known and accepted: line-based, not AST-based, so it only skips a
// FULL-LINE `//` comment before matching (the concrete false positive this
// test was written against: this very codebase's own
// feed-documents-to-platform.ts has a header comment that mentions `void
// extractDocument(...)` in prose). A trailing same-line comment or a
// `/* */` block comment containing the pattern is NOT specifically
// handled — none currently exists in src/lib or src/app/api (this test
// would need updating the day one does).
//
// Scope: src/lib and src/app/api only, .ts/.tsx, test files excluded (they
// never run as deployed server code). src/components/ is NEVER scanned —
// `onClick={() => void save()}` there is idiomatic and correct, a browser
// tab doesn't freeze the way a serverless response does.
//
// A file starting with the `'use client'` directive is skipped too, even
// under src/lib — the folder alone isn't the real signal Next.js itself
// uses to decide server vs. client, and src/lib holds real client code
// under that exact directive (store-supabase.tsx among 15 others,
// confirmed by grep): the SAME "the browser doesn't freeze" exemption
// applies there as in src/components/, just not captured by a path rule
// that assumes client code only lives in one folder.
//
// Exemption: a reviewed, legitimate case is marked with an explicit
// `// fire-and-forget-ok: <reason>` comment on the line immediately before
// it — never by loosening the regex below. See the ~35 `void
// logAiCall(...)` call sites across this codebase for the standing example:
// logAiCall's own contract (ai-cost-log.ts) is fire-and-forget BY DESIGN
// (it swallows its own errors) and a dropped cost-log entry never corrupts
// state, unlike reconciliation, whose entire job IS writing the very rows
// this bug used to silently skip.

const ROOTS = ['src/lib', 'src/app/api'];
const VOID_CALL = /\bvoid\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
const EXEMPTION = /^\s*\/\/\s*fire-and-forget-ok:\s*\S/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (['.ts', '.tsx'].includes(extname(entry)) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

// Exported in shape only for this file's own self-tests below — never
// consumed anywhere else. Takes raw source text (one file's worth) and
// returns the 1-based line numbers of every un-exempted `void fn(...)`.
function findViolations(source: string): number[] {
  const lines = source.split('\n');
  const violations: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\//.test(line)) continue; // full-line comment — see header
    if (!VOID_CALL.test(line)) continue;
    const prevLine = lines[i - 1] ?? '';
    if (EXEMPTION.test(prevLine)) continue;
    violations.push(i + 1);
  }
  return violations;
}

describe('findViolations (detector self-test — proves the mechanism before trusting it on the real tree)', () => {
  it('flags a bare void call to a server function', () => {
    expect(findViolations('function f() {\n  void runReconciliationForOrg(admin, apiKey, orgId);\n}')).toEqual([2]);
  });

  it('flags it even guarded by an if with no braces (the exact Prompt 465 §A pattern)', () => {
    expect(findViolations('if (await gapReconciliationsAvailable()) void runReconciliationForOrg(admin, apiKey, orgId);')).toEqual([1]);
  });

  it('does NOT flag a call with an exemption comment on the line directly before it', () => {
    expect(findViolations('// fire-and-forget-ok: logAiCall swallows its own errors by design\nvoid logAiCall({ route: \'x\' });')).toEqual([]);
  });

  it('does NOT flag `void` mentioned only in prose inside a full-line comment (the known false positive this test was written against)', () => {
    const text = '// frozen the instant its response is sent, so a `void extractDocument(...)`\n// call never survives.\nconst x = 1;';
    expect(findViolations(text)).toEqual([]);
  });

  it('does NOT flag void used on a non-call value (void 0, a bare identifier)', () => {
    expect(findViolations('const x = void 0;\nvoid someValue;')).toEqual([]);
  });

  it('does NOT flag a member-expression call — a real, documented gap of this simple regex, not silently pretended away', () => {
    expect(findViolations('void service.save();')).toEqual([]);
  });

  it('reports every distinct violation line, not just the first', () => {
    expect(findViolations('void a();\nconst ok = 1;\nvoid b();')).toEqual([1, 3]);
  });
});

describe('no fire-and-forget after the response — the real sweep (Prompt 465 §E)', () => {
  it('every void-called function in src/lib and src/app/api is either fixed or has an explicit fire-and-forget-ok comment', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of listSourceFiles(join(process.cwd(), root))) {
        const text = readFileSync(file, 'utf8');
        if (/^['"]use client['"]/.test(text.trimStart())) continue; // real client code, even under src/lib — see header
        for (const line of findViolations(text)) offenders.push(`${file}:${line}`);
      }
    }
    expect(
      offenders,
      'A promise left running after a serverless response is sent never survives (see this test\'s own header — confirmed in '
      + 'production twice). Add a "// fire-and-forget-ok: <reason>" comment on the line before each offender below, or fix it '
      + `to be awaited by an explicit caller instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
