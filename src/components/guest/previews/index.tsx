// Prompt 548 Part 3 — one frosted body per nav entry.
//
// Each is the real screen's furniture and nothing else: no data, no store,
// no fetch. The header and sub-tab names come from the product itself
// (EVALUATION_TOOLS) or are the screen's own fixed title; the rest is
// deliberately empty shapes, because there is nothing real a guest is
// entitled to see and a plausible-looking fake would be worse than a blur.
import { EVALUATION_TOOLS } from '@/lib/evaluation-tools';
import { PreviewCard, PreviewRows, PreviewStats, PreviewSubTabs } from './PreviewChrome';

export function PipelinePreview() {
  return (
    <>
      <PreviewStats labels={['Watching', 'In diligence', 'Passed', 'Committed']} />
      <PreviewRows count={6} />
    </>
  );
}

export function WatsonPreview() {
  return (
    <>
      <PreviewCard title="Ask Watson about this round" lines={2} />
      <div className="mt-3 space-y-3">
        <PreviewCard lines={4} />
        <PreviewCard lines={3} />
      </div>
    </>
  );
}

export function BarsPreview() {
  return (
    <>
      <PreviewSubTabs tabs={[{ label: 'Risk bands' }, { label: 'Evidence' }, { label: 'Score' }]} />
      <div className="grid gap-3 sm:grid-cols-2">
        <PreviewCard title="Team" lines={3} />
        <PreviewCard title="Market" lines={3} />
        <PreviewCard title="Product" lines={3} />
        <PreviewCard title="Traction" lines={3} />
      </div>
    </>
  );
}

export function AboutPreview() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <PreviewCard title="Your thesis" lines={4} />
        <PreviewCard title="Ticket & stage" lines={3} />
        <PreviewCard title="Sectors" lines={2} />
        <PreviewCard title="Geographies" lines={2} />
      </div>
    </>
  );
}

export function DashboardPreview() {
  return (
    <>
      <PreviewStats labels={['New this week', 'Awaiting you', 'Meetings', 'Follow-ons']} />
      <div className="grid gap-3 sm:grid-cols-2">
        <PreviewCard title="Funnel" lines={5} />
        <PreviewCard title="This week" lines={5} />
      </div>
    </>
  );
}

export function EvaluationPreview() {
  // The real sub-tab list, imported — never retyped.
  return (
    <>
      <PreviewSubTabs tabs={EVALUATION_TOOLS} />
      <div className="grid gap-3 sm:grid-cols-2">
        <PreviewCard title="Inputs" lines={5} />
        <PreviewCard title="Result" lines={5} />
      </div>
    </>
  );
}

export function ActionsPreview() {
  return <PreviewRows count={5} />;
}

export function AgendaPreview() {
  return (
    <>
      <PreviewSubTabs tabs={[{ label: 'Upcoming' }, { label: 'This week' }, { label: 'Done' }]} />
      <PreviewRows count={5} />
    </>
  );
}

export function NetworkPreview() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => <PreviewCard key={i} lines={2} />)}
    </div>
  );
}

export function MessagesPreview() {
  return (
    <div className="grid gap-3 md:grid-cols-[220px_1fr]">
      <PreviewRows count={4} />
      <PreviewCard lines={8} />
    </div>
  );
}

export function SupportPreview() {
  return (
    <>
      <PreviewCard title="Open a conversation" lines={3} />
      <div className="mt-3"><PreviewRows count={3} /></div>
    </>
  );
}

// Keyed lookup, so the two route families pick a body by nav key without a
// switch statement in each.
export const PREVIEW_BODIES: Record<string, () => React.ReactElement> = {
  pipeline: PipelinePreview,
  watson: WatsonPreview,
  bars: BarsPreview,
  about: AboutPreview,
  dashboard: DashboardPreview,
  evaluation: EvaluationPreview,
  actions: ActionsPreview,
  agenda: AgendaPreview,
  network: NetworkPreview,
  messages: MessagesPreview,
  support: SupportPreview,
};
