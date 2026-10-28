// Prompt 922 (I4) — a tiny host for the REAL EvaluationBoard, bundled into a real browser by evaluation-board.browser.test.ts (the test answers its /api/calls/… requests). Test-only.
import { createRoot } from 'react-dom/client';
import { EvaluationBoard } from './EvaluationBoard';

declare global { interface Window { __startBoard: () => void; __log: string[] } }

window.__log = [];
window.__startBoard = () => {
  createRoot(document.getElementById('root')!).render(<div style={{ padding: 12 }}><EvaluationBoard callId="c1" onOpen={(a) => window.__log.push(`open ${a}`)} /></div>);
};
