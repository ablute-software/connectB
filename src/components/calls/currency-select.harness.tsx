// Prompt 927 (D) — a tiny host for the REAL CurrencySelect, bundled into a real browser by currency-select.browser.test.ts. Test-only: nothing in the app imports it.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CurrencySelect } from './CurrencySelect';

declare global { interface Window { __startCurrency: (initial: string) => void; __currencyValue: string } }

function Host({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  window.__currencyValue = value;
  return (
    <div className="mx-auto max-w-xl p-4">
      <label htmlFor="cur" className="block text-xs font-semibold uppercase">Currency</label>
      <CurrencySelect id="cur" className="block w-full min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" value={value} onChange={setValue} />
      <p className="mt-2 text-xs text-gray-500">Used by amount fields.</p>
    </div>
  );
}

window.__startCurrency = (initial) => { createRoot(document.getElementById('root')!).render(<Host initial={initial} />); };
