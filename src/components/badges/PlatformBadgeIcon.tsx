// Prompt 601 §H — five icons, different from each other and more elaborate
// as the importance grows: Toughness → Dyed-in-the-wool → Sedulous (gains
// detail with its count) → pioneer → tech master. Colours are the
// back-office tokens (globals.css --sb-*), so the ladder reads the same on
// the dark sidebar and on the light founder pages. Inline SVG, no assets.
import type { PlatformBadgeKey } from '@/lib/platform-badges';

const ACCENT = 'var(--sb-accent)';
const SUCCESS = 'var(--sb-success)';
const DIM = 'var(--sb-dim)';
const DANGER = 'var(--sb-danger)';

export function PlatformBadgeIcon({ badge, size = 28, count = 0, className, title }: {
  badge: PlatformBadgeKey; size?: number; count?: number; className?: string; title?: string;
}) {
  const common = { width: size, height: size, viewBox: '0 0 32 32', className, role: 'img' as const, 'aria-label': title ?? badge };

  switch (badge) {
    case 'toughness':
      // 1 — a plain shield.
      return (
        <svg {...common}>
          {title && <title>{title}</title>}
          <path d="M16 3 L27 7 V15 C27 22 22 27 16 29 C10 27 5 22 5 15 V7 Z" fill="none" stroke={DIM} strokeWidth="2" strokeLinejoin="round" />
        </svg>
      );
    case 'dyed_in_the_wool':
      // 2 — the shield, filled, with an inner ring.
      return (
        <svg {...common}>
          {title && <title>{title}</title>}
          <path d="M16 3 L27 7 V15 C27 22 22 27 16 29 C10 27 5 22 5 15 V7 Z" fill={DIM} opacity="0.25" stroke={DIM} strokeWidth="2" strokeLinejoin="round" />
          <circle cx="16" cy="16" r="5.5" fill="none" stroke={DIM} strokeWidth="2" />
        </svg>
      );
    case 'sedulous': {
      // 3 — the shield with a tick, plus one dot per unit (up to 8) around
      // it: the icon itself gains detail as the count rises.
      const dots = Math.min(Math.max(count, 0), 8);
      return (
        <svg {...common}>
          {title && <title>{title}</title>}
          <path d="M16 4 L26 8 V15 C26 21 21.5 25.5 16 27.5 C10.5 25.5 6 21 6 15 V8 Z" fill={SUCCESS} opacity="0.2" stroke={SUCCESS} strokeWidth="2" strokeLinejoin="round" />
          <path d="M11.5 16 L14.5 19 L20.5 12.5" fill="none" stroke={SUCCESS} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          {Array.from({ length: dots }, (_, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / 8;
            return <circle key={i} cx={16 + 14 * Math.cos(a)} cy={16 + 14 * Math.sin(a)} r="1.6" fill={SUCCESS} />;
          })}
        </svg>
      );
    }
    case 'pioneer':
      // 4 — a compass rose: eight points, an inner ring, a needle.
      return (
        <svg {...common}>
          {title && <title>{title}</title>}
          <circle cx="16" cy="16" r="13" fill="none" stroke={ACCENT} strokeWidth="1.5" />
          <path d="M16 2 L18.5 13.5 L30 16 L18.5 18.5 L16 30 L13.5 18.5 L2 16 L13.5 13.5 Z" fill={ACCENT} opacity="0.25" stroke={ACCENT} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M16 6 L18 16 L16 26 L14 16 Z" fill={ACCENT} />
          <path d="M6 16 L16 14 L26 16 L16 18 Z" fill={ACCENT} opacity="0.6" />
          <circle cx="16" cy="16" r="2.2" fill="white" stroke={ACCENT} strokeWidth="1.2" />
        </svg>
      );
    case 'tech_master':
      // 5 — a twelve-tooth gear around a crown, with rays: the most elaborate.
      return (
        <svg {...common}>
          {title && <title>{title}</title>}
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * 2 * Math.PI) / 12;
            const x1 = 16 + 11.5 * Math.cos(a); const y1 = 16 + 11.5 * Math.sin(a);
            const x2 = 16 + 15 * Math.cos(a); const y2 = 16 + 15 * Math.sin(a);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />;
          })}
          <circle cx="16" cy="16" r="11.5" fill={ACCENT} opacity="0.15" stroke={ACCENT} strokeWidth="2" />
          <path d="M9.5 20.5 L9.5 13 L13 16.5 L16 10.5 L19 16.5 L22.5 13 L22.5 20.5 Z" fill={DANGER} opacity="0.9" stroke={ACCENT} strokeWidth="1" strokeLinejoin="round" />
          <circle cx="16" cy="10.5" r="1.3" fill="white" />
        </svg>
      );
  }
}
