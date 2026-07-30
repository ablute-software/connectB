// Prompt 69 Bloco 2 — turns a raw admin_audit_log row (action + detail JSON)
// into one readable sentence for the redesigned Audit log. The raw JSON is
// still available behind a "Details" toggle in the UI; this is only the
// summary line. New action strings not covered below fall through to a
// generic "{admin} performed {action} on {subject_type}" sentence — never
// blank, even for an event type nobody's written a template for yet.
export interface AuditLogRow {
  id: string;
  admin_user_id: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  detail: unknown;
  created_at: string;
}

function d(detail: unknown): Record<string, unknown> {
  return detail && typeof detail === 'object' ? (detail as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function describeAuditEvent(row: AuditLogRow, admin: string): string {
  const detail = d(row.detail);
  switch (row.action) {
    case 'catalog_create':
      return `${admin} added "${str(detail.name) ?? 'an entity'}" to the catalog`;
    case 'catalog_update': {
      const fields = Object.keys(detail);
      return `${admin} updated a catalog entity${fields.length ? ` (${fields.join(', ')})` : ''}`;
    }
    case 'catalog_delete':
      return `${admin} deleted a catalog entity`;
    case 'catalog_merge': {
      const merged = Array.isArray(detail.mergedFrom) ? detail.mergedFrom as { name?: string }[] : [];
      const names = merged.map((m) => m.name).filter(Boolean).join(', ');
      return `${admin} merged ${merged.length || 'some'} duplicate(s)${names ? ` (${names})` : ''} into one catalog entity`;
    }
    case 'contribution_verified':
    case 'contribution_rejected': {
      const verb = row.action === 'contribution_verified' ? 'confirmed' : 'rejected';
      const field = str(detail.field);
      const value = str(detail.value);
      return field ? `${admin} ${verb} a contribution: ${field}${value ? ` → "${value}"` : ''}` : `${admin} ${verb} a contribution`;
    }
    case 'submission_approved':
    case 'submission_rejected': {
      const verb = row.action === 'submission_approved' ? 'approved' : 'rejected';
      const name = str(detail.name);
      return `${admin} ${verb} investor submission${name ? ` "${name}"` : ''}`;
    }
    case 'investor_added_entity_approved':
    case 'investor_added_entity_rejected':
      return `${admin} ${row.action.endsWith('approved') ? 'approved' : 'rejected'} an investor-added catalog entity`;
    case 'investor_verification_document_approved':
    case 'investor_verification_document_rejected':
      return `${admin} ${row.action.endsWith('approved') ? 'approved' : 'rejected'} an investor verification document`;
    case 'investor_access_request_approved':
    case 'investor_access_request_rejected': {
      const verb = row.action.endsWith('approved') ? 'approved' : 'rejected';
      const email = str(detail.email);
      return `${admin} ${verb} investor access${email ? ` for ${email}` : ''}`;
    }
    case 'gdpr_resolved':
    case 'gdpr_rejected': {
      const verb = row.action === 'gdpr_resolved' ? 'resolved' : 'rejected';
      const kind = str(detail.kind);
      const email = str(detail.claimantEmail);
      return `${admin} ${verb} a GDPR${kind ? ` ${kind}` : ''} request${email ? ` for ${email}` : ''}`;
    }
    case 'claim_approved':
    case 'claim_rejected':
      return `${admin} ${row.action.endsWith('approved') ? 'approved' : 'rejected'} a profile claim`;
    case 'promo_code_created': {
      const code = str(detail.code) ?? 'a code';
      const kind = str(detail.kind);
      const pct = typeof detail.discount_pct === 'number' ? detail.discount_pct : undefined;
      const extra = [kind, pct != null ? `${pct}% off` : undefined].filter(Boolean).join(', ');
      return `${admin} created promo code ${code}${extra ? ` (${extra})` : ''}`;
    }
    case 'promo_code_activated':
    case 'promo_code_deactivated':
    case 'promo_code_deleted': {
      const verb = row.action === 'promo_code_activated' ? 'activated' : row.action === 'promo_code_deactivated' ? 'deactivated' : 'deleted';
      return `${admin} ${verb} promo code ${str(detail.code) ?? ''}`.trim();
    }
    case 'support_status':
      return `${admin} changed a support ticket's status to ${str(detail.value) ?? 'a new value'}`;
    case 'support_priority':
      return `${admin} changed a support ticket's priority to ${str(detail.value) ?? 'a new value'}`;
    case 'support_note':
      return `${admin} added an internal note to a support ticket`;
    case 'support_reply':
      return `${admin} replied to a support ticket`;
    case 'ai_research': {
      const name = str(detail.name);
      const count = typeof detail.proposalCount === 'number' ? detail.proposalCount : undefined;
      return `${admin} ran AI research on${name ? ` "${name}"` : ''}${count != null ? ` — ${count} field(s) proposed` : ''}`;
    }
    case 'entity_converted_to_person':
      return `${admin} converted "${str(detail.entityName) ?? 'an entity'}" to a person`;
    case 'platform_admin_grant_failed':
      return `System: platform-admin grant failed for ${str(detail.email) ?? 'a new user'}`;
    default:
      return `${admin} performed ${row.action} on ${row.subject_type}`;
  }
}
