import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Briefcase,
  CalendarDays,
  Car,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Hammer,
  HeartHandshake,
  Home,
  Landmark,
  LifeBuoy,
  MapPin,
  MessageSquare,
  PackageSearch,
  QrCode,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Target,
  UserRoundCheck,
  Wrench,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import './FeatureGuidePage.css';

function getUserPaths(t) {
  return [
  {
    label: t('howOxsteedWorks.paths.customers.label'),
    title: t('howOxsteedWorks.paths.customers.title'),
    steps: [
      t('howOxsteedWorks.paths.customers.steps.0'),
      t('howOxsteedWorks.paths.customers.steps.1'),
      t('howOxsteedWorks.paths.customers.steps.2'),
    ],
    cta: { label: t('howOxsteedWorks.paths.customers.cta'), to: '/post-job' },
  },
  {
    label: t('howOxsteedWorks.paths.helpers.label'),
    title: t('howOxsteedWorks.paths.helpers.title'),
    steps: [
      t('howOxsteedWorks.paths.helpers.steps.0'),
      t('howOxsteedWorks.paths.helpers.steps.1'),
      t('howOxsteedWorks.paths.helpers.steps.2'),
    ],
    cta: { label: t('howOxsteedWorks.paths.helpers.cta'), to: '/jobs' },
  },
  {
    label: t('howOxsteedWorks.paths.businesses.label'),
    title: t('howOxsteedWorks.paths.businesses.title'),
    steps: [
      t('howOxsteedWorks.paths.businesses.steps.0'),
      t('howOxsteedWorks.paths.businesses.steps.1'),
      t('howOxsteedWorks.paths.businesses.steps.2'),
    ],
    cta: { label: t('howOxsteedWorks.paths.businesses.cta'), to: '/business-hub' },
  },
  {
    label: t('howOxsteedWorks.paths.toolOwners.label'),
    title: t('howOxsteedWorks.paths.toolOwners.title'),
    steps: [
      t('howOxsteedWorks.paths.toolOwners.steps.0'),
      t('howOxsteedWorks.paths.toolOwners.steps.1'),
      t('howOxsteedWorks.paths.toolOwners.steps.2'),
    ],
    cta: { label: t('howOxsteedWorks.paths.toolOwners.cta'), to: '/tool-rentals' },
  },
  ];
}

