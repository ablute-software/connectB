'use client';
// Prompt 893 §B — the guided first-contact card. Shown "no topo do +Log"
// (RailLogForm.tsx) whenever the currently-selected person (or the
// no-specific-person channel) has never been contacted before, or the
// page was reached via ?tab=conversation&mode=log&person=. Purely
// presentational — RailLogForm computes every value below from its own
// state (person, channel, content) and the shared relationship.ts/
// channel-learning.ts functions; this component owns none of that state.
import type { Person } from '@/lib/types';
import type { ChannelRecommendation } from '@/lib/relationship';

function StepDot({ done }: { done: boolean }) {
  return (
    <span aria-hidden className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
      done ? 'bg-[#0E7490] text-white' : 'border border-gray-300 text-transparent'}`}>
      {done ? '✓' : '·'}
    </span>
  );
}

export function FirstContactGuideCard({
  person, noSpecificPerson, personDone, channel, channelDone, messageDone,
  outcomesSummary, showFormAssist, onPrepareFormAnswers,
}: {
  person?: Person;
  noSpecificPerson: boolean;
  personDone: boolean;
  channel: ChannelRecommendation;
  channelDone: boolean;
  messageDone: boolean;
  outcomesSummary: string;
  showFormAssist: boolean;
  onPrepareFormAnswers: () => void;
}) {
  const linkedInStep = person?.linkedin_url ? (
    <a href={person.linkedin_url} target="_blank" rel="noreferrer" className="font-medium text-[#0E7490] hover:underline">Open LinkedIn ↗</a>
  ) : person ? (
    <a href={`/people/${person.id}`} className="font-medium text-[#0E7490] hover:underline">No LinkedIn on file — add it</a>
  ) : null;

  return (
    <div className="rounded-xl border border-[#0E7490]/25 bg-[#E8F4F8]/50 p-3">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#0E7490]">First contact — a quick guide</div>
      <ol className="mt-2 space-y-2.5 text-[12.5px] text-gray-700">
        <li className="flex gap-2">
          <StepDot done={personDone} />
          <div>
            <span className="font-semibold text-gray-800">Who — </span>
            {person ? (
              <>
                {person.full_name}{person.role ? `, ${person.role}` : ''} (rank {person.seniority_rank}).{' '}
                {linkedInStep}
                {person.email_verified && <span className="ml-1 text-gray-500">· {person.email_verified} (verified)</span>}
              </>
            ) : noSpecificPerson ? (
              <span>No specific person — reaching out to the firm generally.</span>
            ) : (
              <span className="text-gray-400">Select a person above, or choose &quot;No specific person&quot;.</span>
            )}
          </div>
        </li>
        <li className="flex gap-2">
          <StepDot done={channelDone} />
          <div>
            <span className="font-semibold text-gray-800">Channel — </span>
            <span>{channel.label}</span>
            <div className="text-gray-500">{channel.reason}</div>
            <div className="mt-0.5 text-gray-500">{outcomesSummary}</div>
            {showFormAssist && (
              <button type="button" onClick={onPrepareFormAnswers}
                className="mt-1.5 rounded-lg border border-cyan-200 px-2.5 py-1 text-[11px] font-medium text-cyan-800 hover:bg-cyan-50">
                ✨ Prepare form answers
              </button>
            )}
          </div>
        </li>
        <li className="flex gap-2">
          <StepDot done={messageDone} />
          <div>
            <span className="font-semibold text-gray-800">Message — </span>
            <span>How we pitch this firm and what we ask for first, below — Watson uses both when drafting.</span>
          </div>
        </li>
        <li className="flex gap-2">
          <StepDot done={false} />
          <div>
            <span className="font-semibold text-gray-800">Send — </span>
            <span>Send it yourself on {channel.label.toLowerCase()}, then paste it here verbatim.</span>
            {linkedInStep && <span className="ml-1">{linkedInStep}</span>}
          </div>
        </li>
        <li className="flex gap-2">
          <StepDot done={false} />
          <div>
            <span className="font-semibold text-gray-800">Log — </span>
            <span>Save below once it&apos;s sent — this closes the guide and moves the stage to Contacted.</span>
          </div>
        </li>
      </ol>
    </div>
  );
}
