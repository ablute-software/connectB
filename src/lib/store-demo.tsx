'use client';
// Demo-mode data store. All state lives client-side and persists to localStorage.
// Mounted by src/lib/store.tsx when NEXT_PUBLIC_SUPABASE_URL is absent; the
// Supabase-backed provider (store-supabase.tsx) implements the identical
// StoreApi contract (locks, follow-up tasks, overrides, runs semantics).
import React, { useEffect, useMemo, useState } from 'react';
import type {
  AccessGrant, AutomationRun, CompanyFact, Db, Entity, Interaction, Person, PersonAffiliation,
} from './types';
import { seed } from './data/seed';
import { LOCK_DAYS, outboundsAwaitingFollowUp, fillTemplate } from './rules';
import { STAGE_LABEL, getStage } from './relationship';
import { StoreCtx, type StoreApi } from './store-context';

const STORAGE_KEY = 'ablute-crm-demo-v3';

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<Db>(seed);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setDb({ ...seed, ...JSON.parse(raw) }); // shallow-merge so new collections added in updates exist
    } catch { /* fall back to seed */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* ignore */ }
  }, [db, loaded]);

  const api = useMemo<StoreApi>(() => ({
    db,

    logInteraction(input) {
      const interaction: Interaction = {
        id: uid('int'),
        occurred_at: new Date().toISOString(),
        ...input,
      };
      setDb((prev) => {
        const next: Db = { ...prev, interactions: [...prev.interactions, interaction] };

        for (const o of input.overrides ?? []) {
          next.overrides = [...next.overrides, {
            id: uid('ovr'), rule: o.rule, justification: o.justification,
            entity_id: input.entity_id, person_id: input.person_id,
            interaction_id: interaction.id, created_at: interaction.occurred_at,
          }];
        }

        if (input.direction === 'out') {
          const lockUntil = new Date(Date.now() + LOCK_DAYS * 24 * 3600 * 1000).toISOString();
          const due = new Date(Date.now() + LOCK_DAYS * 24 * 3600 * 1000).toISOString();
          const person = prev.people.find((p) => p.id === input.person_id);
          next.entities = next.entities.map((e) =>
            e.id === input.entity_id
              ? { ...e, contact_lock_until: lockUntil, status: e.status === 'not_contacted' ? 'contacted' : e.status }
              : e);
          next.tasks = [...next.tasks, {
            id: uid('t'), kind: 'follow_up', action_type: 'follow_up_no_reply', done: false, due_at: due,
            title: `Follow up ${person?.full_name ?? ''} (${prev.entities.find((e) => e.id === input.entity_id)?.name ?? ''})`.trim(),
            entity_id: input.entity_id, person_id: input.person_id,
          }];
        } else {
          if (input.classification && ['interested', 'meeting_request', 'question'].includes(input.classification)) {
            next.entities = next.entities.map((e) =>
              e.id === input.entity_id && ['not_contacted', 'contacted'].includes(e.status)
                ? { ...e, status: 'in_conversation' } : e);
          }
        }
        // The founder's own explicit next step (Log Interaction's "Next
        // action" fields) becomes a real, visible Agenda task — separate
        // from the automatic 14-day lock-reminder above, since they serve
        // different purposes (a generic safety net vs. a specific plan).
        if (input.next_action) {
          next.tasks = [...next.tasks, {
            id: uid('t'), kind: 'follow_up', action_type: input.next_action_type ?? 'other', done: false,
            due_at: input.next_action_due ? `${input.next_action_due}T12:00:00Z` : undefined,
            title: input.next_action, entity_id: input.entity_id, person_id: input.person_id,
          }];
        }
        return next;
      });
      return interaction;
    },

    classifyInteraction(id, c, cat, reason) {
      setDb((prev) => ({
        ...prev,
        interactions: prev.interactions.map((i) =>
          i.id === id ? { ...i, classification: c, pass_reason_category: cat, pass_reason: reason } : i),
        entities: (() => {
          const it = prev.interactions.find((i) => i.id === id);
          if (!it) return prev.entities;
          if (c === 'pass') return prev.entities.map((e) => e.id === it.entity_id ? { ...e, status: 'passed' as const } : e);
          if (['interested', 'meeting_request', 'question'].includes(c)) {
            return prev.entities.map((e) =>
              e.id === it.entity_id && ['not_contacted', 'contacted'].includes(e.status)
                ? { ...e, status: 'in_conversation' as const } : e);
          }
          return prev.entities;
        })(),
        people: (() => {
          const it = prev.interactions.find((i) => i.id === id);
          if (!it || c !== 'bounce' || !it.person_id) return prev.people;
          return prev.people.map((p) => p.id === it.person_id ? { ...p, bounce_count: p.bounce_count + 1 } : p);
        })(),
      }));
    },

    clearNeedsReview(interactionId) {
      setDb((prev) => ({
        ...prev,
        interactions: prev.interactions.map((i) => i.id === interactionId ? { ...i, needs_review: false } : i),
      }));
    },

    toggleTask(id) {
      setDb((prev) => ({ ...prev, tasks: prev.tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t) }));
    },

    addTask(t) {
      setDb((prev) => ({ ...prev, tasks: [...prev.tasks, { ...t, id: uid('t'), done: false }] }));
    },

    setEntityStatus(id, status, reason) {
      setDb((prev) => ({
        ...prev,
        entities: prev.entities.map((e) => e.id === id
          ? {
              ...e, status,
              dormant_since: status === 'dormant' ? new Date().toISOString() : e.dormant_since,
              dormant_reason: status === 'dormant' ? reason ?? e.dormant_reason : e.dormant_reason,
            }
          : e),
      }));
    },

    setInterest(id, eur) {
      setDb((prev) => ({ ...prev, entities: prev.entities.map((e) => e.id === id ? { ...e, interest_eur: eur } : e) }));
    },

    resolveHardFilter(id, status) {
      setDb((prev) => ({ ...prev, entities: prev.entities.map((e) => e.id === id ? { ...e, hard_filter_status: status } : e) }));
    },

    convertEntityToPerson(entityId) {
      setDb((prev) => {
        const entity = prev.entities.find((e) => e.id === entityId);
        if (!entity) return prev;
        const personId = uid('p');
        const newPerson: Person = {
          id: personId, entity_id: entityId, full_name: entity.name, seniority_rank: 1,
          linkedin_verified: false, bounce_count: 0, linked_companies: [], linked_funds: [],
          hook_status: 'to_research', kill_words: [], preferred_language: 'en',
          privacy_notice_sent: false, do_not_contact: false,
        };
        const newAffiliation: PersonAffiliation = {
          id: uid('aff'), person_id: personId, entity_id: undefined, kind: 'angel', current: true,
          is_primary: true, notes: 'Converted from a mis-imported VC-type entity — solo angel investor, no fund.',
        };
        return {
          ...prev,
          entities: prev.entities.map((e) => e.id === entityId
            ? { ...e, type: 'angel_fund', last_verified: new Date().toISOString().slice(0, 10) } : e),
          people: [...prev.people, newPerson],
          personAffiliations: [...prev.personAffiliations, newAffiliation],
          interactions: prev.interactions.map((i) =>
            i.entity_id === entityId && !i.person_id ? { ...i, person_id: personId } : i),
        };
      });
    },

    markEntityVerified(entityId) {
      setDb((prev) => ({
        ...prev,
        entities: prev.entities.map((e) => e.id === entityId
          ? { ...e, last_verified: new Date().toISOString().slice(0, 10) } : e),
      }));
    },

    addCompanyFact(f) {
      const now = new Date().toISOString();
      setDb((prev) => ({
        ...prev,
        companyFacts: [...prev.companyFacts, { ...f, id: uid('fact'), created_at: now, updated_at: now }],
      }));
    },

    confirmCompanyFact(id) {
      const now = new Date().toISOString();
      setDb((prev) => ({
        ...prev,
        companyFacts: prev.companyFacts.map((f) => f.id === id
          ? { ...f, status: 'confirmed', confirmed_at: now, updated_at: now } : f),
      }));
    },

    editAndConfirmCompanyFact(id, statement) {
      const now = new Date().toISOString();
      setDb((prev) => ({
        ...prev,
        companyFacts: prev.companyFacts.map((f) => f.id === id
          ? { ...f, statement, status: 'confirmed', confirmed_at: now, updated_at: now } : f),
      }));
    },

    rejectCompanyFact(id) {
      const now = new Date().toISOString();
      setDb((prev) => ({
        ...prev,
        companyFacts: prev.companyFacts.map((f) => f.id === id ? { ...f, status: 'deprecated', updated_at: now } : f),
      }));
    },

    supersedeCompanyFact(oldId, newStatement) {
      const now = new Date().toISOString();
      setDb((prev) => {
        const old = prev.companyFacts.find((f) => f.id === oldId);
        if (!old) return prev;
        const successor: CompanyFact = {
          id: uid('fact'), category: old.category, statement: newStatement, status: 'confirmed',
          source: 'user', valid_from: now.slice(0, 10), confirmed_at: now, created_at: now, updated_at: now,
        };
        return {
          ...prev,
          companyFacts: [
            ...prev.companyFacts.map((f) => f.id === oldId ? { ...f, status: 'deprecated' as const, superseded_by: successor.id, updated_at: now } : f),
            successor,
          ],
        };
      });
    },

    setDoNotContact(personId) {
      // GDPR: purge research fields, permanent block, no override
      setDb((prev) => ({
        ...prev,
        people: prev.people.map((p) => p.id === personId
          ? {
              ...p, do_not_contact: true,
              email_verified: undefined, email_guess: undefined, phone: undefined,
              background: undefined, personal_notes: undefined, hook: undefined,
              hook_status: 'none_found', watch_outs: undefined, linkedin_url: undefined,
            }
          : p),
      }));
    },

    addDocument(d) {
      if (d.external_url && d.external_url.includes('/edit')) {
        throw new Error('Editable link rejected — only view-only links can be stored.');
      }
      setDb((prev) => ({
        ...prev,
        documents: [...prev.documents, { ...d, id: uid('doc'), created_at: new Date().toISOString() }],
      }));
    },

    addGrant(g) {
      const grant: AccessGrant = { ...g, id: uid('gr'), granted_at: new Date().toISOString() };
      setDb((prev) => {
        const next = { ...prev, grants: [...prev.grants, grant] };
        // trigger: grant_activated
        const auto = prev.automations.find((a) => a.trigger === 'grant_activated' && a.enabled);
        if (auto) {
          const person = prev.people.find((p) => p.id === g.person_id);
          const email = person?.email_verified ?? g.grantee_email;
          const run: AutomationRun = {
            id: uid('run'), automation_id: auto.id, entity_id: person?.entity_id, person_id: g.person_id,
            status: auto.mode === 'full_auto' && email ? 'executed' : 'pending_review',
            payload: {
              channel: 'email',
              subject: 'ablute_ — data room access',
              draft: `Hi ${person?.full_name?.split(' ')[0] ?? ''},\n\nAs discussed, here is your access to the ablute_ data room${g.expires_at ? ` (valid until ${g.expires_at.slice(0, 10)})` : ''}. You can sign in with this email address — no password needed.\n\nBest,\nNuno`,
            },
            created_at: new Date().toISOString(),
            executed_at: auto.mode === 'full_auto' && email ? new Date().toISOString() : undefined,
            blocked_reason: !email ? 'No verified email for the grantee — draft held for review.' : undefined,
          };
          next.runs = [...next.runs, run];
        }
        return next;
      });
    },

    revokeGrant(id) {
      setDb((prev) => ({ ...prev, grants: prev.grants.map((g) => g.id === id ? { ...g, revoked_at: new Date().toISOString() } : g) }));
    },

    recordDocumentView(documentId, viewerEmail) {
      setDb((prev) => ({
        ...prev,
        views: [...prev.views, {
          id: uid('vw'), document_id: documentId, viewer_email: viewerEmail,
          viewed_at: new Date().toISOString(), seconds: 60 + Math.floor(Math.random() * 400),
        }],
      }));
    },

    toggleAutomation(id) {
      setDb((prev) => ({ ...prev, automations: prev.automations.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a) }));
    },

    setAutomationMode(id, mode) {
      setDb((prev) => ({ ...prev, automations: prev.automations.map((a) => a.id === id ? { ...a, mode } : a) }));
    },

    // The engine tick: evaluates triggers and creates runs. In production this is a
    // scheduled job (Vercel cron → /api/automations); in demo mode it runs on demand.
    runAutomationTick() {
      let created = 0;
      setDb((prev) => {
        const next = { ...prev, runs: [...prev.runs], tasks: [...prev.tasks] };
        const pending = outboundsAwaitingFollowUp(prev);
        const followAuto = prev.automations.find((a) => a.trigger === 'no_reply_14d' && a.enabled);
        const dormantAuto = prev.automations.find((a) => a.trigger === 'followup_no_reply_14d' && a.enabled);

        for (const p of pending) {
          const already = next.runs.some((r) =>
            r.entity_id === p.entity?.id && ['pending_review', 'drafted', 'approved'].includes(r.status));
          if (already) continue;

          if (!p.isSecondSilence && followAuto && p.person && p.entity) {
            const tpl = prev.templates.find((t) => t.id === followAuto.template_id);
            const draft = tpl ? fillTemplate(tpl.body, {
              first_name: p.person.full_name.split(' ')[0],
              days_ago: '14',
              hook_line: p.person.hook ?? '',
              the_ask: p.entity.the_ask ?? '',
              deck_link: prev.documents.find((d) => d.id === 'doc-deck')?.external_url ?? '',
            }) : 'Follow-up draft';
            const canAuto = followAuto.mode === 'full_auto' && !!p.person.email_verified && p.person.bounce_count === 0;
            next.runs.push({
              id: uid('run'), automation_id: followAuto.id, entity_id: p.entity.id, person_id: p.person.id,
              status: canAuto ? 'approved' : 'pending_review',
              payload: { channel: 'email', subject: 'Following up — ablute_', draft },
              created_at: new Date().toISOString(),
              blocked_reason: followAuto.mode === 'full_auto' && !canAuto
                ? 'full_auto blocked: no verified email — held for review (guessed addresses are never auto-sent).' : undefined,
            });
            created++;
          }

          if (p.isSecondSilence && dormantAuto && p.entity) {
            next.runs.push({
              id: uid('run'), automation_id: dormantAuto.id, entity_id: p.entity.id, person_id: p.person?.id,
              status: 'pending_review',
              payload: { note: `No reply 14 days after the follow-up. Propose marking ${p.entity.name} dormant. Never a third message.` },
              created_at: new Date().toISOString(),
            });
            created++;
          }
        }

        // hook_missing → research tasks (full_auto typical)
        const hookAuto = prev.automations.find((a) => a.trigger === 'hook_missing' && a.enabled);
        if (hookAuto) {
          for (const person of prev.people) {
            if (person.hook_status === 'to_research' && !person.do_not_contact) {
              const has = next.tasks.some((t) => t.person_id === person.id && t.kind === 'research' && !t.done);
              if (!has) {
                next.tasks.push({
                  id: uid('t'), kind: 'research', action_type: 'research_hook', done: false,
                  title: `Research hook: ${person.full_name}`, person_id: person.id, entity_id: person.entity_id,
                  due_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
                });
                created++;
              }
            }
          }
        }
        return next;
      });
      return created;
    },

    approveRun(id) {
      setDb((prev) => {
        const run = prev.runs.find((r) => r.id === id);
        if (!run) return prev;
        const next = { ...prev, runs: prev.runs.map((r) => r.id === id ? { ...r, status: 'executed' as const, executed_at: new Date().toISOString() } : r) };
        const auto = prev.automations.find((a) => a.id === run.automation_id);
        if (auto?.action === 'draft_follow_up' && run.entity_id && run.payload.draft) {
          // executing a follow-up = logging the outbound (in production it is also sent via Resend)
          next.interactions = [...next.interactions, {
            id: uid('int'), entity_id: run.entity_id, person_id: run.person_id,
            occurred_at: new Date().toISOString(), direction: 'out',
            channel: run.payload.channel ?? 'email', content: run.payload.draft,
            sent_from: prev.org.sender_email, automation_run_id: run.id,
            classification: 'awaiting',
          }];
          next.entities = next.entities.map((e) => e.id === run.entity_id
            ? { ...e, contact_lock_until: new Date(Date.now() + LOCK_DAYS * 24 * 3600 * 1000).toISOString() } : e);
        }
        if (auto?.action === 'propose_dormant' && run.entity_id) {
          next.entities = next.entities.map((e) => e.id === run.entity_id
            ? { ...e, status: 'dormant', dormant_since: new Date().toISOString(), dormant_reason: 'No reply after follow-up (stop rule).' } : e);
        }
        return next;
      });
    },

    rejectRun(id) {
      setDb((prev) => ({ ...prev, runs: prev.runs.map((r) => r.id === id ? { ...r, status: 'rejected' } : r) }));
    },

    updateRunDraft(id, draft) {
      setDb((prev) => ({ ...prev, runs: prev.runs.map((r) => r.id === id ? { ...r, payload: { ...r.payload, draft } } : r) }));
    },

    resetDemo() {
      window.localStorage.removeItem(STORAGE_KEY);
      setDb(seed);
    },

    // ---- v3: packs / catalog / back-office ----

    // Unlock a pack: verified catalog entries not yet in the pipeline are copied
    // into the org as entities (wave 3, not_contacted). Deliveries are recorded so
    // the back-office never distributes the same investor to the same org twice.
    unlockPack(packId) {
      let delivered = 0;
      setDb((prev) => {
        const pack = prev.packs.find((p) => p.id === packId);
        if (!pack || prev.unlocks.some((u) => u.pack_id === packId)) return prev;
        const alreadyDelivered = new Set(prev.unlocks.flatMap((u) => u.delivered_catalog_ids));
        const ownedNames = new Set(prev.entities.map((e) => e.name.toLowerCase()));
        const newEntities: Entity[] = [];
        const deliveredIds: string[] = [];
        for (const cid of pack.catalog_ids) {
          const c = prev.catalog.find((x) => x.id === cid);
          if (!c || c.verification_status !== 'verified') continue;
          if (alreadyDelivered.has(cid) || ownedNames.has(c.name.toLowerCase())) continue;
          deliveredIds.push(cid);
          newEntities.push({
            id: uid('ent'), name: c.name, type: c.type, hq_city: c.hq_city, hq_country: c.hq_country,
            invests_in_geographies: [], website: c.website, website_verified: true,
            email_domain_verified: false, stage_min: c.stage_min, stage_max: c.stage_max,
            check_min_eur: c.check_min_eur, check_max_eur: c.check_max_eur,
            sectors: c.sectors, thesis: c.thesis, fit_score: 'medium', wave: 3,
            submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
            status: 'not_contacted',
          });
        }
        delivered = newEntities.length;
        return {
          ...prev,
          entities: [...prev.entities, ...newEntities],
          unlocks: [...prev.unlocks, {
            id: uid('unl'), pack_id: packId, unlocked_at: new Date().toISOString(),
            delivered_catalog_ids: deliveredIds,
          }],
        };
      });
      return delivered;
    },

    // A founder submits an investor: it is added to their OWN pipeline immediately
    // (private) AND queued for back-office verification toward the global catalog.
    submitInvestor(payload) {
      setDb((prev) => ({
        ...prev,
        entities: [...prev.entities, {
          id: uid('ent'), name: payload.name, type: payload.type,
          hq_city: payload.hq_city, hq_country: payload.hq_country,
          invests_in_geographies: [], website: payload.website, website_verified: false,
          email_domain_verified: false, sectors: payload.sectors,
          submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
          status: 'not_contacted', fit_score: 'medium', wave: 3,
        }],
        submissions: [...prev.submissions, {
          id: uid('sub'), payload, submitted_by: prev.org.name,
          status: 'pending_review', created_at: new Date().toISOString(),
        }],
      }));
    },

    // Back-office review: approving merges the submission into the global catalog
    // (verified); rejecting records the reason. The submitter's private copy is untouched.
    reviewSubmission(id, decision, notes) {
      setDb((prev) => {
        const sub = prev.submissions.find((s) => s.id === id);
        if (!sub) return prev;
        const next = {
          ...prev,
          submissions: prev.submissions.map((s) => s.id === id
            ? { ...s, status: decision === 'approved' ? 'merged' as const : 'rejected' as const, reviewer_notes: notes, reviewed_at: new Date().toISOString() }
            : s),
        };
        if (decision === 'approved') {
          const existing = prev.catalog.find((c) => c.name.toLowerCase() === sub.payload.name.toLowerCase());
          if (existing) {
            next.catalog = prev.catalog.map((c) => c.id === existing.id
              ? { ...c, verification_status: 'verified', verified_at: new Date().toISOString() } : c);
          } else {
            next.catalog = [...prev.catalog, {
              id: uid('cat'), name: sub.payload.name, type: sub.payload.type,
              hq_city: sub.payload.hq_city, hq_country: sub.payload.hq_country,
              sectors: sub.payload.sectors, website: sub.payload.website,
              verification_status: 'verified', verified_at: new Date().toISOString(),
              source: 'user_submission', notes,
            }];
          }
        } else {
          next.catalog = prev.catalog.map((c) =>
            c.name.toLowerCase() === sub.payload.name.toLowerCase() && c.verification_status === 'pending'
              ? { ...c, verification_status: 'rejected', notes } : c);
        }
        return next;
      });
    },

    setRelationshipStage(entityId, stage) {
      setDb((prev) => {
        const now = new Date().toISOString();
        const existing = prev.relationshipState.find((r) => r.entity_id === entityId);
        const relationshipState = existing
          ? prev.relationshipState.map((r) => r.entity_id === entityId ? { ...r, stage, updated_at: now } : r)
          : [...prev.relationshipState, { entity_id: entityId, stage, updated_at: now }];
        const milestone: Interaction = {
          id: uid('int'), entity_id: entityId, occurred_at: now, direction: 'out',
          channel: 'stage_change', content: `Stage changed to ${STAGE_LABEL[stage]}.`,
        };
        return { ...prev, relationshipState, interactions: [...prev.interactions, milestone] };
      });
    },

    setNextStepTask(entityId, taskId) {
      setDb((prev) => {
        const now = new Date().toISOString();
        const existing = prev.relationshipState.find((r) => r.entity_id === entityId);
        const relationshipState = existing
          ? prev.relationshipState.map((r) => r.entity_id === entityId ? { ...r, next_step_task_id: taskId, updated_at: now } : r)
          : [...prev.relationshipState, { entity_id: entityId, stage: getStage(prev, entityId), next_step_task_id: taskId, updated_at: now }];
        return { ...prev, relationshipState };
      });
    },

    addAffiliation(a) {
      setDb((prev) => ({
        ...prev,
        personAffiliations: [...prev.personAffiliations, { ...a, id: uid('aff'), current: true }],
      }));
    },

    endAffiliation(id) {
      setDb((prev) => {
        const ended_at = new Date().toISOString().slice(0, 10);
        return {
          ...prev,
          personAffiliations: prev.personAffiliations.map((pa) => pa.id === id ? { ...pa, current: false, ended_at } : pa),
        };
      });
    },
  }), [db]);

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}
