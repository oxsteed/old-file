// G11 LOW batch (checkpoint 8, D-621..D-634): source pins for the JSX
// and API surfaces node --test cannot import (they import JSX or the
// axios instance). Behavioural tests live in the server suites and in
// client/src/utils/toolOwnerDashboard.test.mjs; these pins keep the
// wiring from silently regressing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const readJson = async (rel) => JSON.parse(await read(rel));

test('G11-A10/B1 (D-622): the owner dashboard derives return-ness from dates and rates from daily_rate', async () => {
  const src = await read('../src/pages/ToolOwnerDashboard.jsx');
  assert.ok(!src.includes("status === 'in_progress'"), 'the dead in_progress test must be gone');
  assert.ok(src.includes("b._handoffKind === 'return'"), 'handoffs read the util tag');
  assert.ok(!src.includes('daily_rate_cents'), 'the card must not read the dollars field as cents');
  assert.ok(src.includes('Math.round(Number(l.daily_rate) * 100)'), 'the card converts dollars to cents');
  assert.ok(src.includes('invoicedHint'), 'the earnings tile names the invoiced total');
  assert.ok(src.includes('loadMoreListings'), 'listings load more');
  assert.ok(src.includes('/tool-rentals/bookings/owner?limit=100'), 'dashboard stats fetch at the 100 cap');
});

test('G11-A11/A12/B8 (D-623/D-624/D-628): booking cards confirm cancels, show the agreed amount, and page', async () => {
  const src = await read('../src/pages/MyBookingsPage.tsx');
  assert.ok(src.includes('handleCancelRentalBooking'), 'cancels go through the confirm handler');
  assert.ok(!src.includes("onClick={() => handleStatusUpdate(booking.id, 'cancelled')}"), 'no button cancels without the confirm');
  assert.ok(src.includes('cancelBookingConfirm'), 'the confirm names the tool and dates');
  assert.ok(src.includes('agreed_damage_amount'), 'the agreed amount rides on the booking row');
  assert.ok(src.includes('depositAgreedAmount'), 'the agreed amount is shown in the deposit section');
  assert.ok(src.includes('depositWithholdDiffers'), 'a different withhold warns with both figures');
  assert.ok(src.includes('loadMoreMyBookings') && src.includes('loadMoreOwnerBookings'), 'both rental lists page');
});

test('G11-A13/A14 (D-625/D-626): the booking modal warns on identity and maps the email gate', async () => {
  const src = await read('../src/components/BookingModal.tsx');
  assert.ok(src.includes('getMyRentalIdentity'), 'the modal fetches the caller identity status');
  assert.ok(src.includes('identityPickupBlocked'), 'the warning reuses the pickup-block copy');
  assert.ok(src.includes('/verify-identity'), 'the warning links to verification');
  assert.ok(src.includes('renter_email_not_verified'), 'the email-gate refusal maps to a clear message');
  assert.ok(src.includes('renterEmailNotVerified'), 'the email-gate message key exists');
});

test('G11-B10 (D-630): the damage-claim form offers the condition-report picker', async () => {
  const src = await read('../src/components/RentalDisputesPanel.tsx');
  assert.ok(src.includes('getEquipmentBooking'), 'reports come from the operations read endpoint');
  assert.ok(src.includes('damageClaimReport'), 'the picker is labelled');
  assert.ok(src.includes('evidence_report_id: claimDraft.evidenceReportId'), 'the claim carries the picked report');
});

test('G11-B11/B15 (D-631/D-634): evidence names its uploader and the follow-up form waits for overdue', async () => {
  const src = await read('../src/components/EquipmentOperations.jsx');
  assert.ok(src.includes('evidenceUploadedBy'), 'each photo carries an uploader attribution');
  assert.ok(src.includes('uploader_first_name'), 'the attribution reads the joined name');
  assert.ok(src.includes('isOverdue'), 'the follow-up form is gated on an actual overdue return');
  assert.ok(src.includes("{tr('followups')}</h3>{data.owner&&isOverdue&&"), 'the gate is on the follow-up form');
});