const FEATURE_SECTIONS = [
  {
    id: 'command-center',
    category: 'Life Command Center',
    title: 'Customer Dashboard and Life Pulse',
    icon: Sparkles,
    summary:
      'The dashboard is the user’s daily home base: money, jobs, messages, home care, car care, goals, planned needs, and tools all roll into one place.',
    realLife: [
      'A homeowner can see open jobs, upcoming reminders, unread messages, and money pressure without jumping between unrelated screens.',
      'A busy parent can quickly post a new repair, check whether a helper responded, and see whether this month can absorb another expense.',
      'A customer building a more organized household can use the dashboard as a weekly review: what needs attention, what is already handled, and what should be planned ahead.',
    ],
    connectedTo: ['Money', 'Planned Needs', 'Jobs', 'Messages', 'Calendar', 'Home Care', 'Car Care', 'Goals'],
    actions: [
      { label: 'Open dashboard', to: '/dashboard' },
      { label: 'Open money tab', to: '/dashboard?tab=money' },
      { label: 'Create a planned need', to: '/planned-needs' },
    ],
  },
  {
    id: 'post-job',
    category: 'Hiring',
    title: 'Post a Job',
    icon: ClipboardList,
    summary:
      'Post a real-world task and invite local helpers to bid, message, schedule, and complete the work through OxSteed.',
    realLife: [
      'A customer can post “install EV charger,” “bathroom remodel,” “yard cleanup,” or “move furniture” and collect bids in one place.',
      'Instead of calling several people and losing context, the job page keeps the description, photos, location, bids, helper assignment, payment state, and timeline together.',
      'When a planned need becomes urgent, OxSteed can carry the title, notes, home location, due date, and preferred helper into the post-job flow.',
    ],
    connectedTo: ['Browse Helpers', 'Bids', 'Messages', 'Calendar', 'Payments', 'Disputes', 'Planned Needs'],
    actions: [
      { label: 'Post a job', to: '/post-job' },
      { label: 'Browse open jobs', to: '/jobs' },
      { label: 'View my jobs', to: '/my-jobs' },
    ],
  },
  {
    id: 'browse-jobs',
    category: 'Marketplace',
    title: 'Browse Jobs',
    icon: Briefcase,
    summary:
      'Helpers use the job directory to find local work, filter by location/category, and submit bids that match their availability and skill.',
    realLife: [
      'An electrician can find nearby wiring jobs, compare scope, and bid with an estimate instead of waiting for random referrals.',
      'A handyman can sort by proximity and urgency to fill open calendar gaps.',
      'A new helper can learn what customers need in their area and build a reputation through completed jobs.',
    ],
    connectedTo: ['Helper Profiles', 'Bids', 'Messages', 'Payments', 'Calendar', 'Reputation'],
    actions: [
      { label: 'Browse jobs', to: '/jobs' },
      { label: 'View my bids', to: '/my-bids' },
    ],
  },
  {
    id: 'helpers',
    category: 'Hiring',
    title: 'Find Helpers and Public Profiles',
    icon: UserRoundCheck,
    summary:
      'The helper directory and public profiles let customers evaluate local people before hiring: services, location, gallery, reputation, pricing context, templates, QR code, and direct booking.',
    realLife: [
      'A customer can compare helpers for plumbing, moving, cleaning, tutoring, beauty, tech setup, or home repair before posting a public job.',
      'A helper can share a polished profile link or QR code with customers offline and send them back into OxSteed for secure booking and messaging.',
      'Saved helpers become preferred helpers for planned needs, giving trusted people the first chance to accept future work.',
    ],
    connectedTo: ['Direct Booking', 'Saved Helpers', 'Planned Needs', 'Messages', 'Calendar', 'Profile Templates', 'QR Codes'],
    actions: [
      { label: 'Find helpers', to: '/helpers' },
      { label: 'Edit helper profile', to: '/dashboard/edit-profile' },
      { label: 'Explore templates', to: '/templates?type=helper' },
    ],
  },
  {
    id: 'booking',
    category: 'Scheduling',
    title: 'Direct Helper Booking',
    icon: CalendarDays,
    summary:
      'Direct booking lets a customer request a specific helper and time without posting the job publicly first.',
    realLife: [
      'A customer who already trusts a cleaner, tutor, mechanic, stylist, or handyman can request that person directly.',
      'If the helper accepts, the work stays private and scheduled. If the helper declines or expires, the customer can convert the request into a public job.',
      'Booking requests reduce friction for repeat work and help helpers keep a predictable schedule.',
    ],
    connectedTo: ['Helper Profiles', 'Calendar', 'Messages', 'Post a Job', 'Notifications'],
    actions: [
      { label: 'Browse helpers to book', to: '/helpers' },
      { label: 'View bookings', to: '/my-bookings' },
      { label: 'Open calendar', to: '/calendar' },
    ],
  },
  {
    id: 'messages',
    category: 'Communication',
    title: 'Messages and Work Conversations',
    icon: MessageSquare,
    summary:
      'Messaging keeps job, booking, support, and helper/customer conversations inside OxSteed so context is not scattered across texts and email.',
    realLife: [
      'A customer can ask a helper about materials, timing, access instructions, or photos before accepting a bid.',
      'A helper can clarify scope before committing, reducing missed expectations and disputes.',
      'Conversation history supports accountability if a cancellation, delay, dispute, or support escalation happens later.',
    ],
    connectedTo: ['Jobs', 'Bookings', 'Support', 'Disputes', 'Notifications'],
    actions: [
      { label: 'Open messages', to: '/messages' },
      { label: 'Helper inbox', to: '/helper/messages' },
    ],
  },
  {
    id: 'calendar',
    category: 'Scheduling',
    title: 'Calendar, Availability, and Reminders',
    icon: CalendarDays,
    summary:
      'The calendar turns jobs, appointments, booking requests, helper availability, and reminders into a schedule users can actually trust.',
    realLife: [
      'A customer can see upcoming appointments and planned services before overbooking their week.',
      'A helper can block availability and avoid accepting work at impossible times.',
      'Reschedules and appointment reminders keep both sides aligned around the current confirmed time.',
    ],
    connectedTo: ['Bookings', 'Jobs', 'Planned Needs', 'Notifications', 'Helper Availability'],
    actions: [
      { label: 'Open calendar', to: '/calendar' },
      { label: 'Manage bookings', to: '/my-bookings' },
    ],
  },
  {
    id: 'planned-needs',
    category: 'Life Command Center',
    title: 'Planned Needs',
    icon: Target,
    summary:
      'Planned Needs helps users schedule future services, estimate cost, reserve money over time, and auto-turn needs into jobs when the time comes.',
    realLife: [
      'A homeowner can plan seasonal HVAC service, gutter cleaning, dental visits, car maintenance, appliance replacement, or annual inspections.',
      'Instead of being surprised by a big repair, the customer sees how much to reserve per day, week, or month.',
      'When the due date approaches, a planned need can become a job draft or auto-published job with a preferred helper first in line.',
    ],
    connectedTo: ['Money', 'Dashboard', 'Post a Job', 'Saved Helpers', 'Calendar', 'Home Care', 'Car Care'],
    actions: [
      { label: 'Open planned needs', to: '/planned-needs' },
      { label: 'Open money tab', to: '/dashboard?tab=money' },
    ],
  },
  {
    id: 'money',
    category: 'Life Command Center',
    title: 'Money, Budget, and Financial Pulse',
    icon: Landmark,
    summary:
      'The money tools help customers understand income, spending, upcoming obligations, sinking funds, and whether planned services fit their real budget.',
    realLife: [
      'A customer can log income and expenses so the dashboard can show what is affordable this month.',
      'A planned service like “replace tires” can be funded gradually instead of becoming a crisis.',
      'For households or small businesses, the money view becomes the context behind hiring decisions: what can be done now, delayed, or planned.',
    ],
    connectedTo: ['Dashboard', 'Planned Needs', 'Invoices', 'Orders', 'Payments'],
    actions: [
      { label: 'Open money tab', to: '/dashboard?tab=money' },
      { label: 'Review planned needs', to: '/planned-needs' },
      { label: 'View invoices', to: '/invoices' },
    ],
  },
  {
    id: 'home-care',
    category: 'Life Command Center',
    title: 'Home Care and Maintenance',
    icon: Home,
    summary:
      'Home care gives users a place to track property-related tasks, reminders, services, and needs tied to a specific home.',
    realLife: [
      'A renter can remember filter changes, cleaning, repairs, pest control, or move-out tasks.',
      'A homeowner can associate planned needs with a property so future job drafts carry the right location context.',
      'Small landlords or property managers can use the same pattern to keep maintenance less reactive.',
    ],
    connectedTo: ['Dashboard Home Tab', 'Planned Needs', 'Post a Job', 'Calendar', 'Browse Helpers'],
    actions: [
      { label: 'Open home tab', to: '/dashboard?tab=home' },
      { label: 'Post home service', to: '/post-job' },
    ],
  },
  {
    id: 'car-care',
    category: 'Life Command Center',
    title: 'Car Care',
    icon: Car,
    summary:
      'Car care organizes vehicle maintenance and repair needs so users can plan service, estimate cost, and hire help before small problems become expensive.',
    realLife: [
      'A user can plan oil changes, brake service, tire replacement, detailing, inspection, or EV charger work.',
      'Vehicle-linked planned needs make future maintenance easier to understand and repeat.',
      'Car expenses can appear in the user’s broader life pulse instead of living in a separate mental list.',
    ],
    connectedTo: ['Dashboard Car Care Tab', 'Planned Needs', 'Post a Job', 'Money', 'Browse Helpers'],
    actions: [
      { label: 'Open car care', to: '/car-care' },
      { label: 'Plan a car need', to: '/planned-needs' },
    ],
  },
  {
    id: 'goals',
    category: 'Life Command Center',
    title: 'Goals and Personal Progress',
    icon: CheckCircle2,
    summary:
      'Goals turn the dashboard into a place for personal progress, not just transactions and tasks.',
    realLife: [
      'A user can set goals around organizing the home, launching a side business, saving for a service, or completing a maintenance backlog.',
      'Goals help OxSteed explain why a task matters, not only what needs to be clicked next.',
      'As more workflows connect, goals can guide whether the next best action is saving money, booking help, or posting work.',
    ],
    connectedTo: ['Dashboard Goals Tab', 'Money', 'Planned Needs', 'Home Care', 'Personal Care'],
    actions: [
      { label: 'Open goals tab', to: '/dashboard?tab=goals' },
    ],
  },
  {
    id: 'personal-care',
    category: 'Life Command Center',
    title: 'Personal Care',
    icon: HeartHandshake,
    summary:
      'Personal care gives users a practical place to track services and routines that make daily life easier.',
    realLife: [
      'A user can plan recurring services like grooming, wellness appointments, cleaning help, childcare support, tutoring, or errands.',
      'Personal care needs can become planned needs or job requests when the user is ready to act.',
      'This matters because OxSteed is not only for emergencies; it can support routines that protect time and energy.',
    ],
    connectedTo: ['Dashboard Personal Care Tab', 'Planned Needs', 'Browse Helpers', 'Calendar'],
    actions: [
      { label: 'Open personal care', to: '/dashboard?tab=personal' },
      { label: 'Find helpers', to: '/helpers' },
    ],
  },
  {
    id: 'tool-rentals',
    category: 'Tools and Products',
    title: 'Tool Rentals',
    icon: Wrench,
    summary:
      'Tool rentals let users rent useful tools locally and let owners earn from equipment they already have.',
    realLife: [
      'A customer can rent a pressure washer, ladder, carpet cleaner, drill, saw, or specialty tool instead of buying it for one weekend.',
      'A helper or homeowner can list tools, require deposits, send invoices, track bookings, and manage availability.',
      'Tool rentals connect to the jobs marketplace because many jobs require equipment, not only labor.',
    ],
    connectedTo: ['Skills & Tools Dashboard', 'Invoices', 'Payment Methods', 'Tool Analytics', 'Messages'],
    actions: [
      { label: 'Browse tools', to: '/tool-rentals' },
      { label: 'List tools', to: '/dashboard?tab=skills' },
      { label: 'Tool analytics', to: '/tool-rentals/analytics' },
    ],
  },
  {
    id: 'products',
    category: 'Tools and Products',
    title: 'Product Marketplace, Carts, and Orders',
    icon: ShoppingBag,
    summary:
      'The product marketplace supports products, shared carts, checkout, inventory, orders, discounts, and order management.',
    realLife: [
      'A helper can sell kits, supplies, replacement parts, digital downloads, or local service add-ons.',
      'A customer can build a cart, share it with another person, check out securely, and track the order.',
      'For businesses, product sales can sit beside service work instead of requiring a separate storefront.',
    ],
    connectedTo: ['Checkout', 'Orders', 'Inventory', 'Discount Codes', 'Invoices', 'Business Dashboard'],
    actions: [
      { label: 'Browse products', to: '/products' },
      { label: 'View orders', to: '/orders' },
    ],
  },
  {
    id: 'payments',
    category: 'Trust and Payments',
    title: 'Payments, Escrow, Invoices, and Payouts',
    icon: CreditCard,
    summary:
      'Payment tools help OxSteed support secure hiring: card payments, invoices, escrow-style job payment states, helper payouts, refunds, and auditability.',
    realLife: [
      'A customer can pay through OxSteed instead of sending money informally before work is done.',
      'A helper can connect payout details and receive money with a record attached to the job or rental.',
      'Invoices give customers and businesses a concrete paper trail for rentals, tools, services, and completed work.',
    ],
    connectedTo: ['Jobs', 'Tool Rentals', 'Orders', 'Disputes', 'Refunds', 'Reputation'],
    actions: [
      { label: 'View invoices', to: '/invoices' },
      { label: 'Escrow policy', to: '/legal/escrow-policy' },
      { label: 'Payment settings', to: '/settings/payment-policies' },
    ],
  },
  {
    id: 'trust',
    category: 'Trust and Safety',
    title: 'Reputation, Reviews, Background Checks, and Disputes',
    icon: ShieldCheck,
    summary:
      'Trust features help users decide who to hire, document what happened, handle problems, and protect the marketplace from abuse.',
    realLife: [
      'A customer can review helper history, profile details, cancellation patterns, and completed work before choosing someone.',
      'If work goes wrong, disputes keep evidence, messages, payments, and job details in one process.',
      'Moderation, reports, background-check policy, and audit logs help OxSteed act like a serious marketplace rather than a bulletin board.',
    ],
    connectedTo: ['Profiles', 'Messages', 'Jobs', 'Payments', 'Disputes', 'Legal Policies', 'Admin Review'],
    actions: [
      { label: 'Open disputes', to: '/disputes' },
      { label: 'Background checks', to: '/legal/background-check' },
      { label: 'Dispute policy', to: '/legal/dispute-resolution' },
    ],
  },
  {
    id: 'helper-business',
    category: 'Business Growth',
    title: 'Helper Profile, Business Profile, Templates, and AI Preview',
    icon: Store,
    summary:
      'OxSteed gives helpers and small businesses a richer public presence: services, gallery, cover image, template design, QR code, AI profile preview, and shareable links.',
    realLife: [
      'A cleaner, stylist, mechanic, handyman, tutor, designer, or consultant can present themselves professionally without building a separate website.',
      'Templates help profiles match the type of business: home services, creative work, care, health, events, beauty, or tech.',
      'AI profile tools help businesses explain what they do clearly and give customers better answers before they book.',
    ],
    connectedTo: ['Browse Helpers', 'Direct Booking', 'QR Codes', 'Messages', 'Business Hub', 'Templates'],
    actions: [
      { label: 'Edit profile', to: '/dashboard/edit-profile' },
      { label: 'Choose template', to: '/templates?type=helper' },
      { label: 'AI preview', to: '/dashboard/ai-preview' },
    ],
  },
  {
    id: 'business-hub',
    category: 'Business Growth',
    title: 'Business Hub and Analytics',
    icon: PackageSearch,
    summary:
      'Business Hub is where helpers and businesses can manage their work, services, products, analytics, moderation status, and operational growth.',
    realLife: [
      'A local service provider can see what is working, manage service offerings, track jobs, and build a repeatable operation.',
      'A business can connect product sales, bookings, profile quality, and customer communication into one workspace.',
      'As OxSteed grows, Business Hub becomes the owner’s command center for reputation, revenue, availability, and customer demand.',
    ],
    connectedTo: ['Helper Dashboard', 'Products', 'Tool Rentals', 'Profile Templates', 'Analytics', 'Messages'],
    actions: [
      { label: 'Open business hub', to: '/business-hub' },
      { label: 'Launch status', to: '/business-launch-status' },
    ],
  },
  {
    id: 'qr',
    category: 'Business Growth',
    title: 'QR Codes and Share Links',
    icon: QrCode,
    summary:
      'QR and share features connect offline relationships back into OxSteed profiles, booking, messaging, and payments.',
    realLife: [
      'A helper can put a QR code on a business card, flyer, truck magnet, counter sign, or invoice.',
      'A customer who meets someone in person can scan and still book or message through OxSteed later.',
      'This keeps trust, scheduling, and payment protections attached even when the lead starts offline.',
    ],
    connectedTo: ['Public Profiles', 'Direct Booking', 'Messages', 'Business Hub'],
    actions: [
      { label: 'Open QR generator', to: '/qr-generator' },
      { label: 'Find helpers', to: '/helpers' },
    ],
  },
  {
    id: 'consulting',
    category: 'Business Growth',
    title: 'Consulting and Business Launch Support',
    icon: Hammer,
    summary:
      'Consulting tools help users move from idea to business: intake, launch planning, portal tracking, feedback, and status updates.',
    realLife: [
      'Someone with a skill can get help packaging it into a service, profile, pricing, and launch plan.',
      'A small business owner can track the work needed to become more professional on OxSteed.',
      'Consulting connects the human guidance layer with the marketplace layer: better profiles, better offers, better customer trust.',
    ],
    connectedTo: ['Business Profiles', 'Templates', 'Business Hub', 'AI Preview', 'Support'],
    actions: [
      { label: 'Start consulting intake', to: '/consulting-intake' },
      { label: 'Open consulting portal', to: '/consulting' },
    ],
  },
  {
    id: 'support',
    category: 'Support',
    title: 'Support, Support Workspace, and Ask AI',
    icon: LifeBuoy,
    summary:
      'Support features help customers, helpers, and internal agents resolve questions without losing context.',
    realLife: [
      'A user can ask for help with a job, booking, payment, dispute, account issue, or marketplace policy.',
      'Support agents can manage availability and conversations through a dedicated workspace.',
      'Ask AI can give faster guidance when configured, while support escalation remains available for sensitive issues.',
    ],
    connectedTo: ['Messages', 'Disputes', 'Legal Policies', 'Notifications', 'Admin Tools'],
    actions: [
      { label: 'Contact support', to: '/support/escalation' },
      { label: 'Support workspace', to: '/support/agent' },
    ],
  },
  {
    id: 'security-settings',
    category: 'Account',
    title: 'Settings, Security, Notifications, and Mobile',
    icon: MapPin,
    summary:
      'Account settings keep the user in control of profile data, notification preferences, two-factor authentication, identity verification, cookies, and mobile push registration.',
    realLife: [
      'A user can enable two-factor authentication, verify email, manage notification preferences, and control cookie consent.',
      'Mobile push notifications can alert users when bids, messages, bookings, and important account events need attention.',
      'Security and notification settings are the quiet layer that makes every other feature safer and more responsive.',
    ],
    connectedTo: ['Dashboard', 'Messages', 'Bookings', 'Security Policies', 'Mobile App', 'Support'],
    actions: [
      { label: 'Open settings', to: '/settings' },
      { label: 'Two-factor setup', to: '/settings/2fa' },
      { label: 'Security page', to: '/security' },
    ],
  },
];

