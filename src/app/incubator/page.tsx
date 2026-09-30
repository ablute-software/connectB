'use client';
// Prompt I-01 §C.3 — /incubator, the incubator workspace. Protected by the
// middleware (not in PUBLIC); the data gate is requireIncubatorMember() on
// every /api/incubator/** route. Rendered bare by the founder Shell
// (isBareShellRoute), with its own sidebar.
import { IncubatorWorkspace } from '@/components/incubator/IncubatorWorkspace';

export default function IncubatorPage() {
  return <IncubatorWorkspace />;
}