test('G11-B15 (D-634): the maintain panel surfaces delete failures and refetches the checklist on toggle', async () => {
  const src = await read('../src/components/ToolOwnerMaintainPanel.jsx');
  assert.ok(src.includes('handleDeleteDoc'), 'deletes go through the handler');
  assert.ok(!src.includes('deleteSafetyDocument(selected, doc.id).catch(() => {})'), 'the swallowed delete is gone');
  assert.ok(src.includes('safetyDocDeleteFailed'), 'a failed delete toasts');
  assert.ok(src.includes('handleCleaningToggle'), 'the checkbox refetches the checklist with its value');
});

test('G11-A9/A12 (D-621/D-624): the tool form clears nulls and the tool list pages', async () => {
  const src = await read('../src/pages/HelperDashboard.jsx');
  assert.ok(src.includes("value === null ? '' : String(value)"), 'null form values ride as empty strings');
  assert.ok(src.includes('loadMoreTools'), 'tools load more');
  const catalog = await read('../src/components/HelperCapabilitiesCatalog.jsx');
  assert.ok(catalog.includes('toolsHasMore') && catalog.includes('onLoadMoreTools'), 'the catalog exposes load-more');
});

test('G11-A12/A13/B10 (D-624/D-625/D-630): the API client pages lists and exposes the new reads', async () => {
  const src = await read('../src/api/toolRentals.js');
  assert.ok(src.includes('getMyRentalIdentity'), 'identity/mine is exposed');
  assert.ok(src.includes('getEquipmentBooking'), 'the operations booking read is exposed');
  assert.ok(src.includes("getMyBookings: async ({ limit, offset } = {})"), 'my bookings page');
  assert.ok(src.includes("getBookingsByOwner: async ({ limit, offset } = {})"), 'owner bookings page');
});

test('G11 LOW batch i18n (D-621..D-634): every new key exists in all five locales', async () => {
  const toolRentalsKeys = [
    'cancelBookingConfirm', 'depositAgreedAmount', 'depositWithholdDiffers',
    'damageClaimReport', 'damageClaimNoReport', 'renterEmailNotVerified', 'safetyDocDeleteFailed',
  ];
  for (const locale of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = await readJson(`../src/locales/${locale}.json`);
    for (const key of toolRentalsKeys) {
      assert.ok(typeof catalog.toolRentals[key] === 'string', `${locale}.toolRentals.${key}`);
    }
    assert.ok(typeof catalog.dashboards.toolOwner.invoicedHint === 'string', `${locale}.dashboards.toolOwner.invoicedHint`);
    for (const key of ['pickupReport', 'returnReport', 'photos', 'evidenceUploadedBy']) {
      assert.ok(typeof catalog.equipmentOperations[key] === 'string', `${locale}.equipmentOperations.${key}`);
    }
  }
});

test('G11 LOW batch server wiring (D-621/D-626/D-627/D-632): the clear set, email gate, invoice retry, and atomic update are present', async () => {
  const rentals = await read('../../server/routes/toolRentals.js');
  assert.ok(rentals.includes('clearIndex'), 'the PUT carries the clear set');
  assert.ok(rentals.includes("CASE WHEN $${clearIndex}::jsonb ? 'description'"), 'clearable columns NULL on clear');
  assert.ok(rentals.includes('/identity/mine'), 'the identity endpoint exists');
  const bookings = await read('../../server/controllers/toolBookingsController.js');
  assert.ok(bookings.includes('renter_email_not_verified'), 'the renter email gate exists');
  assert.ok(bookings.includes('AND status = $5'), 'the status update is atomic on the prior status');
  const invoices = await read('../../server/controllers/invoiceController.js');
  assert.ok(invoices.includes('SAVEPOINT invoice_number'), 'invoice numbers retry behind a savepoint');
  assert.ok(invoices.includes('crypto.randomInt(100000, 999999)'), 'the random part is six digits');
  const ops = await read('../../server/services/equipmentOperations.js');
  assert.ok(ops.includes('uploader_first_name'), 'readBooking joins the uploader name');
});
