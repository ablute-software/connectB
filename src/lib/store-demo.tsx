'use client';
// Demo-mode data store. All state lives client-side and persists to localStorage.
// Mounted by src/lib/store.tsx when NEXT_PUBLIC_SUPABASE_URL is absent; the
// Supabase-backed provider (store-supabase.tsx) implements the identical
// StoreApi contract (locks, follow-up tasks, overrides, runs semantics).
import React, { useEffect, useMemo, useState } from 'react';
import type {
  AccessGrant, AutomationRun, CompanyFact, Db, DocumentItem, Entity, EntityReopenSnapshot, Folder, FolderKind, Interaction, InteractionDocument, Nda, Person, PersonAffiliation, FundingRound, RoadmapCategory, RoadmapEvent,
  InteractionEdit, OrgAxisClassification } from './types';
import { seed } from './data/seed';
import { revisitTasksToClose } from './exit-effects';
import { LOCK_DAYS, outboundsAwaitingFollowUp, fillTemplate } from './rules';
import { isEditableLink, normalizeDocumentUrl } from './data-room';
import { buildReawakenApproval, priorPassInfo } from './reawakening';
import { findReactivations, reactivationTaskTitle } from './rejection-code-match';
import { STAGE_LABEL, getStage } from './relationship';
import { matchEntityToCatalog } from './entity-catalog-prefill';
import { StoreCtx, type StoreApi } from './store-context';

const STORAGE_KEY = 'ablute-crm-demo-v3';

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

// Prompt 416 §A.2 — one row per genuine passed/dormant TRANSITION, captured
// here (setEntityStatus, the only path that ever sets these two statuses)
// rather than at each UI call site. Demo mode has no investor_investments/
// investor_entity_claims fixtures at all (those are platform-wide Postgres
// tables — see reopen-signals.ts's own header), so investment_count/claimed
// stay at their honest "none known" defaults here; the catalog match still
// gives sectors/stage a real baseline via the same fuzzy-match
// entity-catalog-prefill.ts already uses for prefill.
function captureReopenSnapshot(prev: Db, entity: Entity, reason: 'passed' | 'dormant'): EntityReopenSnapshot {
  const catalogMatch = matchEntityToCatalog(entity, prev.catalog);
  return {
    id: uid('reopen-snap'),
    entity_id: entity.id,
    captured_at: new Date().toISOString(),
    reason,
    sectors_at_time: catalogMatch?.sectors ?? entity.sectors,
    stage_min_at_time: catalogMatch?.stage_min ?? entity.stage_min,
    stage_max_at_time: catalogMatch?.stage_max ?? entity.stage_max,
    investor_claimed_at_time: false,
    investment_count_at_time: 0,
  };
}

// Prompt 253 (addendum) — editing the INVESTOR's own structured thesis
// fields also re-compares that entity's rejection_codes: a stage_min/
// stage_max/sectors/invests_in_geographies/check edit can clear (or
// reopen) a clash independently of anything the startup did.
const REACTIVATION_TRIGGER_FIELDS = ['sectors', 'invests_in_geographies', 'stage_min', 'stage_max', 'check_min_eur', 'check_max_eur'] as const;

