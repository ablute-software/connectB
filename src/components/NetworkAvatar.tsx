// Prompt 332 Pedido D — the investor/founder color convention, formalized
// as one reusable component instead of re-deriving the gradient/initials
// logic at every call site. teal/dark gradient = investor, gray gradient =
// founder — the same `kind: 'founder' | 'investor'` resolveActorDisplays
// already returns everywhere in My Network (ConnectionView.otherKind and
// every other *View in network/page.tsx). Also the natural home for
// Prompt 330's Pipeline "Partners & colleagues" panel to reuse later —
// built generic enough for that from the start, without waiting on 330.
export function NetworkAvatar({ name, kind, size = 'md' }: { name: string; kind: 'founder' | 'investor'; size?: 'sm' | 'md' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  const dims = size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs';
  const gradient = kind === 'investor'
    ? 'bg-gradient-to-br from-[#0E7490] to-[#134E4A]'
    : 'bg-gradient-to-br from-gray-400 to-gray-600';
  return (
    <span title={kind} className={`flex ${dims} shrink-0 items-center justify-center rounded-full font-semibold text-white ${gradient}`}>
      {initials}
    </span>
  );
}
