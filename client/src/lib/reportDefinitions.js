// reportDefinitions.js — the report definitions for Slice 5e, item 723 (D-749).
//
// Every report a bookkeeper can read, in one place: what it contains, where
// the data comes from, and what columns it has. Each definition links to the
// route that renders the report; the routes are pinned by
// client/scripts/reportDefinitions.test.mjs against App.jsx, and the copy
// lives in the credit namespace under `statements.definitions.<id>.*` in all
// five locales. No definition here invents a report: each one names a
// surface that already exists (see the source line in the copy).
//
// Shape: { id, route, titleKey, containsKey, sourceKey, columnsKey }.
// The keys resolve under the `credit` namespace (statements.definitions.*).
// `route` is the canonical App.jsx pattern. The center page links a
// definition only when its route has no `:param` (the reconciliation
// checklist is per-location, so its title renders without a link).

export const REPORT_DEFINITIONS = [
  {
    id: 'monthly-statement',
    route: '/oxsteed-credit/statements',
    titleKey: 'statements.definitions.monthly-statement.title',
    containsKey: 'statements.definitions.monthly-statement.contains',
    sourceKey: 'statements.definitions.monthly-statement.source',
    columnsKey: 'statements.definitions.monthly-statement.columns',
  },
  {
    id: 'interim-report',
    route: '/oxsteed-credit/statements',
    titleKey: 'statements.definitions.interim-report.title',
    containsKey: 'statements.definitions.interim-report.contains',
    sourceKey: 'statements.definitions.interim-report.source',
    columnsKey: 'statements.definitions.interim-report.columns',
  },
  {
    id: 'statement-archive',
    route: '/oxsteed-credit/statements/archive',
    titleKey: 'statements.definitions.statement-archive.title',
    containsKey: 'statements.definitions.statement-archive.contains',
    sourceKey: 'statements.definitions.statement-archive.source',
    columnsKey: 'statements.definitions.statement-archive.columns',
  },
  {
    id: 'period-comparison',
    route: '/oxsteed-credit/statements',
    titleKey: 'statements.definitions.period-comparison.title',
    containsKey: 'statements.definitions.period-comparison.contains',
    sourceKey: 'statements.definitions.period-comparison.source',
    columnsKey: 'statements.definitions.period-comparison.columns',
  },
  {
    id: 'report-export',
    route: '/oxsteed-credit/statements/archive',
    titleKey: 'statements.definitions.report-export.title',
    containsKey: 'statements.definitions.report-export.contains',
    sourceKey: 'statements.definitions.report-export.source',
    columnsKey: 'statements.definitions.report-export.columns',
  },
  {
    id: 'export-history',
    route: '/oxsteed-credit/statements/archive',
    titleKey: 'statements.definitions.export-history.title',
    containsKey: 'statements.definitions.export-history.contains',
    sourceKey: 'statements.definitions.export-history.source',
    columnsKey: 'statements.definitions.export-history.columns',
  },
  {
    id: 'reconciliation-checklist',
    route: '/restaurants/:restaurantId/credit-reconciliation',
    titleKey: 'statements.definitions.reconciliation-checklist.title',
    containsKey: 'statements.definitions.reconciliation-checklist.contains',
    sourceKey: 'statements.definitions.reconciliation-checklist.source',
    columnsKey: 'statements.definitions.reconciliation-checklist.columns',
  },
  {
    id: 'audit-evidence',
    route: '/statements/audit-requests',
    titleKey: 'statements.definitions.audit-evidence.title',
    containsKey: 'statements.definitions.audit-evidence.contains',
    sourceKey: 'statements.definitions.audit-evidence.source',
    columnsKey: 'statements.definitions.audit-evidence.columns',
  },
  {
    id: 'document-search',
    route: '/statements',
    titleKey: 'statements.definitions.document-search.title',
    containsKey: 'statements.definitions.document-search.contains',
    sourceKey: 'statements.definitions.document-search.source',
    columnsKey: 'statements.definitions.document-search.columns',
  },
  {
    id: 'investor-reporting',
    route: '/investor/dashboard',
    titleKey: 'statements.definitions.investor-reporting.title',
    containsKey: 'statements.definitions.investor-reporting.contains',
    sourceKey: 'statements.definitions.investor-reporting.source',
    columnsKey: 'statements.definitions.investor-reporting.columns',
  },
];