function normalize(value) {
  return String(value || '').toLowerCase();
}

function sectionText(section) {
  return normalize([
    section.category,
    section.title,
    section.summary,
    ...(section.realLife || []),
    ...(section.connectedTo || []),
  ].join(' '));
}

function translatedArray(t, key, fallback) {
  const value = t(key, { returnObjects: true, defaultValue: fallback });
  return Array.isArray(value) ? value : fallback;
}

function getTranslatedFeatureSections(t) {
  return FEATURE_SECTIONS.map((section) => ({
    ...section,
    category: t(`howOxsteedWorks.features.${section.id}.category`, { defaultValue: section.category }),
    title: t(`howOxsteedWorks.features.${section.id}.title`, { defaultValue: section.title }),
    summary: t(`howOxsteedWorks.features.${section.id}.summary`, { defaultValue: section.summary }),
    realLife: translatedArray(
      t,
      `howOxsteedWorks.features.${section.id}.realLife`,
      section.realLife
    ),
    connectedTo: translatedArray(
      t,
      `howOxsteedWorks.features.${section.id}.connectedTo`,
      section.connectedTo
    ),
    actions: section.actions.map((action, index) => ({
      ...action,
      label: t(`howOxsteedWorks.features.${section.id}.actions.${index}`, {
        defaultValue: action.label,
      }),
    })),
  }));
}

