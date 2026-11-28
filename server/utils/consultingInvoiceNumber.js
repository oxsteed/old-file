'use strict';

// S-C1 (D-767): consulting invoice numbers come from a dedicated
// sequence, never from Date.now() — two invoices created in the same
// millisecond used to collide on the UNIQUE invoice_number. Takes any
// queryable (pool or transaction client); nextval is non-transactional,
// so a rollback leaves a gap, never a duplicate.
async function nextConsultingInvoiceNumber(queryable) {
  const { rows } = await queryable.query(
    `SELECT nextval('consulting_invoice_number_seq') AS n`,
  );
  return `CONS-${String(rows[0].n).padStart(6, '0')}`;
}

module.exports = { nextConsultingInvoiceNumber };
