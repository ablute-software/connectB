'use client';
// Prompt 599 §1 — "System → Audit log" was a sidebar entry with no href
// (a 576 Fase 1 placeholder) while both the data and the panel already
// existed, buried in /metrics collapsed by default. Case (c) by the
// prompt's own taxonomy — never built — but the honest fix isn't to
// de-link it: the page is one line over a panel that already works.
import { AuditLogPanel } from '@/components/backoffice/AuditLogPanel';

export default function AuditLogPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Audit log</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Every admin action, newest first — viewer sessions, consensus decisions, dossier edits, research runs.
          Filter by date or admin; expand a row for the raw detail.
        </p>
      </div>
      <AuditLogPanel defaultExpanded />
    </div>
  );
}
