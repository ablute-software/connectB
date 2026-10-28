// Prompt 922 (I3) — a tiny host for the REAL EvaluationScreen and MyEvaluations, bundled into a real browser by evaluation-screen.browser.test.ts (the test answers their /api/calls/… requests). Test-only.
import { createRoot } from 'react-dom/client';
import { EvaluationScreen } from './EvaluationScreen';
import { MyEvaluations } from './MyEvaluations';

declare global { interface Window { __startEvaluation: () => void; __startMine: () => void; __log: string[] } }

window.__log = [];
window.__startEvaluation = () => {
  createRoot(document.getElementById('root')!).render(<div style={{ padding: 12 }}><EvaluationScreen callId="c1" applicationId="a1" onBack={() => window.__log.push('back')} /></div>);
};
window.__startMine = () => {
  createRoot(document.getElementById('root')!).render(<div style={{ padding: 12 }}><MyEvaluations onOpen={(c, a) => window.__log.push(`open ${c}/${a}`)} onCount={(n) => window.__log.push(`count ${n}`)} /></div>);
};
