// Prompt 115 Block B — "Readiness & Train", promoted out of /dashboard into
// its own top-level nav tab (see src/components/shell.tsx). Was
// /dashboard's "Review & Optimization" separador.
import { ReadinessPanel } from '@/components/readiness/ReadinessPanel';

export default function ReadinessPage() {
  return <ReadinessPanel />;
}