// Prompt 251/253 Bloco B — the on-write hook, called at the end of every
// write that could clear a rejection_code: updateOrg (startup changed),
// updateEntity (investor's thesis fields changed), addRejectionCode (a
// pass coded after the fact — compare immediately, per 253's second
// addendum point). Pure comparison (findReactivations), zero AI, zero
// cron; the only I/O is the two arrays this appends to, same shape
// approveReawakening already uses for the fact-triggered path.
function applyReactivations(next: Db, entityIds?: string[]): Db {
  const reactivations = findReactivations(next, entityIds);
  if (reactivations.length === 0) return next;
  const now = new Date().toISOString();
  const newProposals = reactivations.map((r) => {
    const { reason, category } = priorPassInfo(next.interactions.filter((i) => i.entity_id === r.entity.id));
    return {
      // Prompt 271 §3 — trigger_kind explicit (migration 0192); demo mode
      // has no real Supabase schema to fail against, so no gating needed.
      id: uid('rwp'), rejection_code_id: r.code.id, trigger_kind: 'rejection_code' as const, entity_id: r.entity.id,
      reopens: true, rationale: r.rationale,
      prior_pass_reason: reason, prior_pass_category: category,
      status: 'pending' as const, created_at: now,
    };
  });
  const newTasks = reactivations.map((r) => ({
    id: uid('t'), title: reactivationTaskTitle(r.entity.name, r.code), entity_id: r.entity.id,
    kind: 'follow_up' as const, action_type: 'other' as const, done: false, source: 'suggested' as const,
  }));
  return {
    ...next,
    reawakeningProposals: [...next.reawakeningProposals, ...newProposals],
    tasks: [...next.tasks, ...newTasks],
  };
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
    // Prompt 126 F — demo mode is never in a genuine "not loaded yet" state:
    // `db` starts pre-seeded (useState(seed)), so there's no window where a
    // real page's data looks emptier than it actually is.
    loading: false,

    logInteraction(input) {
      // Prompt 397 §C.3 — attachments would otherwise sit on `interaction`
      // as a stray field via the `...input` spread below (interactions has
      // no such column); carved out first, same reasoning as the
      // overrides/next_action_type exclusion the Supabase store already
      // does before its own insert.
      const { attachments, ...loggedInput } = input;
      const firstDocId = attachments?.find((a) => a.documentId)?.documentId;
      const interaction: Interaction = {
        id: uid('int'),
        ...loggedInput,
        document_id: loggedInput.document_id ?? firstDocId,
        // Spread after the id, but occurred_at still needs its own
        // fallback: /log passes occurred_at: undefined explicitly when the
        // founder leaves "when this happened" blank, and an explicit
        // `undefined` in a spread overwrites any default that comes before
        // it. Every relationship.ts sort assumes occurred_at is always a
        // real timestamp, so this can never be allowed through as undefined.
        occurred_at: input.occurred_at ?? new Date().toISOString(),
      };
      const attachmentRows: InteractionDocument[] = (attachments ?? []).map((a) => ({
        id: uid('idoc'), interaction_id: interaction.id,
        document_id: a.documentId, folder_id: a.folderId, created_at: interaction.occurred_at,
      }));
      setDb((prev) => {
        const next: Db = {
          ...prev, interactions: [...prev.interactions, interaction],
          interactionDocuments: [...prev.interactionDocuments, ...attachmentRows],
        };

        for (const o of input.overrides ?? []) {
          next.overrides = [...next.overrides, {
            id: uid('ovr'), rule: o.rule, justification: o.justification,
            entity_id: input.entity_id, person_id: input.person_id,
            interaction_id: interaction.id, created_at: interaction.occurred_at,
          }];
        }

        if (input.direction === 'out') {
          const lockUntil = new Date(Date.now() + LOCK_DAYS * 24 * 3600 * 1000).toISOString();
          next.entities = next.entities.map((e) =>
            e.id === input.entity_id
              ? { ...e, contact_lock_until: lockUntil, status: e.status === 'not_contacted' ? 'contacted' : e.status }
              : e);
          // Prompt 65 Bloco 4 — no more blind buildFollowUpTask here. The
          // contact lock above is the real, independent guardrail (nothing
          // about outreach discipline changes); the follow-up TASK itself
          // now comes from the relationship engine's visible, confirmable
          // suggestion (log/page.tsx calls suggestNextAction + addTask
          // after this returns), never a silently-created generic one the
          // founder never saw.
        } else {
          if (input.classification && ['interested', 'meeting_request', 'question'].includes(input.classification)) {
            next.entities = next.entities.map((e) =>
              e.id === input.entity_id && ['not_contacted', 'contacted'].includes(e.status)
                ? { ...e, status: 'in_conversation' } : e);
          }
        }
        // The founder's own explicit next step (Log Interaction's "Next
        // action" fields) becomes a real, visible Agenda task, tagged
        // 'manual' — they typed it themselves, no suggestion involved.
        if (input.next_action) {
          next.tasks = [...next.tasks, {
            id: uid('t'), kind: 'follow_up', action_type: input.next_action_type ?? 'other', done: false,
            due_at: input.next_action_due ? `${input.next_action_due}T12:00:00Z` : undefined,
            title: input.next_action, entity_id: input.entity_id, person_id: input.person_id, source: 'manual',
          }];
        }
        return next;
      });
      return interaction;
    },

    classifyInteraction(id, c, cat, reason, classifiedBy, needsReview) {
      setDb((prev) => ({
        ...prev,
        interactions: prev.interactions.map((i) =>
          i.id === id ? { ...i, classification: c, pass_reason_category: cat, pass_reason: reason, classified_by: classifiedBy, needs_review: needsReview ?? i.needs_review } : i),
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

    updateInteractionContent(id, content) {
      setDb((prev) => ({
        ...prev,
        interactions: prev.interactions.map((i) => i.id === id ? { ...i, content } : i),
      }));
    },

    updateInteraction(id, patch) {
      setDb((prev) => ({
        ...prev,
        interactions: prev.interactions.map((i) => i.id === id ? { ...i, ...patch } : i),
      }));
    },

    editInteraction(id, patch) {
      setDb((prev) => {
        const current = prev.interactions.find((i) => i.id === id);
        if (!current) return prev;
        const now = new Date().toISOString();
        // No real auth here (demo mode) -- 'demo' is an honest label, never
        // a fabricated user identity.
        const editedBy = 'demo';
        const edits: InteractionEdit[] = (Object.keys(patch) as (keyof typeof patch)[])
          .filter((field) => patch[field] !== undefined && patch[field] !== current[field])
          .map((field) => ({
            id: uid('edit'), interaction_id: id, field,
            old_value: current[field] ?? null, new_value: patch[field] ?? null,
            edited_by: editedBy, edited_at: now,
          }));
        if (edits.length === 0) return prev;
        return {
          ...prev,
          interactions: prev.interactions.map((i) => i.id === id ? { ...i, ...patch } : i),
          interactionEdits: [...prev.interactionEdits, ...edits],
        };
      });
    },

    addInteraction(input) {
      const interaction: Interaction = { id: uid('int'), ...input };
      setDb((prev) => ({ ...prev, interactions: [...prev.interactions, interaction] }));
      return interaction;
    },

    removeInteraction(id) {
      setDb((prev) => ({ ...prev, interactions: prev.interactions.filter((i) => i.id !== id) }));
    },

    removePerson(id) {
      setDb((prev) => ({
        ...prev,
        people: prev.people.filter((p) => p.id !== id),
        personAffiliations: prev.personAffiliations.filter((a) => a.person_id !== id),
      }));
    },

    revertToNeedsReview(interactionId) {
      setDb((prev) => ({
        ...prev,
        interactions: prev.interactions.map((i) => i.id === interactionId ? { ...i, needs_review: true, classified_by: undefined } : i),
      }));
    },

    applyMetadataCard(entityId, interactionId, parsed, noteText, classifiedBy) {
      const dateStr = new Date().toISOString().slice(0, 10);
      const noteBlock = `Ficha de contacto (importada) — ${dateStr}\n${noteText}`;
      setDb((prev) => ({
        ...prev,
        entities: prev.entities.map((e) => e.id === entityId
          ? {
              ...e,
              email_domain: e.email_domain ?? parsed.emailDomain,
              website: e.website ?? parsed.website,
              notes: e.notes ? `${e.notes}\n\n${noteBlock}` : noteBlock,
            }
          : e),
        interactions: prev.interactions.map((i) => i.id === interactionId
          ? { ...i, needs_review: false, classified_by: classifiedBy }
          : i),
      }));
    },

    toggleTask(id) {
      setDb((prev) => ({ ...prev, tasks: prev.tasks.map((t) => t.id === id ? { ...t, done: !t.done } : t) }));
    },

    addTask(t) {
      setDb((prev) => ({ ...prev, tasks: [...prev.tasks, { ...t, id: uid('t'), done: false }] }));
    },

    addRejectionCode(rc) {
      setDb((prev) => {
        const next = {
          ...prev,
          // 'rej' prefix, not 'rc' -- roadmapCategories already claims that one.
          rejectionCodes: [...prev.rejectionCodes, { ...rc, id: uid('rej'), created_at: new Date().toISOString() }],
        };
        // 253 §2 — coding a rejection retroactively (e.g. BlueCrow's old
        // pass) compares against the CURRENT startup classification right
        // away — there may already be no clash at the moment it's coded.
        return applyReactivations(next, [rc.entity_id]);
      });
    },

    addOrgAxisClassification(c) {
      setDb((prev) => {
        const row: OrgAxisClassification = { ...c, id: uid('oax'), confirmed_at: new Date().toISOString() };
        const next = { ...prev, orgAxisClassifications: [...prev.orgAxisClassifications, row] };
        // Bloc C — confirming the startup's own position on a free-text
        // axis can clear ANY entity's rejection_code on that axis, not
        // just one — no entity filter, re-check everyone 'passed'.
        return applyReactivations(next);
      });
    },

    updateTask(id, patch) {
      setDb((prev) => ({ ...prev, tasks: prev.tasks.map((t) => t.id === id ? { ...t, ...patch } : t) }));
    },

    updateOrg(patch) {
      setDb((prev) => {
        const next = { ...prev, org: { ...prev.org, ...patch } };
        // Bloco B — the startup itself changed. 'stage'/'sectors' are the
        // two axes this engine currently understands structurally; other
        // fields never move a rejection_code's clash state, so skip the
        // (cheap but pointless) re-check on every unrelated org edit.
        if ('stage' in patch || 'sectors' in patch) return applyReactivations(next);
        return next;
      });
    },

    addCompanyPerson(p) {
      setDb((prev) => {
        const sortOrder = prev.companyPeople.length ? Math.max(...prev.companyPeople.map((x) => x.sort_order)) + 1 : 0;
        const now = new Date().toISOString();
        return { ...prev, companyPeople: [...prev.companyPeople, { ...p, id: uid('cp'), org_id: prev.org.id, sort_order: sortOrder, created_at: now, updated_at: now }] };
      });
    },
    updateCompanyPerson(id, patch) {
      setDb((prev) => ({ ...prev, companyPeople: prev.companyPeople.map((p) => (p.id === id ? { ...p, ...patch, updated_at: new Date().toISOString() } : p)) }));
    },
    removeCompanyPerson(id) {
      setDb((prev) => ({ ...prev, companyPeople: prev.companyPeople.filter((p) => p.id !== id) }));
    },

    async addTractionMetric(m) {
      let blocked = false;
      setDb((prev) => {
        if (m.show_on_dealdigger === true) {
          const featuredCount = prev.tractionMetrics.filter((x) => x.show_on_dealdigger).length;
          if (featuredCount >= 2) { blocked = true; return prev; }
        }
        const sortOrder = prev.tractionMetrics.length ? Math.max(...prev.tractionMetrics.map((x) => x.sort_order)) + 1 : 0;
        const now = new Date().toISOString();
        return { ...prev, tractionMetrics: [...prev.tractionMetrics, { ...m, id: uid('tm'), org_id: prev.org.id, sort_order: sortOrder, created_at: now, updated_at: now }] };
      });
      return blocked ? { error: 'Only 2 metrics can be featured on DealDigger — unfeature one first.' } : {};
    },
    async updateTractionMetric(id, patch) {
      // Demo mode has no DB, so no org_traction_metrics_dealdigger_limit
      // trigger to reject this — replicate the same max-2-featured rule
      // here only, so the toggle behaves the same in both modes.
      let blocked = false;
      setDb((prev) => {
        if (patch.show_on_dealdigger === true) {
          const featuredCount = prev.tractionMetrics.filter((m) => m.show_on_dealdigger && m.id !== id).length;
          if (featuredCount >= 2) { blocked = true; return prev; }
        }
        return { ...prev, tractionMetrics: prev.tractionMetrics.map((m) => (m.id === id ? { ...m, ...patch, updated_at: new Date().toISOString() } : m)) };
      });
      return blocked ? { error: 'Only 2 metrics can be featured on DealDigger — unfeature one first.' } : {};
    },
    removeTractionMetric(id) {
      setDb((prev) => ({ ...prev, tractionMetrics: prev.tractionMetrics.filter((m) => m.id !== id) }));
    },

    // Prompt 167 — demo-mode roadmap milestones: local state only, same
    // add/update/remove shape as traction metrics above, no rejection path
    // (roadmap has no equivalent of the dealdigger-limit trigger).
    async addRoadmapCategory(c) {
      setDb((prev) => ({
        ...prev,
        roadmapCategories: [...prev.roadmapCategories, { visible: true, ...c, id: uid('rc'), org_id: prev.org.id, created_at: new Date().toISOString() } as RoadmapCategory],
      }));
      return {};
    },
    async removeRoadmapCategory(id) {
      setDb((prev) => ({ ...prev, roadmapCategories: prev.roadmapCategories.filter((c) => c.id !== id) }));
      return {};
    },
    async updateRoadmapCategory(id, patch) {
      setDb((prev) => ({ ...prev, roadmapCategories: prev.roadmapCategories.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
      return {};
    },
    async addFundingRound(r) {
      setDb((prev) => ({
        ...prev,
        fundingRounds: [...prev.fundingRounds, { ...r, id: uid('fr'), org_id: prev.org.id, created_at: new Date().toISOString() } as FundingRound],
      }));
      return {};
    },
    async removeFundingRound(id) {
      setDb((prev) => ({ ...prev, fundingRounds: prev.fundingRounds.filter((f) => f.id !== id) }));
      return {};
    },
    async addCapTableEntry(e) {
      setDb((prev) => ({ ...prev, capTableEntries: [...prev.capTableEntries, { ...e, id: uid('cte') }] }));
      return {};
    },
    async removeCapTableEntry(id) {
      setDb((prev) => ({ ...prev, capTableEntries: prev.capTableEntries.filter((c) => c.id !== id) }));
      return {};
    },
    async addRoadmapMilestone(m) {
      setDb((prev) => {
        const sortOrder = prev.roadmapMilestones.length ? Math.max(...prev.roadmapMilestones.map((x) => x.sort_order)) + 1 : 0;
        const now = new Date().toISOString();
        return { ...prev, roadmapMilestones: [...prev.roadmapMilestones, { ...m, id: uid('rm'), org_id: prev.org.id, sort_order: sortOrder, created_at: now, updated_at: now }] };
      });
      return {};
    },
    async updateRoadmapMilestone(id, patch) {
      setDb((prev) => ({ ...prev, roadmapMilestones: prev.roadmapMilestones.map((r) => (r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r)) }));
      return {};
    },
    removeRoadmapMilestone(id) {
      setDb((prev) => ({ ...prev, roadmapMilestones: prev.roadmapMilestones.filter((r) => r.id !== id) }));
    },

    // Prompt 359 — demo-mode roadmap events: local state only, same shape.
    async addRoadmapEvent(e) {
      const id = uid('re');
      setDb((prev) => {
        const sortOrder = prev.roadmapEvents.length ? Math.max(...prev.roadmapEvents.map((x) => x.sort_order)) + 1 : 0;
        const now = new Date().toISOString();
        return { ...prev, roadmapEvents: [...prev.roadmapEvents, { ...e, id, org_id: prev.org.id, sort_order: sortOrder, created_at: now, updated_at: now } as RoadmapEvent] };
      });
      return { id };
    },
    async updateRoadmapEvent(id, patch) {
      setDb((prev) => ({ ...prev, roadmapEvents: prev.roadmapEvents.map((r) => (r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r)) }));
      return {};
    },
    removeRoadmapEvent(id) {
      setDb((prev) => ({ ...prev, roadmapEvents: prev.roadmapEvents.filter((r) => r.id !== id) }));
    },

    setEntityStatus(id, status, reason) {
      setDb((prev) => {
      // Prompt 205 §B (reversao) — sair de dormant fecha a task de revisita,
      // que deixou de ter sentido: a revisita aconteceu. Feito aqui e nao no
      // componente porque a saida de dormant tem mais do que um caminho.
      const entity = prev.entities.find((e) => e.id === id);
      const wasParked = entity?.status === 'dormant';
      const closeIds = wasParked && status !== 'dormant' ? revisitTasksToClose(prev.tasks, id) : [];
      // Prompt 416 §A.2 — a snapshot only on a genuine TRANSITION into
      // passed/dormant (not a redundant re-set of the same status), so a
      // re-pass after reopening gets its own fresh row without every
      // unrelated edit that happens to re-save the same status spamming
      // new ones.
      const newSnapshot = entity && (status === 'passed' || status === 'dormant') && entity.status !== status
        ? captureReopenSnapshot(prev, entity, status)
        : undefined;
      return ({
        ...prev,
        tasks: closeIds.length ? prev.tasks.map((t) => closeIds.includes(t.id) ? { ...t, done: true } : t) : prev.tasks,
        entities: prev.entities.map((e) => e.id === id
          ? {
              ...e, status,
              dormant_since: status === 'dormant' ? new Date().toISOString() : e.dormant_since,
              dormant_reason: status === 'dormant' ? reason ?? e.dormant_reason : e.dormant_reason,
            }
          : e),
        entityReopenSnapshots: newSnapshot ? [...prev.entityReopenSnapshots, newSnapshot] : prev.entityReopenSnapshots,
      });
      });
    },

    setInterest(id, eur) {
      setDb((prev) => ({ ...prev, entities: prev.entities.map((e) => e.id === id ? { ...e, interest_eur: eur } : e) }));
    },

    // Prompt 273 §3 / Prompt 277 A — hard_filter_resolved_at/by only ever
    // set alongside a PERMANENT-banner status ('resolved_blocked' —
    // reported for fraud review — or 'resolved_not_a_fit'); cleared back
    // to undefined for 'resolved_ok' or 'open' (Unblock/Revert), matching
    // migration 0194's own "cleared the moment it isn't a permanent
    // status" rule. Demo mode has no entity_fraud_flags table — the
    // `report` payload (justification/evidence) is accepted for signature
    // parity with the real store but has nothing to write to here, same
    // as every other admin-review feature in demo mode.
    resolveHardFilter(id, status) {
      const now = new Date().toISOString();
      const permanent = status === 'resolved_blocked' || status === 'resolved_not_a_fit';
      setDb((prev) => ({
        ...prev,
        entities: prev.entities.map((e) => e.id === id
          ? {
              ...e, hard_filter_status: status,
              hard_filter_resolved_at: permanent ? now : undefined,
              hard_filter_resolved_by: permanent ? 'demo' : undefined,
            }
          : e),
      }));
    },

    // Bloco B — see REACTIVATION_TRIGGER_FIELDS above.
    updateEntity(id, patch) {
      setDb((prev) => {
        const next = { ...prev, entities: prev.entities.map((e) => e.id === id ? { ...e, ...patch } : e) };
        const triggers = REACTIVATION_TRIGGER_FIELDS.some((f) => f in patch);
        return triggers ? applyReactivations(next, [id]) : next;
      });
    },

    updatePerson(id, patch) {
      setDb((prev) => ({ ...prev, people: prev.people.map((p) => p.id === id ? { ...p, ...patch } : p) }));
    },

    addPerson(p) {
      const siblings = db.people.filter((x) => x.entity_id === p.entity_id);
      const seniority_rank = siblings.length ? Math.max(...siblings.map((x) => x.seniority_rank)) + 1 : 1;
      const person: Person = {
        id: uid('p'), entity_id: p.entity_id, full_name: p.full_name, role: p.role, gender: p.gender,
        linkedin_url: p.linkedin_url, email_guess: p.email_guess, phone: p.phone,
        seniority_rank, linkedin_verified: false, bounce_count: 0, linked_companies: [], linked_funds: [],
        hook_status: 'to_research', kill_words: [], preferred_language: 'pt',
        privacy_notice_sent: false, do_not_contact: false, identity_verified: false,
        data_source: 'Quick-created during logging',
      };
      setDb((prev) => ({ ...prev, people: [...prev.people, person] }));
      return person;
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
      const external_url = d.external_url ? normalizeDocumentUrl(d.external_url) : d.external_url;
      if (external_url && isEditableLink(external_url)) {
        throw new Error('Editable link rejected — only view-only links can be stored.');
      }
      const id = uid('doc');
      setDb((prev) => ({
        ...prev,
        documents: [...prev.documents, { ...d, external_url, id, created_at: new Date().toISOString() }],
      }));
      return id;
    },

    deleteDocument(id) {
      setDb((prev) => ({ ...prev, documents: prev.documents.filter((d) => d.id !== id) }));
    },

    renameDocument(id, name) {
      setDb((prev) => ({ ...prev, documents: prev.documents.map((d) => d.id === id ? { ...d, name } : d) }));
    },

    updateDocumentDetails(id, details) {
      setDb((prev) => ({ ...prev, documents: prev.documents.map((d) => d.id === id ? { ...d, details } : d) }));
    },

    updateDocumentVisibility(id, visibility) {
      setDb((prev) => ({ ...prev, documents: prev.documents.map((d) => d.id === id ? { ...d, visibility } : d) }));
    },

    moveDocumentToFolder(docId, folderId) {
      setDb((prev) => {
        const siblings = prev.documents.filter((d) => d.folder_id === folderId);
        const position = siblings.length ? Math.max(...siblings.map((d) => d.position ?? 0)) + 1 : 0;
        return { ...prev, documents: prev.documents.map((d) => d.id === docId ? { ...d, folder_id: folderId, position } : d) };
      });
    },

    reorderDocuments(folderId, orderedIds) {
      const pos = new Map(orderedIds.map((id, i) => [id, i]));
      setDb((prev) => ({
        ...prev,
        documents: prev.documents.map((d) => (d.folder_id === folderId && pos.has(d.id)) ? { ...d, position: pos.get(d.id)! } : d),
      }));
    },

    replaceDocumentFile(docId, newStoragePath) {
      setDb((prev) => ({ ...prev, documents: prev.documents.map((d) => d.id === docId ? { ...d, storage_path: newStoragePath } : d) }));
    },

    addDocumentVersion(docId, storagePath, size, scan) {
      setDb((prev) => {
        const doc = prev.documents.find((d) => d.id === docId);
        if (!doc) return prev;
        const existing = prev.documentVersions.filter((v) => v.document_id === docId);
        const now = new Date().toISOString();
        const rows = [...prev.documentVersions];
        let nextNum = existing.length ? Math.max(...existing.map((v) => v.version)) + 1 : 1;
        const malwareScanStatus = (scan?.status as DocumentItem['malware_scan_status']) ?? 'not_scanned';
        // First time a document is versioned, snapshot its current file as v1
        // so the original is preserved (never lost, per the "never deletion"
        // rule) before the new upload becomes the current version.
        if (existing.length === 0 && doc.storage_path && doc.storage_path !== storagePath) {
          rows.push({
            id: uid('ver'), document_id: docId, version: 1, storage_path: doc.storage_path, uploaded_at: doc.created_at ?? now,
            malware_scan_status: doc.malware_scan_status ?? 'not_scanned',
          });
          nextNum = 2;
        }
        rows.push({
          id: uid('ver'), document_id: docId, version: nextNum, storage_path: storagePath, size, uploaded_at: now,
          malware_scan_status: malwareScanStatus, content_sha256: scan?.sha256,
        });
        return {
          ...prev,
          documentVersions: rows,
          documents: prev.documents.map((d) => d.id === docId ? { ...d, storage_path: storagePath, version: `v${nextNum}`, malware_scan_status: malwareScanStatus } : d),
        };
      });
    },

    approveReawakening(proposalId, overrides) {
      setDb((prev) => {
        const p = prev.reawakeningProposals.find((x) => x.id === proposalId);
        if (!p) return prev;
        const now = new Date().toISOString();
        const entityName = prev.entities.find((e) => e.id === p.entity_id)?.name ?? '';
        const { entityPatch, task: taskBase } = buildReawakenApproval(p, entityName, overrides);
        const task = { ...taskBase, id: uid('t'), done: false };
        return {
          ...prev,
          entities: prev.entities.map((e) => e.id === p.entity_id ? { ...e, ...entityPatch } : e),
          tasks: [...prev.tasks, task],
          reawakeningProposals: prev.reawakeningProposals.map((x) => x.id === proposalId ? { ...x, status: 'approved' as const, resolved_at: now } : x),
        };
      });
    },

    rejectReawakening(proposalId) {
      const now = new Date().toISOString();
      setDb((prev) => ({
        ...prev,
        reawakeningProposals: prev.reawakeningProposals.map((x) => x.id === proposalId ? { ...x, status: 'rejected' as const, resolved_at: now } : x),
      }));
    },

    // Prompt 271 §3 — no real server/AI in demo mode, same as every other
    // AI-gated feature here; always resolves to no results.
    async askSherlock() {
      return [];
    },

    createFolder(name, parentId, kind) {
      const siblings = db.folders.filter((f) => f.parent_id === parentId);
      const position = siblings.length ? Math.max(...siblings.map((f) => f.position)) + 1 : 0;
      const folder: Folder = { id: uid('fold'), name, parent_id: parentId, kind, position };
      setDb((prev) => ({ ...prev, folders: [...prev.folders, folder] }));
    },

    renameFolder(id, name) {
      setDb((prev) => ({ ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, name } : f) }));
    },

    deleteFolder(id, moveContentsToParent) {
      const folder = db.folders.find((f) => f.id === id);
      if (!folder) return;
      const childFolders = db.folders.filter((f) => f.parent_id === id);
      const childDocs = db.documents.filter((d) => d.folder_id === id);
      if (!moveContentsToParent && (childFolders.length > 0 || childDocs.length > 0)) {
        throw new Error('Folder is not empty — delete its contents first, or choose "move contents to parent".');
      }
      setDb((prev) => ({
        ...prev,
        folders: prev.folders.filter((f) => f.id !== id).map((f) => f.parent_id === id ? { ...f, parent_id: folder.parent_id } : f),
        documents: prev.documents.map((d) => d.folder_id === id ? { ...d, folder_id: folder.parent_id } : d),
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
          // P104 #1 — same dedup as store-supabase.tsx's addGrant: a
          // cascaded multi-folder grant, or a revoke+add state change,
          // shouldn't spawn a fresh draft per call within the same 24h.
          const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
          const cutoff = Date.now() - DEDUP_WINDOW_MS;
          const duplicate = prev.runs.find((r) =>
            r.automation_id === auto.id
            && (g.person_id ? r.person_id === g.person_id : r.entity_id === person?.entity_id)
            && (r.status === 'pending_review' || r.status === 'executed')
            && new Date(r.created_at).getTime() >= cutoff);
          if (!duplicate) {
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
        }
        return next;
      });
    },

    revokeGrant(id) {
      setDb((prev) => ({ ...prev, grants: prev.grants.map((g) => g.id === id ? { ...g, revoked_at: new Date().toISOString() } : g) }));
    },

    async invitePersonForGrant(entityId, email, name) {
      const normalizedEmail = email.trim().toLowerCase();
      const existing = db.people.find((p) =>
        p.entity_id === entityId && (p.email_verified?.toLowerCase() === normalizedEmail || p.email_guess?.toLowerCase() === normalizedEmail));
      if (existing) return existing;

      const siblings = db.people.filter((x) => x.entity_id === entityId);
      const seniority_rank = siblings.length ? Math.max(...siblings.map((x) => x.seniority_rank)) + 1 : 1;
      const person: Person = {
        id: uid('p'), entity_id: entityId, full_name: name, email_guess: normalizedEmail,
        seniority_rank, linkedin_verified: false, bounce_count: 0, linked_companies: [], linked_funds: [],
        hook_status: 'to_research', kill_words: [], preferred_language: 'en',
        privacy_notice_sent: false, do_not_contact: false, identity_verified: false,
        data_source: 'founder_invite',
      };
      const affiliation: PersonAffiliation = {
        id: uid('pa'), person_id: person.id, entity_id: entityId, kind: 'other', current: true,
        notes: `Added via founder access invite (${new Date().toISOString().slice(0, 10)}).`,
      };
      setDb((prev) => ({ ...prev, people: [...prev.people, person], personAffiliations: [...prev.personAffiliations, affiliation] }));
      return person;
    },

    recordNdaUpload(nda: Nda, unlockedGrantIds: string[]) {
      setDb((prev) => ({
        ...prev,
        ndas: [...prev.ndas, nda],
        grants: prev.grants.map((g) => unlockedGrantIds.includes(g.id) ? { ...g, nda_accepted_at: new Date().toISOString() } : g),
      }));
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

    setAutomationConfig(id, config) {
      setDb((prev) => ({ ...prev, automations: prev.automations.map((a) => a.id === id ? { ...a, config: { ...a.config, ...config } } : a) }));
    },

    // The engine tick: evaluates triggers and creates runs. In production this is a
    // scheduled job (Vercel cron → /api/automations); in demo mode it runs on demand.
    // Prompt 398 §3 — no demo branch for 'interest_request_unanswered': its
    // real counterpart (src/lib/interest-reminder-sweep.ts) reads investor
    // interest-level requests (investor_interest_levels, Supabase-only) —
    // demo mode's useInterestRequests() fetches that same real API route
    // and gets nothing back without Supabase configured, so there's no
    // demo data this tick could ever act on. The automation is still
    // listed and toggleable in demo mode's own Settings -> Automations
    // (seed.ts) — it just never has anything to sweep.
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
    // Prompt 139 D3 — the real matching engine (catalog_top_matches) is a
    // Postgres RPC; demo mode has no server, so it deliberately keeps this
    // exact pack-based logic rather than reimplementing scoring client-side
    // (CLAUDE.md's two-mode rule is "keep working," not "match production").
    // Wrapped in Promise.resolve() only to satisfy the now-async StoreApi
    // contract — the body itself stays synchronous.
    async unlockPack(packId) {
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
            status: 'not_contacted', source: 'catalog',
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
          status: 'not_contacted', fit_score: 'medium', wave: 3, source: 'manual',
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
      // Prompt 214 §C.2 — o id nasce FORA do setDb para poder ser devolvido
      // ao chamador (o undo precisa dele).
      const milestoneId = uid('int');
      setDb((prev) => {
        const now = new Date().toISOString();
        const existing = prev.relationshipState.find((r) => r.entity_id === entityId);
        const relationshipState = existing
          ? prev.relationshipState.map((r) => r.entity_id === entityId ? { ...r, stage, updated_at: now } : r)
          : [...prev.relationshipState, { entity_id: entityId, stage, updated_at: now }];
        const milestone: Interaction = {
          id: milestoneId, entity_id: entityId, occurred_at: now, direction: 'out',
          channel: 'stage_change', content: `Stage changed to ${STAGE_LABEL[stage]}.`,
        };
        return { ...prev, relationshipState, interactions: [...prev.interactions, milestone] };
      });
      return milestoneId;
    },
    undoStageChange(entityId, previousStage, milestoneId) {
      setDb((prev) => ({
        ...prev,
        relationshipState: previousStage
          ? prev.relationshipState.map((r) => r.entity_id === entityId ? { ...r, stage: previousStage } : r)
          : prev.relationshipState.filter((r) => r.entity_id !== entityId),
        interactions: prev.interactions.filter((i) => i.id !== milestoneId),
      }));
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

    // Prompt 346 — demo mode has nothing server-side to fall behind; the
    // localStorage db is already current the instant any action above
    // writes to it. A no-op so callers (InvestorInterestPopup etc.) can
    // call this unconditionally without branching on which store is mounted.
    async refreshFromServer() {},

    // Prompt 415 §1 — same upsert-by-natural-key shape as setNextStepTask
    // above (keyed by entity_id there, by kind+whichever of the 4 id
    // fields is set here) — a second snooze on the same candidate
    // replaces the row instead of accumulating one per click.
    snoozeSherlockClue(kind, key, snoozedUntil) {
      setDb((prev) => {
        const matches = (s: (typeof prev.sherlockNextSnoozes)[number]) => s.kind === kind
          && s.task_id === key.task_id && s.entity_id === key.entity_id
          && s.interaction_id === key.interaction_id && s.person_id === key.person_id;
        const existing = prev.sherlockNextSnoozes.find(matches);
        const sherlockNextSnoozes = existing
          ? prev.sherlockNextSnoozes.map((s) => matches(s) ? { ...s, snoozed_until: snoozedUntil } : s)
          : [...prev.sherlockNextSnoozes, { id: uid('snooze'), kind, ...key, snoozed_until: snoozedUntil }];
        return { ...prev, sherlockNextSnoozes };
      });
    },
  }), [db]);

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}
