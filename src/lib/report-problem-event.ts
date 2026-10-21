// Prompt 918 (Adenda 2, B) — any screen can offer "Report a problem" without owning the form: it dispatches this event on `window` and the platform's report widget (ReportProblemWidget, mounted once in the
// root layout) opens its problem form.
export const OPEN_REPORT_EVENT = 'sd:open-report-problem';
