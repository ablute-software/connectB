// Prompt 167 — capability probe for migration 0161's
// company_roadmap_milestones table. Gates RoadmapCard's editing UI (and the
// investor-facing read) until the migration is confirmed applied — same
// pattern as reviewClarificationsAvailable (review-clarifications-capability.ts).
import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

export const companyRoadmapAvailable = makeCapabilityProbe(async (admin) => {
  const { error } = await admin.from('company_roadmap_milestones').select('id').limit(1);
  return !error;
});
