// The composer's prompt assembly, extracted from route.ts in Prompt 517.
//
// It lives beside the route rather than inside it for one hard reason: a
// Next.js route module may only export its HTTP handlers and a fixed set of
// config keys, so a pure helper a test wants to call cannot be exported from
// route.ts at all — `next build` fails the type check on the extra export
// (confirmed, not assumed: that is exactly how this file came to exist).
// Everything here is pure — context in, string out, no I/O — which is what
// makes the assembled prompt readable in build-prompt.test.ts.
import type { ComposerContext, ComposerIntent } from '@/lib/composer';
import { wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { growthSignalTierPromptList } from '@/lib/growth-signal-tiers';
import type { Channel } from '@/lib/types';

const CHANNEL_GUIDANCE: Record<Channel, string> = {
  linkedin_dm: 'LinkedIn DM: under 900 characters, no links to editable docs, conversational.',
  linkedin_note: 'LinkedIn connection note: very short (under 300 characters), no ask yet — just the reason to connect.',
  email: 'Email: include a short subject line, keep the body under ~150 words, one clear ask.',
  web_form: 'Web form submission: formal, complete, no informalities — this is often the first read.',
  call: 'Call talking points: bullet-style opening lines, not a script to read verbatim.',
  meeting: 'Meeting follow-up or confirmation: reference what was discussed, confirm next step.',
  event: 'Event follow-up: reference where you met, keep it light.',
  intro: 'Warm intro message (to the connector or the target): thank the connector, or open warmly referencing them.',
  stage_change: 'N/A',
};

const INTENT_GUIDANCE: Record<ComposerIntent, string> = {
  first_touch: 'This is the FIRST message ever sent to this person. Open with a specific, true, recent hook about them — never generic. State the one small ask clearly.',
  follow_up: 'This is a FOLLOW-UP after a period of silence. Do not repeat the first message verbatim. Reference the earlier note briefly, add one new piece of information or angle, keep the ask the same and small.',
  reply: 'This REPLIES to their most recent inbound message (see prior thread). Address what they actually said — do not ignore it or restate the pitch from scratch.',
  meeting_ask: 'Propose or confirm a specific meeting — suggest 2-3 concrete time windows, keep logistics simple.',
};

// Prompt 517 §1b — how much room a channel actually has for a "we went from
// X to Y" line. Stated per channel rather than left to the model: asked to
// show progression without a budget, it reliably spends the space on a
// chronological list, which is the one shape that doesn't fit anywhere. The
// character counts here restate CHANNEL_GUIDANCE's own limits on purpose —
// the model needs the constraint in the same breath as the instruction.
const PROGRESSION_BUDGET: Record<Channel, string> = {
  linkedin_dm: 'ONE compressed sentence, inside the 900-character limit. Never a chronological list, never bullets.',
  linkedin_note: 'NO progression — under 300 characters there is no room. Lead with the single strongest signal and stop.',
  email: 'AT MOST two sentences. Still prose, still not a list.',
  web_form: 'AT MOST two sentences, in the same formal register as the rest.',
  call: 'ONE bullet — the arc in a single line the founder can say out loud.',
  meeting: 'ONE sentence at most, and only if it adds to what was already discussed.',
  event: 'ONE short clause. This is a light message.',
  intro: 'ONE sentence at most — the connector needs the arc, not the detail.',
  stage_change: 'N/A',
};

// Exported for src/app/api/compose/build-prompt.test.ts only — a pure
// function, no I/O, so the assembled prompt can actually be read back in a
// test rather than asserted by eye. Nothing else imports it.
export function buildPrompt(context: ComposerContext, channel: Channel, intent: ComposerIntent) {
  // IRM_SPEC §11b/§11c — only appended when the caller actually has
  // confirmed canon facts (see composer.ts's buildComposerContext, itself
  // gated on confirmedFacts.length > 0). Empty/absent context.companyFacts
  // means these blocks never render — the prompt is byte-identical to
  // before §11 for every caller until at least one fact is confirmed.
  const canonBlock = context.companyFacts?.length ? [
    '',
    'CONFIRMED COMPANY FACTS (the ONLY facts about the company you may assert — cite by id):',
    context.companyFacts.map((f) => `[${f.id}] (${f.category}) ${f.statement}`).join('\n'),
    '',
    'PROVENANCE RULE (hard): every factual sentence about the company in your draft must map to one of the',
    'fact ids above via the claims[] output field. If you need to state something about the company that is',
    'NOT covered by these facts, do not invent it — instead add a claims[] entry with needsConfirmation',
    '(a short question + 2-4 suggested answers) and write the draft sentence generically enough to still read',
    'naturally either way.',
  ] : [];

  // Prompt 517 — the growth-signal hierarchy (src/lib/growth-signal-tiers.ts,
  // shared with the Roadmap's empty-state checklist; never restate it here).
  // Two instructions, both only meaningful once there are facts to rank:
  //   §1a lead with the strongest signal available, and never phrase a weak
  //       one — an intro, a conversation, interest with nothing committed —
  //       as though something were agreed;
  //   §1b when 2+ facts sit at different levels, show the ARC rather than the
  //       single strongest point. "We started with a pilot, and since then a
  //       paying customer" is stronger evidence than either fact alone,
  //       because it is the only version that shows a direction.
  // No tier field exists on CompanyFact and none is being added — the model
  // maps facts onto the list by judgment, exactly as it already chooses which
  // fact to lead with.
  const facts = context.companyFacts ?? [];
  const growthSignalBlock = facts.length ? [
    '',
    'GROWTH-SIGNAL HIERARCHY (strongest first — rank the confirmed facts above against this):',
    growthSignalTierPromptList(),
    '',
    'HOOK RULE (hard): lead with the strongest signal the confirmed facts actually support. Never dress a weak',
    'signal up as a strong one — interest, a conversation, an intro or an exploratory call is NOT a commitment,',
    'a pilot is not a contract, and coverage or an award is not revenue. If the strongest available fact sits low',
    'on this list, say it plainly at its real weight rather than inflating it; an honest small signal beats an',
    'overstated one, which an investor discounts the moment they check.',
    facts.length >= 2 ? [
      '',
      'PROGRESSION RULE: there is more than one confirmed fact above. If any two of them sit at different levels of',
      'that hierarchy, prefer showing the PROGRESSION — where the company started and where it is now — over stating',
      'the strongest fact in isolation.',
      'The movement itself is traction. Only do this where the facts genuinely support the arc; never imply a',
      'trajectory the facts do not show, and never restate the same fact twice to manufacture one.',
      `SPACE FOR THIS CHANNEL (${channel}): ${PROGRESSION_BUDGET[channel]}`,
    ].join('\n') : '',
  ].filter(Boolean) : [];

  const reopenBlock = context.reopenContext ? [
    '',
    `REOPEN CONTEXT — this entity previously passed. Reason given: "${context.reopenContext.reopenTrigger}".`,
    context.reopenContext.supersededSince.length ? `No longer true: ${context.reopenContext.supersededSince.join('; ')}` : '',
    context.reopenContext.newSince.length ? `What changed since: ${context.reopenContext.newSince.join('; ')}` : '',
    'The draft MUST cite the earlier "no" and lead with what changed — never pretend this is a first contact.',
  ].filter(Boolean) : [];

  // Prompt 272 — Sherlock's own structured adviser breakdown, already
  // grounded against real company_facts and the actual pending questions
  // at the point it was generated (/api/reawakening/neglect-evaluate) —
  // this block hands that already-vetted content to the draft, it does
  // not re-derive or re-verify it.
  const briefing = context.sherlockBriefing;
  const sherlockBlock = briefing ? [
    '',
    `SHERLOCK'S BRIEFING — a thread with this investor went cold; nobody ever formally passed. ${briefing.acknowledge}`,
    briefing.respondTo.length
      ? `Pending questions to answer, each one:\n${briefing.respondTo.map((r) => `- "${r.question}" → ${r.answer}`).join('\n')}`
      : '',
    briefing.newHook ? `Why reopen now: ${briefing.newHook}` : '',
    briefing.timing ? `Timing guidance: ${briefing.timing}` : '',
    'The draft MUST acknowledge the gap in one line (no drama, no over-apologizing), answer EVERY pending question above, '
      + 'and lead the reopen with the "why reopen now" reason — never pretend this is a first contact.',
  ].filter(Boolean) : [];

  const noPerson = !context.person.fullName;

  return [
    noPerson
      ? `Compose a single outreach message for ${context.startup.name} to send to ${context.investor.entityName} generally — ` +
        `there is no specific named contact for this send (e.g. a web form, an info@ inbox, or the firm's LinkedIn page). ` +
        `Address it to the firm or team as a whole (e.g. "the team at ${context.investor.entityName}") — never invent a person's name.`
      : `Compose a single outreach message for ${context.startup.name} to send to ${context.person.fullName}` +
        (context.person.role ? ` (${context.person.role})` : '') + ` at ${context.investor.entityName}.`,
    '',
    `INTENT: ${intent} — ${INTENT_GUIDANCE[intent]}`,
    `CHANNEL: ${channel} — ${CHANNEL_GUIDANCE[channel]}`,
    context.person.preferredLanguage === 'pt' ? 'Write in European Portuguese.' : 'Write in English.',
    '',
    'CONTEXT (ground truth — do not invent beyond this):',
    // Prompt 305 §B — priorThread[].snippet can be investor-authored
    // (third-party) content; wrap the whole context blob as data.
    wrapDocumentContent(JSON.stringify(context, null, 2)),
    ...canonBlock,
    ...growthSignalBlock,
    ...reopenBlock,
    ...sherlockBlock,
    '',
    'HARD RULES:',
    '- Never claim traction, revenue, or clinical results that are not in the context.',
    context.person.killWords.length ? `- Never use these kill words for this person: ${context.person.killWords.join(', ')}.` : '',
    '- One ask only, and keep it small.',
    noPerson
      ? '- Line 1 must reference something specific/true/recent about the fund — never a generic opener, and never a person\'s name (there isn\'t one).'
      : '- Line 1 must reference something specific/true/recent about this person or fund — never a generic opener.',
    '- Never include an editable document link (no "/edit" URLs).',
    context.constraints.locked ? `- NOTE: this entity is contact-locked until ${context.constraints.lockUntil?.slice(0, 10)} — draft anyway for prep, but flag this in the rationale.` : '',
    context.constraints.thirdUnansweredRisk ? '- NOTE: two prior messages already went unanswered — this would be a third. Strongly consider proposing to hold instead of drafting a third message; say so in the rationale.' : '',
  ].filter(Boolean).join('\n');
}