'use client';
// Prompt I-01 §C.3 / I-01c §B — /ecosystem, the Ecosystem workspace (the
// user-facing name of the incubator workspace; "incubator" stays the
// technical name). Protected by the middleware (not in PUBLIC); the data gate
// is requireIncubatorMember() on every /api/incubator/** route. Rendered bare
// by the founder Shell (isBareShellRoute), with its own sidebar.
import { IncubatorWorkspace } from '@/components/incubator/IncubatorWorkspace';

export default function EcosystemPage() {
  return <IncubatorWorkspace />;
}
