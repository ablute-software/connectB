// Item #15 — 'server-only' is a Next.js-bundler-special-cased package (not a
// real dependency; not in package.json/package-lock.json), so it's
// unresolvable under plain Node/vitest. It never surfaced before because
// none of the existing capability-probe files (investor-interest-level-
// capability.ts, round-valuation-basis-capability.ts, etc.) were imported,
// even transitively, by a file under test. pipeline-test-flag-capability.ts
// is imported directly by portal-access.ts, which portal-access.test.ts
// covers — first time this import chain crosses into tested code. This
// empty stub is aliased in for tests only (see vitest.config.ts); it has no
// exports because 'server-only' itself has none — it's imported purely for
// its side effect (throwing when bundled into client code), which is
// irrelevant in a test run.
export {};
