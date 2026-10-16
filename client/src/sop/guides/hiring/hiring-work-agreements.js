/**
 * hiring-work-agreements.js - SOP guide: Create and sign work agreements.
 * Screen sources: client/src/pages/NewWorkAgreementPage.jsx, client/src/pages/WorkAgreementPage.jsx
 */

const guide = {
  id: 'hiring-work-agreements',
  area: 'hiring',
  slug: 'work-agreements',
  title: 'Create and sign work agreements',
  audiences: ['customer', 'helper'],
  revision: 1,
  availability: 'supported',
  conditions: [],
  goal: 'Create a bilateral work agreement with drawn signatures, manage change orders, and keep the records.',
  intendedRoles: ['Customer', 'Helper'],
  prerequisites: [
    { text: 'Be signed in to your OxSteed account.', guideId: 'account-signin', href: '/login' },
    { text: 'Have a job the agreement starts from ("An agreement starts from a job. Pick a job first.").', guideId: 'hiring-post-job', href: '/post-job' },
  ],
  processMap: {
    nodes: [
      { id: 'start', label: 'Open New work agreement', type: 'terminal' },
      { id: 'pick', label: 'Pick the job and write the terms', type: 'step' },
      { id: 'create', label: 'Create the agreement', type: 'step' },
      { id: 'sign1', label: 'Draw your signature', type: 'step' },
      { id: 'sign2', label: 'Other party signs?', type: 'decision' },
      { id: 'active', label: 'Agreement becomes active', type: 'terminal' },
      { id: 'waiting', label: 'Waiting for the other party', type: 'blocked' },
      { id: 'change', label: 'Propose a change order when scope changes', type: 'step' },
    ],
    edges: [
      { from: 'start', to: 'pick' },
      { from: 'pick', to: 'create' },
      { from: 'create', to: 'sign1' },
      { from: 'sign1', to: 'sign2' },
      { from: 'sign2', to: 'active', label: 'Signed' },
      { from: 'sign2', to: 'waiting', label: 'Not yet' },
      { from: 'waiting', to: 'active', label: 'Signed' },
      { from: 'active', to: 'change' },
    ],
  },
  processMapText:
    '1. Open /agreements/new ("New work agreement"). 2. Pick the job, write the Scope of work, the Agreed price, warranty terms, reimbursement terms, and any Other terms; "Draft terms with AI" can start the text. ' +
    '3. Choose "Create agreement". 4. Open "Sign the agreement" and draw your signature in the pad ("Your drawn signature is binding. A new version requires signing again."), then "Sign" or "Sign this version". ' +
    '5. The other party signs the same way ("Both parties must sign before the agreement becomes active."). 6. When scope changes, use Change orders: "Propose", then "Sign and submit" ("Your drawn signature is required. Change orders are binding once both parties sign.").',
  steps: [
    {
      id: 'hiring-work-agreements-s1',
      title: 'Create a new work agreement from the job',
      body: 'Open /agreements/new. The heading is "New work agreement" with the description "Create a bilateral work agreement with drawn signatures." Pick the job the agreement is for. Write the Scope of work, the Agreed price, Warranty terms ("e.g. Six months on the repair. If the leak returns, the helper returns to fix it."), Reimbursement terms, and Other terms. "Draft terms with AI" can generate a starting draft if you prefer.',
      expectedResult: 'All terms fields are complete and ready to create.',
      screenshots: [
        {
          id: 'hiring-work-agreements-s1-desktop',
          viewport: 'desktop',
          screen: '/agreements/new',
          state: 'New work agreement form filled in, signed in, light mode',
          alt: 'New work agreement form with scope and price fields',
          caption: 'The New work agreement form, desktop view.',
          annotations: [
            { n: 1, label: 'Scope of work', locator: 'textarea' },
            { n: 2, label: 'Agreed price', locator: 'input[name="price"]' },
            { n: 3, label: 'Warranty terms', locator: 'textarea' },
            { n: 4, label: 'Create agreement button', locator: 'button[type="submit"]' },
          ],
        },
        {
          id: 'hiring-work-agreements-s1-mobile',
          viewport: 'mobile',
          screen: '/agreements/new',
          state: 'New work agreement form filled in, signed in, light mode',
          alt: 'New work agreement form on a phone screen',
          caption: 'The agreement form, mobile view.',
          annotations: [
            { n: 1, label: 'Scope of work', locator: 'textarea' },
          ],
        },
      ],
    },
    {
      id: 'hiring-work-agreements-s2',
      title: 'Sign the agreement with a drawn signature',
      body: 'On /agreements/:id, open "Sign the agreement". Draw your signature in the signature pad and choose "Sign" or "Sign this version". The warning reads: "Your drawn signature is binding. A new version requires signing again." Both parties must sign ("Awaiting signature" shows until they do) before the agreement becomes active.',
      expectedResult: 'Your signature is recorded under Signatures and the other party is asked to sign.',
      screenshots: [
        {
          id: 'hiring-work-agreements-s2-desktop',
          viewport: 'desktop',
          screen: '/agreements/:id',
          state: 'Signature pad open, signed in, light mode',
          alt: 'Sign the agreement dialog with the signature pad',
          caption: 'The drawn-signature pad, desktop view.',
          annotations: [
            { n: 1, label: 'Signature pad', locator: 'canvas' },
            { n: 2, label: 'Sign button', locator: 'button' },
          ],
        },
        {
          id: 'hiring-work-agreements-s2-mobile',
          viewport: 'mobile',
          screen: '/agreements/:id',
          state: 'Signature pad open, signed in, light mode',
          alt: 'Signature pad on a phone screen',
          caption: 'The signature pad, mobile view.',
          annotations: [
            { n: 1, label: 'Signature pad', locator: 'canvas' },
          ],
        },
      ],
    },
    {
      id: 'hiring-work-agreements-s3',
      title: 'Use change orders when the scope changes',
      body: 'On the agreement page, open Change orders. Choose "Propose", describe the change and the Price change (USD), then open "Sign the change order" and choose "Sign and submit". The other party reviews and signs too; "Waiting for the other party to decide." shows in the meantime. Every version keeps its own Timeline entry.',
      expectedResult: 'The change order is proposed and signed by both parties.',
      screenshots: [
        {
          id: 'hiring-work-agreements-s3-desktop',
          viewport: 'desktop',
          screen: '/agreements/:id',
          state: 'Change orders section, signed in, light mode',
          alt: 'Change orders section with the Propose button',
          caption: 'The Change orders section.',
          annotations: [
            { n: 1, label: 'Change orders', locator: 'section' },
            { n: 2, label: 'Propose button', locator: 'button' },
          ],
        },
        {
          id: 'hiring-work-agreements-s3-mobile',
          viewport: 'mobile',
          screen: '/agreements/:id',
          state: 'Change orders section, signed in, light mode',
          alt: 'Change orders on a phone screen',
          caption: 'The Change orders section, mobile view.',
          annotations: [
            { n: 1, label: 'Propose button', locator: 'button' },
          ],
        },
      ],
    },
    {
      id: 'hiring-work-agreements-s4',
      title: 'Keep the records: vault, evidence, and warranty claims',
      body: 'Use the Document vault to upload outside paperwork ("Choose a file" or "Or paste an https link"). Add Evidence: before and after photos plus the testing record. If the work fails under warranty, choose "File claim" in Warranty claims; the note explains "OxSteed records the claim. The parties resolve it between themselves." When the work is done, use "Confirm complete" ("Both of you confirm before the agreement is marked complete.").',
      expectedResult: 'Records, evidence, and any claims are stored on the agreement timeline.',
      screenshots: [
        {
          id: 'hiring-work-agreements-s4-desktop',
          viewport: 'desktop',
          screen: '/agreements/:id',
          state: 'Agreement with vault and warranty sections, signed in, light mode',
          alt: 'Document vault and warranty claims sections',
          caption: 'The records sections, desktop view.',
          annotations: [
            { n: 1, label: 'Document vault', locator: 'section' },
            { n: 2, label: 'Evidence', locator: 'section' },
            { n: 3, label: 'Warranty claims', locator: 'section' },
          ],
        },
        {
          id: 'hiring-work-agreements-s4-mobile',
          viewport: 'mobile',
          screen: '/agreements/:id',
          state: 'Agreement with vault and warranty sections, signed in, light mode',
          alt: 'Records sections on a phone screen',
          caption: 'The records sections, mobile view.',
          annotations: [
            { n: 1, label: 'Document vault', locator: 'section' },
          ],
        },
      ],
    },
  ],
  confirmOutcome: 'The agreement shows both signatures and becomes active. The Timeline records versions, change orders, evidence, and claims; "OxSteed keeps the records. You and the other party decide the terms."',
  recovery: [
    {
      problem: 'The agreement will not become active.',
      solution: 'Both parties must sign the current version. If you edited the terms after signing, the version changed and signing is required again.',
    },
    {
      problem: 'A change order is stuck waiting.',
      solution: 'The other party must sign too ("You confirmed. Waiting for the other party to confirm."). Message them from the job thread.',
    },
  ],
  supportContact: 'For issues with a signed agreement, open a dispute on the job or contact support at /support.',
  relatedGuides: ['hiring-post-job', 'hiring-compare-bids', 'hiring-completion', 'hiring-disputes'],
  siteLinks: [
    { label: 'New work agreement', href: '/agreements/new' },
    { label: 'My jobs', href: '/my-jobs' },
  ],
  sources: [
    { type: 'route', ref: '/agreements/new' },
    { type: 'route', ref: '/agreements/:id' },
    { type: 'screen', ref: 'client/src/pages/NewWorkAgreementPage.jsx' },
    { type: 'screen', ref: 'client/src/pages/WorkAgreementPage.jsx' },
    { type: 'handler', ref: 'POST /api/work-agreements, POST /api/work-agreements/:id/sign, POST /api/work-agreements/:id/change-orders' },
    { type: 'permission', ref: 'Authenticated.' },
  ],
};

export default guide;
