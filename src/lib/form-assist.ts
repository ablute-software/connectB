// Prompt 66 — Form Assist context builder. Pure function, shared between
// client (assembles the context to POST) and server (only ever reads it) —
// same split as composer.ts. Feeds /api/form-assist, which generates a
// "form answers pack" for web-form submission channels (Typeform etc): the
// founder copies field-by-field into the real third-party form. We never
// touch that form ourselves — see the Prompt 66 design doc for why.
import type { Db } from './types';

export interface FormAssistContext {
  startup: {
    name: string; legalName?: string; oneLiner?: string; description?: string;
    sectors: string[]; hqCity?: string; foundedYear?: number;
  };
  round: {
    raising?: boolean; targetEur?: number; securedEur?: number; valuationEur?: number;
    minTicketEur?: number; runwayMonths?: number; instruments: string[];
    useOfFunds?: string; targetCloseDate?: string;
  };
  team: { fullName: string; title?: string; isFounder: boolean; bio?: string }[];
  traction: { label: string; value: string }[];
  // All confirmed Company Canon facts, not just the categories composer.ts
  // uses — Form Assist covers more ground (problem/solution/market) than a
  // single outreach message ever needs to.
  companyFacts: { statement: string; category: string }[];
  investor: {
    entityName: string; entityType: string; thesis?: string; ourAngle?: string; theAsk?: string;
    checkMinEur?: number; checkMaxEur?: number; sectors: string[];
  };
  // Names only, so the AI can reference "see the attached deck" — the
  // founder still picks which document to actually attach/link themselves.
  availableDocuments: string[];
}

export function buildFormAssistContext(db: Db, entityId: string): FormAssistContext {
  const entity = db.entities.find((e) => e.id === entityId);
  const confirmedFacts = db.companyFacts.filter((f) => f.status === 'confirmed');

  return {
    startup: {
      name: db.org.name, legalName: db.org.legal_name, oneLiner: db.org.one_liner,
      description: db.org.description, sectors: db.org.sectors ?? [],
      hqCity: db.org.hq_city, foundedYear: db.org.founded_year,
    },
    round: {
      raising: db.org.round_raising, targetEur: db.org.round_target_eur,
      securedEur: db.org.round_secured_eur, valuationEur: db.org.round_valuation_eur,
      minTicketEur: db.org.round_min_ticket_eur, runwayMonths: db.org.round_runway_months,
      instruments: db.org.round_instruments ?? [], useOfFunds: db.org.round_use_of_funds,
      targetCloseDate: db.org.round_target_close_date,
    },
    team: db.companyPeople
      .slice().sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => ({ fullName: p.full_name, title: p.title, isFounder: p.is_founder, bio: p.bio })),
    traction: db.tractionMetrics
      .slice().sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({ label: m.label, value: m.value })),
    companyFacts: confirmedFacts.map((f) => ({ statement: f.statement, category: f.category })),
    investor: {
      entityName: entity?.name ?? '', entityType: entity?.type ?? '', thesis: entity?.thesis,
      ourAngle: entity?.our_angle, theAsk: entity?.the_ask,
      checkMinEur: entity?.check_min_eur, checkMaxEur: entity?.check_max_eur, sectors: entity?.sectors ?? [],
    },
    availableDocuments: db.documents.map((d) => d.name),
  };
}
