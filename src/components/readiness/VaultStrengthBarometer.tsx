'use client';
// Prompt 374 §G — "a importância das pistas, na perspectiva do Sherlock":
// the Vault-strength barometer, next to "Data Room completeness" (the list
// on the left, this on the right — the empty space the prompt calls out).
// Every number here comes from vault-strength.ts's pure, mechanical
// composition — nothing here is investor-facing (root privacy rule doesn't
// even apply: this is about DOCUMENTS, not platform/outreach performance,
// but it stays server-computed-and-founder-only regardless, same as every
// other Readiness & Train surface).
import type { VaultStrength } from '@/lib/vault-strength';

const LABEL_COLOR: Record<VaultStrength['label'], string> = {
  Thin: '#B00000', Reasonable: '#D97706', Strong: '#0E7490', Compelling: '#047857',
};

// Half-moon gauge: a semicircle arc, background in light gray, the strength
// fraction drawn over it in the label's own color via stroke-dasharray.
function HalfMoonGauge({ overall, label }: { overall: number; label: VaultStrength['label'] }) {
  const R = 80;
  const CX = 100, CY = 100;
  const ARC_LENGTH = Math.PI * R;
  const color = LABEL_COLOR[label];
  return (
    <svg viewBox="0 0 200 110" className="w-full max-w-[220px]" role="img" aria-label={`Vault strength: ${label}`}>
      <path d={`M ${CX - R},${CY} A ${R},${R} 0 0 1 ${CX + R},${CY}`} fill="none" stroke="#E5E7EB" strokeWidth={14} strokeLinecap="round" />
      <path d={`M ${CX - R},${CY} A ${R},${R} 0 0 1 ${CX + R},${CY}`} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round"
        strokeDasharray={ARC_LENGTH} strokeDashoffset={ARC_LENGTH * (1 - overall)} />
      <text x={CX} y={CY - 8} textAnchor="middle" fontSize={22} fontWeight={700} fill={color}>{label}</text>
      <text x={CX} y={CY + 10} textAnchor="middle" fontSize={10} fill="#9CA3AF">{Math.round(overall * 100)}/100</text>
    </svg>
  );
}

function SubBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full rounded-full bg-gray-100">
        <div className="h-1.5 rounded-full bg-[#0E7490]" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

export function VaultStrengthBarometer({ strength, suggestion }: { strength: VaultStrength; suggestion: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">
        No AI — quantity, variety, importance and freshness of what&apos;s in your Vault, computed the same way every
        time. Never shown to investors.
      </p>
      <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <HalfMoonGauge overall={strength.overall} label={strength.label} />
        <div className="w-full space-y-2">
          <SubBar label="Quantity" value={strength.quantity} />
          <SubBar label="Variety" value={strength.variety} />
          <SubBar label="Importance" value={strength.importance} />
          <SubBar label="Freshness" value={strength.freshness} />
        </div>
      </div>
      <p className="mt-3 rounded-lg bg-[#E8F4F8] p-2 text-xs text-[#0E7490]">{suggestion}</p>
    </div>
  );
}
