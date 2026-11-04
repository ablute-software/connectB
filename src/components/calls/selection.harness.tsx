// Prompt 925 — a tiny host for the REAL SelectionRulesStep and SelectionPanel, bundled into a real browser by selection.browser.test.ts. Test-only: nothing in the app imports it.
import { createRoot } from 'react-dom/client';
import { SelectionPanel } from './SelectionPanel';
import { SelectionRulesStep } from './SelectionRulesStep';

declare global { interface Window { __startSelStep: () => void; __startSelPanel: () => void; __selChanged: number; __selVersion: number } }
window.__selChanged = 0; window.__selVersion = -1;

window.__startSelStep = () => { createRoot(document.getElementById('root')!).render(<div className="mx-auto max-w-3xl p-3"><SelectionRulesStep callId="c1" canManage onVersion={(v) => { window.__selVersion = v; }} /></div>); };
window.__startSelPanel = () => { createRoot(document.getElementById('root')!).render(<div className="mx-auto max-w-3xl p-3"><SelectionPanel callId="c1" onChanged={() => { window.__selChanged += 1; }} /></div>); };
