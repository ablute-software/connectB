import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 704 (18/09/2026) — Phase 4: the funnel cards themselves become drop
// targets. No jsdom in this project (see FrostedGate.test.ts's own header),
// so the wiring is checked against the real source, same as every other
// component test here.
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('PipelineFunnel — Phase 4 drop targets, Active excluded', () => {
  const src = read('src/components/pipeline/PipelineFunnel.tsx');

  it('marks a card as a drop target using the SAME dropTargetAccepts function pipeline-drop.ts and usePipelineRowDrag.ts use — never a second, parallel rule', () => {
    expect(src).toContain("import { DROP_TARGET_INTERIOR, dropTargetAccepts } from '@/lib/pipeline-drop';");
    expect(src).toContain('const isDropTarget = dropTargetAccepts(card.key);');
    expect(src).toContain('data-drop-target={isDropTarget ? card.key : undefined}');
  });

  it('accepts dragActive/dragOver/dragPulse as optional props — a caller that never drags gets the old static header unchanged', () => {
    expect(src).toMatch(/dragActive\?:\s*boolean/);
    expect(src).toMatch(/dragOver\?:\s*PipelineCardKey \| null/);
    expect(src).toMatch(/dragPulse\?:\s*PipelineCardKey \| null/);
  });

  it('reuses the existing pipeline-drop-armed/pipeline-count-pulse/pipeline-plus-one classes instead of inventing new ones', () => {
    expect(src).toContain('pipeline-drop-armed');
    expect(src).toContain('pipeline-count-pulse');
    expect(src).toContain('pipeline-plus-one');
  });
});

describe('pipeline/page.tsx — wires the funnel to the drag state, retires the separate toolbar doors', () => {
  const src = read('src/app/pipeline/page.tsx');

  it('passes the live drag state into PipelineFunnel', () => {
    expect(src).toContain('dragActive={drag.active} dragOver={drag.over} dragPulse={dropPulse}');
  });

  it('no longer imports the retired toolbar PipelineDropTarget (Phase 4 moved it onto the cards)', () => {
    expect(src).not.toContain("from '@/components/pipeline/PipelineDropTarget'");
  });
});

describe('pipeline/page.tsx — Prompt 704 §A.2: an empty status band still renders, and is itself a drop target', () => {
  const src = read('src/app/pipeline/page.tsx');

  it('no longer hides a band just because it has zero rows', () => {
    expect(src).not.toContain('if (groupRows.length === 0 && cardFilter !== groupKey)');
  });

  it('an empty band renders a placeholder carrying the same data-drop-target attribute the funnel cards use', () => {
    expect(src).toContain('groupRows.length === 0 && (');
    expect(src).toContain('data-drop-target={groupKey}');
    expect(src).toContain('DROP_TARGET_INTERIOR[groupKey]');
  });

  it('imports DROP_TARGET_INTERIOR to word the placeholder the same way the funnel cards do', () => {
    expect(src).toContain('DROP_TARGET_INTERIOR');
    expect(src).toMatch(/import \{[^}]*DROP_TARGET_INTERIOR[^}]*\} from '@\/lib\/pipeline-drop'/);
  });
});

describe('usePipelineRowDrag — Prompt 704 auto-scroll, tied to the drag lifecycle', () => {
  const src = read('src/components/pipeline/usePipelineRowDrag.ts');

  it('imports the pure edge-autoscroll module rather than inlining the math', () => {
    expect(src).toContain("import { autoScroll, autoScrollDelta } from '@/lib/edge-autoscroll';");
  });

  it('starts the auto-scroll loop when a drag starts and stops it when a drag ends — never a free-running loop', () => {
    expect(src).toContain('autoScrollRafRef.current = window.requestAnimationFrame(tickAutoScroll)');
    expect(src).toContain('stopAutoScroll();');
    expect(src).toContain('window.cancelAnimationFrame(autoScrollRafRef.current)');
  });
});
