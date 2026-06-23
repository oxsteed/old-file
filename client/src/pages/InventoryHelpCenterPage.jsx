import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  KeyRound,
  LifeBuoy,
  PackageCheck,
  QrCode,
  ShoppingCart,
  Trash2,
  UsersRound,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';

const setupSteps = [
  {
    title: 'Sign in with your OxSteed account',
    body: 'Use the same OxSteed account connected to your restaurant business. Owners are recognized automatically after sign in; team members join with a Vortex workspace code.',
    icon: UsersRound,
  },
  {
    title: 'Join or select the restaurant workspace',
    body: 'Inventory is scoped to a restaurant workspace. If you are a team member, enter the Vortex code from the owner or manager. If you own the business, the app can load your owned workspace directly.',
    icon: KeyRound,
  },
  {
    title: 'Choose the inventory area',
    body: 'Areas keep stock separated by location, such as Main inventory, Bar, Walk-in cooler, Prep line, Dry storage, or a second restaurant location.',
    icon: Boxes,
  },
  {
    title: 'Confirm sync health',
    body: 'The Home screen shows whether the app is synced. If you see pending events, use More -> Sync Status -> Sync Now before relying on counts.',
    icon: Cloud,
  },
];

const workflows = [
  {
    title: 'Count item',
    icon: ClipboardCheck,
    summary: 'Use counts when you physically check stock on hand.',
    steps: [
      'Open Count item from Quick actions or open an item from Stock.',
      'Select the correct area before entering the count.',
      'Enter the current quantity and unit, then save.',
      'OxSteed updates stock risk and menu impact after the count syncs.',
    ],
  },
  {
    title: 'Receive',
    icon: PackageCheck,
    summary: 'Use receiving when a supplier delivery arrives.',
    steps: [
      'Open Receive and choose the item or purchase request.',
      'Enter quantity received, supplier, invoice note, and any mismatch.',
      'Save the delivery so stock increases in the selected area.',
      'Report missing, damaged, or substituted items as supplier issues.',
    ],
  },
  {
    title: 'Report waste',
    icon: Trash2,
    summary: 'Use waste when inventory is spoiled, damaged, expired, or used outside a sale.',
    steps: [
      'Open Report waste and select the item.',
      'Choose the reason, quantity, and area.',
      'Add a note if the waste affects a menu item or supplier order.',
      'Save so OxSteed lowers available stock and tracks cost impact.',
    ],
  },
  {
    title: 'Request stock',
    icon: ShoppingCart,
    summary: 'Use requests when an item needs reorder approval or restocking.',
    steps: [
      'Open Request and choose the item you need.',
      'Enter requested quantity, urgency, area, and reason.',
      'Managers can review pending requests before purchase or transfer.',
      'Approved requests can become supplier orders or internal transfers.',
    ],
  },
  {
    title: 'Supplier issue',
    icon: AlertTriangle,
    summary: 'Use supplier issues when a delivery, price, quality, or availability problem needs tracking.',
    steps: [
      'Open Supplier issue and describe what happened.',
      'Attach the affected item, supplier, and request or delivery if available.',
      'Use status updates to move the issue from open to monitoring, in progress, or resolved.',
      'Resolved issues stay in history so the restaurant can spot repeat supplier problems.',
    ],
  },
  {
    title: 'Scan item',
    icon: QrCode,
    summary: 'Use scanning to find an item quickly from barcode or QR code.',
    steps: [
      'Open Scan item and allow camera access.',
      'Scan the barcode or QR code on the item or shelf label.',
      'If scanning fails, search manually and report the barcode issue.',
      'Managers can correct missing barcodes from item setup later.',
    ],
  },
];

const roles = [
  ['Owner', 'Can access owned restaurant workspaces, review inventory risk, and manage setup.'],
  ['Manager', 'Can monitor stock, approve requests, receive deliveries, and resolve supplier issues.'],
  ['Employee', 'Can count, receive, waste, request, and scan based on the permissions assigned in the workspace.'],
  ['OxSteed admin', 'Can help troubleshoot account, workspace, sync, and support cases when restaurant teams need help.'],
];

const syncRules = [
  'A synced state means saved inventory events have reached OxSteed.',
  'Pending events mean the app is holding local changes until the connection is available.',
  'If items are missing, confirm the selected restaurant workspace and area first.',
  'If menu impact looks wrong, check whether the menu item is linked to the inventory item.',
  'If the app reports an internal server error, retry after a fresh sync and contact support if it continues.',
];

