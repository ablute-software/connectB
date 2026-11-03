// Prompt 935 — the twelve line icons of the wheel (the mockup's `I` object), as components. Stroke and size come from the stylesheet (.fx-wheel svg), not from here.
import type { IconName } from '@/content/site/landing-fixed';

const PATHS: Record<IconName, React.ReactNode> = {
  overview: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></>),
  find: (<><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></>),
  fundraise: (<><path d="M4 18l5-6 4 3 7-9" /><path d="M14 6h6v6" /></>),
  ai: (<><path d="M10 4l1.9 5.1L17 11l-5.1 1.9L10 18l-1.9-5.1L3 11l5.1-1.9z" /><path d="M18 3v4M16 5h4M18.5 15v4M16.5 17h4" /></>),
  share: (<><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>),
  pricing: (<><path d="M20 12l-8 8-8-8V4h8z" /><circle cx="8" cy="8" r="1.2" /></>),
  docs: (<><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>),
  faq: (<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h0" /></>),
  discover: (<><circle cx="12" cy="12" r="9" /><path d="M15 9l-2 5-5 2 2-5z" /></>),
  review: (<path d="M5 12l4 4L19 6" />),
  pipeline: (<path d="M4 6h16M4 12h10M4 18h6" />),
  mandate: (<path d="M4 6h16M8 12h8M11 18h2" />),
};

export function WheelIcon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>;
}