export default function FeatureGuidePage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(FEATURE_SECTIONS[0].id);
  const normalizedQuery = normalize(query).trim();
  const userPaths = useMemo(() => getUserPaths(t), [t]);
  const featureSections = useMemo(() => getTranslatedFeatureSections(t), [t]);

  const visibleSections = useMemo(() => {
    if (!normalizedQuery) return featureSections;
    return featureSections.filter((section) => sectionText(section).includes(normalizedQuery));
  }, [featureSections, normalizedQuery]);

  const categories = useMemo(
    () => Array.from(new Set(featureSections.map((section) => section.category))),
    [featureSections]
  );

  return (
    <PageShell>
      <PageMeta
        title={t('howOxsteedWorks.metaTitle')}
        description={t('howOxsteedWorks.metaDescription')}
      />
      <div className="feature-guide-page">
        <header className="feature-guide-hero">
          <div className="feature-guide-hero-inner">
            <p className="feature-guide-kicker">{t('howOxsteedWorks.kicker')}</p>
            <h1>{t('howOxsteedWorks.title')}</h1>
            <p>
              {t('howOxsteedWorks.subtitle')}
            </p>
            <div className="feature-guide-hero-actions">
              <Link to="/post-job">{t('howOxsteedWorks.heroActions.postJob')}</Link>
              <Link to="/helpers">{t('howOxsteedWorks.heroActions.findHelpers')}</Link>
              <Link to="#feature-library">{t('howOxsteedWorks.heroActions.exploreFeatures')}</Link>
            </div>
          </div>
        </header>

        <div className="feature-guide-layout">
          <aside className="feature-guide-sidebar" aria-label={t('howOxsteedWorks.sidebarAria')}>
            <div className="feature-guide-search">
              <Search size={18} aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('howOxsteedWorks.searchPlaceholder')}
                aria-label={t('howOxsteedWorks.searchAria')}
              />
            </div>

            <div className="feature-guide-toc">
              <p>{t('howOxsteedWorks.contents')}</p>
              {featureSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className={activeId === section.id ? 'active' : ''}
                  onClick={() => setActiveId(section.id)}
                >
                  <span>{section.title}</span>
                  <small>{section.category}</small>
                </a>
              ))}
            </div>
          </aside>

          <main className="feature-guide-content">
            <section className="feature-guide-paths" aria-label={t('howOxsteedWorks.pathsAria')}>
              {userPaths.map((path) => (
                <article key={path.label} className="feature-guide-path-card">
                  <p>{path.label}</p>
                  <h2>{path.title}</h2>
                  <ol>
                    {path.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <Link to={path.cta.to}>{path.cta.label}</Link>
                </article>
              ))}
            </section>

            <section className="feature-guide-overview" aria-label={t('howOxsteedWorks.mentalModel.aria')}>
              <div>
                <h2>{t('howOxsteedWorks.mentalModel.title')}</h2>
                <p>
                  {t('howOxsteedWorks.mentalModel.body')}
                </p>
              </div>
              <div className="feature-guide-flow" aria-label={t('howOxsteedWorks.mentalModel.flowAria')}>
                {t('howOxsteedWorks.mentalModel.flow', { returnObjects: true }).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </section>

            <section className="feature-guide-real-life" aria-label={t('howOxsteedWorks.examples.aria')}>
              <div>
                <h2>{t('howOxsteedWorks.examples.title')}</h2>
                <p>{t('howOxsteedWorks.examples.body')}</p>
              </div>
              <div className="feature-guide-examples">
                {t('howOxsteedWorks.examples.items', { returnObjects: true }).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </section>

            <div className="feature-guide-category-row" aria-label={t('howOxsteedWorks.categoriesAria')}>
              {categories.map((category) => (
                <a key={category} href={`#${featureSections.find((s) => s.category === category)?.id}`}>
                  {category}
                </a>
              ))}
            </div>

            <div id="feature-library" className="feature-guide-library-heading">
              <p>{t('howOxsteedWorks.library.kicker')}</p>
              <h2>{t('howOxsteedWorks.library.title')}</h2>
            </div>

            {normalizedQuery && (
              <p className="feature-guide-results">
                {t('howOxsteedWorks.searchResults', { shown: visibleSections.length, total: featureSections.length, query })}
              </p>
            )}

            {visibleSections.length === 0 ? (
              <div className="feature-guide-empty">
                <h2>{t('howOxsteedWorks.empty.title')}</h2>
                <p>{t('howOxsteedWorks.empty.body')}</p>
              </div>
            ) : (
              visibleSections.map((section) => {
                const Icon = section.icon;
                return (
                  <section
                    key={section.id}
                    id={section.id}
                    className="feature-guide-section"
                    onMouseEnter={() => setActiveId(section.id)}
                  >
                    <div className="feature-guide-section-header">
                      <div className="feature-guide-icon">
                        <Icon size={24} aria-hidden />
                      </div>
                      <div>
                        <p>{section.category}</p>
                        <h2>{section.title}</h2>
                      </div>
                    </div>

                    <p className="feature-guide-summary">{section.summary}</p>

                    <div className="feature-guide-detail-grid">
                      <div>
                        <h3>{t('howOxsteedWorks.detail.realLifeTitle')}</h3>
                        <ul>
                          {section.realLife.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3>{t('howOxsteedWorks.detail.connectsTitle')}</h3>
                        <div className="feature-guide-tags">
                          {section.connectedTo.map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                        </div>
                        <h3 className="feature-guide-actions-title">{t('howOxsteedWorks.detail.actionsTitle')}</h3>
                        <div className="feature-guide-actions">
                          {section.actions.map((action) => (
                            <Link key={`${section.id}-${action.to}-${action.label}`} to={action.to}>
                              {action.label}
                            </Link>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })
            )}
          </main>
        </div>
      </div>
    </PageShell>
  );
}

