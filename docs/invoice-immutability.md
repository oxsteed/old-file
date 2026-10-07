# Invoice immutability (app-layer)

Business/helper invoices (`business_invoices`) enforce edit and payment rules in
`businessInvoiceController.js`. Tool rental invoices (`tool_rental_invoices`) lock
after owner payment confirmation in `invoiceController.js`.

PostgreSQL RLS is **not** used for these tables. Migration `084` once added an
inert `no_invoice_deletion` policy without enabling RLS; `705_drop_inert_policy.sql`
removed it. Do not re-add RLS policies unless RLS is explicitly enabled on the table.
