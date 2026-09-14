// Prompt 687 §1 — "Medir, não adivinhar." A tiny, dependency-free timer so
// getPipelineWaves' own blocks show up in Vercel's function logs with a
// single greppable prefix, never guessed at. Each call is independent (a
// label can be started/ended concurrently with others — Promise.all groups
// overlap on purpose), so this is plain Date.now() deltas, not a shared
// stopwatch state.
// `work` returns a PromiseLike, not a strict Promise, on purpose — a
// Supabase query builder (PostgrestFilterBuilder) is thenable but isn't a
// real Promise instance, and every caller here passes one of those
// directly (`() => admin.from(...).select(...)`), never wrapping it first.
export function timeBlock<T>(label: string, work: () => PromiseLike<T>): Promise<T> {
  const start = Date.now();
  return Promise.resolve(work()).then(
    (result) => { console.log(`[pipeline-timing] ${label}: ${Date.now() - start}ms`); return result; },
    (err) => { console.log(`[pipeline-timing] ${label}: ${Date.now() - start}ms (threw)`); throw err; },
  );
}
