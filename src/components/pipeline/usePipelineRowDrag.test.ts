import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 704 §A.1 (18/09/2026) — a ghost row was found stuck floating over
// the Pipeline list in production, surviving a drop that landed nowhere
// valid, until an unrelated click. No jsdom in this project (see
// FrostedGate.test.ts's own header), so the fix is checked against the real
// source, same as every other hook/component test here.
const src = readFileSync(join(process.cwd(), 'src/components/pipeline/usePipelineRowDrag.ts'), 'utf8');

describe('usePipelineRowDrag — every drag-ending path guarantees the ghost is removed', () => {
  it('onUp calls endDrag from a finally block, not as one more step a thrown error could skip', () => {
    const onUpBody = src.slice(src.indexOf('const onUp = async'), src.indexOf('const onCancel ='));
    expect(onUpBody).toMatch(/try\s*\{/);
    expect(onUpBody).toMatch(/\}\s*finally\s*\{\s*endDrag\(d\);\s*\}/);
  });

  it('cancelDrag calls endDrag from a finally block too', () => {
    const cancelDragBody = src.slice(src.indexOf('const cancelDrag = async'), src.indexOf('const onMove ='));
    expect(cancelDragBody).toMatch(/try\s*\{/);
    expect(cancelDragBody).toMatch(/\}\s*finally\s*\{\s*endDrag\(d\);\s*\}/);
  });

  it('a window blur mid-drag cancels it — a drag can outlive focus (alt-tab, an OS dialog) with no pointerup/pointercancel ever coming', () => {
    expect(src).toContain("window.addEventListener('blur', onBlur)");
    expect(src).toContain("window.removeEventListener('blur', onBlur)");
    expect(src).toContain('const onBlur = () => { if (dragRef.current) void cancelDrag(); };');
  });
});
