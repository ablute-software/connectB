'use client';
// Prompt 576 Fase 3 — React glue around queue-table-state.ts's pure
// parse/serialize functions, kept in a separate file so that module stays
// exactly what its own header says it is ("Pure on purpose"). This is the
// only new piece: the Startups/Investors Accounts tables reuse the SAME
// page/sort/dir/filters shape the Queue already put in the URL, rather than
// a second state format invented for two more tables.
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  parseQueueTableState, serializeQueueTableState, nextStateFor, toggleSort,
  type QueueTableState, type ColumnSortType,
} from './queue-table-state';

export function useTableUrlState(opts: {
  sortableKeys?: string[];
  // Prompt 582 — a second table (Catalog) wants the same type-aware first-
  // click direction Fase 3 gave Startups/Investors (queue-table-state.ts's
  // own toggleSort). That fix was applied per-page there (Nuno's own
  // verification session wrote it directly into each page's local toggle
  // wrapper); this hook-level version is additive — a third return value
  // callers can ignore — so it doesn't touch or risk diverging from that
  // already-shipped, already-tested code.
  columnTypes?: Record<string, ColumnSortType>;
} = {}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const sortableKey = opts.sortableKeys?.join(',');

  const state = useMemo(
    () => parseQueueTableState(searchParams, opts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searchParams, sortableKey],
  );

  const setState = useCallback((change: Partial<QueueTableState>) => {
    const next = nextStateFor(state, change);
    const qs = serializeQueueTableState(next, searchParams);
    router.replace(qs.toString() ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [state, searchParams, pathname, router]);

  const setSort = useCallback((key: string) => {
    const { dir } = toggleSort(state, key, opts.columnTypes?.[key]);
    setState({ sort: key, dir });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, setState, opts.columnTypes]);

  return [state, setState, setSort] as const;
}