function IconCard({ item }) {
  const Icon = item.icon;
  return (
    <article style={cardStyle}>
      <span style={iconShellStyle}><Icon size={24} /></span>
      <h3 style={cardTitleStyle}>{item.title}</h3>
      <p style={cardTextStyle}>{item.body}</p>
    </article>
  );
}

function WorkflowCard({ item }) {
  const Icon = item.icon;
  return (
    <article style={workflowCardStyle}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <span style={workflowIconStyle}><Icon size={24} /></span>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 22, letterSpacing: '-.04em' }}>{item.title}</h3>
          <p style={{ margin: 0, color: '#64748b', lineHeight: 1.55 }}>{item.summary}</p>
        </div>
      </div>
      <ol style={{ margin: '18px 0 0', paddingLeft: 20, color: '#334155', lineHeight: 1.7 }}>
        {item.steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </article>
  );
}

export default function InventoryHelpCenterPage() {
  return (
    <PageShell>
      <PageMeta
        title="OxSteed Inventory Help Center"
        description="Setup guides and workflow instructions for the OxSteed Inventory app."
        url="https://oxsteed.com/help/inventory"
      />

      <div style={{
        background:
          'radial-gradient(circle at 12% 0%, rgba(249,115,22,.20), transparent 28rem), radial-gradient(circle at 88% 10%, rgba(15,23,42,.10), transparent 24rem), #f8fafc',
      }}>
        <section style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: 'clamp(42px, 8vw, 86px) clamp(18px, 4vw, 44px) 34px',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.25fr) minmax(280px, .75fr)',
            gap: 28,
            alignItems: 'stretch',
          }}>
            <div style={{
              borderRadius: 34,
              background: '#0f172a',
              color: '#fff',
              padding: 'clamp(28px, 5vw, 56px)',
              boxShadow: '0 28px 80px rgba(15,23,42,.22)',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                right: -80,
                top: -80,
                width: 240,
                height: 240,
                borderRadius: '50%',
                background: 'rgba(249,115,22,.22)',
              }} />
              <div style={{ position: 'relative' }}>
                <span style={eyebrowStyle}>OxSteed Inventory</span>
                <h1 style={{
                  margin: '16px 0',
                  fontSize: 'clamp(42px, 8vw, 82px)',
                  lineHeight: .92,
                  letterSpacing: '-.08em',
                }}>
                  Setup and workflow guides
                </h1>
                <p style={{
                  margin: 0,
                  maxWidth: 720,
                  color: '#cbd5e1',
                  fontSize: 'clamp(17px, 2vw, 21px)',
                  lineHeight: 1.65,
                }}>
                  Learn how restaurant teams use OxSteed Inventory to count stock, receive deliveries,
                  report waste, request items, track supplier issues, scan items, and keep menu impact accurate.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26 }}>
                  <a href="#setup" style={primaryCtaStyle}>Start setup <ArrowRight size={18} /></a>
                  <a href="#workflows" style={secondaryCtaStyle}>View workflows</a>
                </div>
              </div>
            </div>

            <aside style={{
              borderRadius: 34,
              background: '#fff',
              padding: 26,
              boxShadow: '0 24px 70px rgba(15,23,42,.10)',
              border: '1px solid #e2e8f0',
            }}>
              <h2 style={{ margin: '0 0 16px', fontSize: 24, letterSpacing: '-.04em' }}>What this guide covers</h2>
              <div style={{ display: 'grid', gap: 12 }}>
                {['First-time setup', 'Vortex workspace access', 'Inventory areas', 'Stock counts', 'Receiving', 'Waste', 'Requests', 'Supplier issues', 'Sync troubleshooting'].map((item) => (
                  <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#334155' }}>
                    <CheckCircle2 size={18} color="#f97316" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section id="setup" style={sectionStyle}>
          <span style={sectionKickerStyle}>First-time setup</span>
          <h2 style={sectionTitleStyle}>Before the first count</h2>
          <p style={sectionIntroStyle}>
            Inventory only works properly when the account, restaurant workspace, area, and sync state are clear.
            Complete these steps before teams start entering stock data.
          </p>
          <div style={gridStyle}>
            {setupSteps.map((item) => <IconCard key={item.title} item={item} />)}
          </div>
        </section>

        <section id="workflows" style={sectionStyle}>
          <span style={sectionKickerStyle}>Daily workflows</span>
          <h2 style={sectionTitleStyle}>How each Inventory action should be used</h2>
          <p style={sectionIntroStyle}>
            These flows match the buttons inside the OxSteed Inventory app. Use the right action so stock,
            menu impact, and supplier history stay accurate.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
            {workflows.map((item) => <WorkflowCard key={item.title} item={item} />)}
          </div>
        </section>

        <section style={sectionStyle}>
          <span style={sectionKickerStyle}>Roles and access</span>
          <h2 style={sectionTitleStyle}>Who should do what?</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {roles.map(([role, detail]) => (
              <div key={role} style={{
                display: 'grid',
                gridTemplateColumns: '150px 1fr',
                gap: 16,
                padding: 18,
                borderRadius: 20,
                background: '#fff',
                border: '1px solid #e2e8f0',
              }}>
                <strong style={{ color: '#0f172a' }}>{role}</strong>
                <span style={{ color: '#475569', lineHeight: 1.55 }}>{detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={sectionStyle}>
          <span style={sectionKickerStyle}>Sync and troubleshooting</span>
          <h2 style={sectionTitleStyle}>When something does not look right</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, .9fr) minmax(280px, 1.1fr)',
            gap: 18,
            alignItems: 'stretch',
          }}>
            <div style={{
              borderRadius: 28,
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              padding: 24,
            }}>
              <LifeBuoy size={34} color="#f97316" />
              <h3 style={{ margin: '14px 0 8px', fontSize: 26, letterSpacing: '-.05em' }}>Need help?</h3>
              <p style={{ margin: 0, color: '#9a3412', lineHeight: 1.6 }}>
                If the guide does not solve it, open a support request from the app or email support with
                your restaurant name, account email, item name, area, and what you expected to happen.
              </p>
              <a href="/support/escalation?app=inventory" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 18,
                color: '#fff',
                background: '#f97316',
                borderRadius: 999,
                padding: '12px 16px',
                fontWeight: 900,
                textDecoration: 'none',
              }}>
                Contact support <ArrowRight size={18} />
              </a>
            </div>
            <div style={{
              borderRadius: 28,
              background: '#fff',
              border: '1px solid #e2e8f0',
              padding: 24,
            }}>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 14 }}>
                {syncRules.map((rule) => (
                  <li key={rule} style={{ display: 'flex', gap: 12, color: '#334155', lineHeight: 1.55 }}>
                    <CheckCircle2 size={20} color="#16a34a" style={{ flex: '0 0 auto', marginTop: 2 }} />
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

const eyebrowStyle = {
  display: 'inline-flex',
  borderRadius: 999,
  padding: '8px 12px',
  background: 'rgba(249,115,22,.16)',
  color: '#fed7aa',
  fontWeight: 900,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontSize: 12,
};

const sectionStyle = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '34px clamp(18px, 4vw, 44px)',
};

const sectionKickerStyle = {
  display: 'inline-flex',
  color: '#f97316',
  fontWeight: 900,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontSize: 12,
  marginBottom: 10,
};

const sectionTitleStyle = {
  margin: '0 0 10px',
  color: '#0f172a',
  fontSize: 'clamp(30px, 5vw, 54px)',
  lineHeight: 1,
  letterSpacing: '-.07em',
};

const sectionIntroStyle = {
  margin: '0 0 22px',
  maxWidth: 780,
  color: '#64748b',
  fontSize: 18,
  lineHeight: 1.65,
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 16,
};

const cardStyle = {
  borderRadius: 26,
  background: '#fff',
  border: '1px solid #e2e8f0',
  padding: 22,
  boxShadow: '0 18px 48px rgba(15,23,42,.07)',
};

const iconShellStyle = {
  width: 52,
  height: 52,
  borderRadius: 18,
  display: 'grid',
  placeItems: 'center',
  background: '#fff7ed',
  color: '#f97316',
};

const cardTitleStyle = {
  margin: '16px 0 8px',
  color: '#0f172a',
  fontSize: 21,
  letterSpacing: '-.04em',
};

const cardTextStyle = {
  margin: 0,
  color: '#64748b',
  lineHeight: 1.6,
};

const workflowCardStyle = {
  borderRadius: 28,
  background: '#fff',
  border: '1px solid #e2e8f0',
  padding: 24,
  boxShadow: '0 20px 55px rgba(15,23,42,.08)',
};

const workflowIconStyle = {
  width: 52,
  height: 52,
  borderRadius: 18,
  display: 'grid',
  placeItems: 'center',
  background: '#0f172a',
  color: '#fb923c',
  flex: '0 0 auto',
};

const primaryCtaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  color: '#0f172a',
  background: '#fb923c',
  borderRadius: 999,
  padding: '13px 18px',
  fontWeight: 900,
  textDecoration: 'none',
};

const secondaryCtaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  color: '#fff',
  border: '1px solid rgba(255,255,255,.24)',
  borderRadius: 999,
  padding: '13px 18px',
  fontWeight: 900,
  textDecoration: 'none',
};
