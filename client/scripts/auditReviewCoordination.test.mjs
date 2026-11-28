import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (rel) => readFile(new URL(rel, root), 'utf8');

// Group 14 Slice 5i (741-745): the new auditRequests keys, one per
// user-visible string the detail and the invite accept page use.
const NEW_KEYS = [
  'invitationsTitle', 'invitationsDescription', 'inviteEmailLabel', 'invite',
  'inviteSentNotice', 'noInvitations', 'invitationExpiresAt', 'invitationRevokedNotice',
  'invitationStatusPending', 'invitationStatusAccepted', 'invitationStatusRevoked',
  'invitationStatusExpired',
  'scopeReviewTitle', 'scopeReviewDescription', 'scopeDecisionLabel',
  'scopeAcknowledged', 'scopeNeedsClarification', 'scopeNotePlaceholder',
  'scopeSubmit', 'scopeSubmittedNotice', 'noScopeReviews',
  'correctionsTitle', 'correctionsDescription', 'correctionEvidenceLabel',
  'correctionEvidenceNone', 'correctionRecordRefLabel', 'correctionRecordRefPlaceholder',
  'correctionDetailLabel', 'correctionDetailPlaceholder', 'correctionSubmit',
  'correctionSubmittedNotice', 'noCorrections', 'correctionStatusRequested',
  'correctionStatusAddressed', 'correctionStatusDeclined', 'correctionResolveNoteLabel',
  'correctionResolveNotePlaceholder', 'correctionMarkAddressed', 'correctionMarkDeclined',
  'correctionResolvedNotice',
  'annotationsTitle', 'annotationsDescription', 'annotationNotePlaceholder',
  'annotationAdd', 'annotationAddedNotice', 'noAnnotations',
  'closeNotifies',
  'inviteAcceptTitle', 'inviteAcceptDescription', 'inviteAcceptEmailLabel',
  'inviteAcceptCodeLabel', 'inviteAcceptVerify', 'inviteAcceptAccept',
  'inviteAcceptVerifiedNotice', 'inviteAcceptAcceptedNotice', 'inviteAcceptSignInPrompt',
  'inviteAcceptViewRequests',
];

test('audit request detail fetches the 5i sub-resources and guards the manager-only ones', async () => {
  const src = await read('src/components/statements/AuditRequestDetail.jsx');
  for (const path of ['/scope-review', '/corrections', '/invitations', '/annotations']) {
    assert.ok(src.includes(`\`/audit-requests/\${requestId}${path}\``), `detail fetches ${path}`);
  }
  // Invitations and annotations are fetched only for managers: the two
  // fetches sit inside the isManager branch, never on the shared path.
  assert.match(src, /if \(isManager\)[\s\S]*?\/invitations[\s\S]*?\/annotations/, 'manager-only fetch branch');
  // The detail renders the four new sections and the close hint.
  for (const heading of ['audit-invitations-heading', 'audit-scope-review-heading', 'audit-corrections-heading', 'audit-annotations-heading']) {
    assert.ok(src.includes(heading), `detail renders ${heading}`);
  }
  assert.ok(src.includes('closeNotifies'), 'detail names the completion notice on close');
  // The correction form targets approved evidence or a free-text
  // reference, never a proposed document the auditor cannot see.
  assert.match(src, /filter\(\(item\) => item\.status === 'approved'\)/, 'correction target is approved evidence only');
});

test('the invite accept page verifies then accepts, and the route is registered', async () => {
  const page = await read('src/pages/food/AcceptAuditInvitationPage.jsx');
  assert.ok(page.includes('/audit-requests/invitations/verify'), 'accept page verifies');
  assert.ok(page.includes('/audit-requests/invitations/accept'), 'accept page accepts');
  assert.ok(page.includes('useSearchParams'), 'accept page reads the invitation id from the link');
  assert.ok(page.includes("to=\"/statements/audit-requests\""), 'accept page links to the request list');
  const app = await read('src/App.jsx');
  assert.ok(app.includes('AcceptAuditInvitationPage'), 'App lazy-loads the accept page');
  assert.ok(app.includes('path="/statements/audit-requests/invite"'), 'App registers the invite route');
});

test('the new auditRequests keys exist in all five locales with identical sets', async () => {
  const sets = {};
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await read(`src/i18n/locales/${lang}/credit.json`));
    const section = catalog.statements.auditRequests;
    for (const key of NEW_KEYS) {
      assert.equal(typeof section[key], 'string', `${lang}.${key}`);
      assert.ok(section[key].length > 0, `${lang}.${key} is non-empty`);
    }
    sets[lang] = new Set(Object.keys(section));
  }
  for (const lang of ['es', 'fr', 'ht', 'ar']) {
    assert.deepEqual([...sets[lang]].sort(), [...sets.en].sort(), `${lang} key parity`);
  }
});

test('every plain-literal t() key the detail and accept page use exists in the en catalog', async () => {
  const en = JSON.parse(await read('src/i18n/locales/en/credit.json'));
  const section = en.statements.auditRequests;
  for (const file of ['src/components/statements/AuditRequestDetail.jsx', 'src/pages/food/AcceptAuditInvitationPage.jsx']) {
    const src = await read(file);
    const used = [...src.matchAll(/text\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
    for (const key of new Set(used)) {
      assert.ok(key in section, `${file} uses missing key ${key}`);
    }
  }
});
