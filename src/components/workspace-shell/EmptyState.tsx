// Prompt 127 Bloco A (addenda §5) — unifies the app's dominant ad-hoc
// empty-state shape (`mx-auto mt-16 max-w-sm rounded-lg border
// border-gray-200 bg-white p-6 text-center`, a message and sometimes a
// lighter second line, occasionally a single action button) rather than
// inventing a new visual vocabulary.
export function EmptyState({ message, hint, action, className = 'mx-auto mt-16 max-w-sm' }: {
  message: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">{message}</p>
        {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
        {action && (
          <button onClick={action.onClick} className="mt-4 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
