'use client';
// Investor Workspace Network (prompt 62.2) — "who else from your firm is
// here." Visibility only, no invite/permission management this pass.
import { useEffect, useState } from 'react';

interface Colleague { email: string; name: string | null }

export function ColleaguesCard() {
  const [colleagues, setColleagues] = useState<Colleague[] | null>(null);

  useEffect(() => {
    fetch('/api/portal/colleagues').then((r) => r.json()).then((d) => setColleagues(d.linked ? d.colleagues : []));
  }, []);

  if (!colleagues) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Your team on Sherlock Deal</h2>
      {colleagues.length === 0 ? (
        <p className="mt-1 text-xs text-gray-400">No other colleagues from your firm have joined yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {colleagues.map((c) => (
            <li key={c.email} className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-900">{c.name ?? c.email}</span>
              {c.name && <span className="text-xs text-gray-400">{c.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
