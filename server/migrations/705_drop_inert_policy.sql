-- 705: Drop inert RLS policy from 084
-- Migration 084 created a policy but never enabled RLS, making it inert.
-- Drop it to avoid confusion. If RLS is needed later, add it properly.

DROP POLICY IF EXISTS no_invoice_deletion ON tool_rental_invoices;
