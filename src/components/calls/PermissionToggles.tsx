'use client';
// Prompt 909 (I3) — the nine permissions as switches, for a category or for one person. The two that the server
// enforces already are plain; the other six are stored and shown, with "Used from the next stage" beside them.
import { PERMISSIONS, type PermissionKey, type PermissionSet } from '@/lib/calls/permissions';

export function PermissionToggles({ values, onToggle, disabled, idPrefix, markAdjusted }: {
  values: PermissionSet; onToggle: (key: PermissionKey, value: boolean) => void; disabled: boolean; idPrefix: string;
  /** For a person: the keys that differ from their category, shown as "adjusted". */
  markAdjusted?: Partial<PermissionSet>;
}) {
  return (
    <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2" data-testid={`${idPrefix}-permissions`}>
      {PERMISSIONS.map((p) => (
        <li key={p.key}>
          <label className="flex items-start gap-2 text-xs text-gray-800">
            <input type="checkbox" className="mt-0.5" checked={values[p.key]} disabled={disabled} data-testid={`${idPrefix}-${p.key}`}
              onChange={(e) => onToggle(p.key, e.target.checked)} />
            <span>
              {p.label}
              {markAdjusted && typeof markAdjusted[p.key] === 'boolean' && <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-800">adjusted</span>}
              {!p.enforced && <span className="ml-1.5 text-[10px] text-gray-400">Used from the next stage</span>}
              <span className="block text-[10px] font-normal text-gray-400">{p.hint}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
