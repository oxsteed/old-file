import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Award,
  BarChart3,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code,
  Copy,
  DollarSign,
  ExternalLink,
  Filter,
  Flame,
  Gift,
  Globe,
  Heart,
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  Mail,
  MapPin,
  Megaphone,
  MessageSquare,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Star,
  Tag,
  Target,
  ThumbsUp,
  TrendingUp,
  Wand2,
  Wrench,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { listBusinesses } from '../api/businesses';
import { getHelperProfileQrPngUrl } from '../api/helpers';
import '../styles/PromotePage.css';

const HELPER_ROLES = new Set(['helper', 'helper_pro', 'broker']);

const LS_TRACKED_CLICKS = 'oxs:promote:trackedClicks';
const LS_SAVED_COPIES = 'oxs:promote:savedCopies';
const LS_SEO_CHECKS = 'oxs:promote:seoChecks';
const LS_REFERRAL_OFFER = 'oxs:promote:referralOffer';

/* ---------------------------------------------------------------------------
 * Utilities
 * ------------------------------------------------------------------------- */

const copyToClipboard = async (value, label = 'Copied') => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label);
  } catch {
    toast.error('Copy failed. Select the text and copy it manually.');
  }
};

function getSiteOrigin() {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://oxsteed.com';
}

function compactList(items, fallback) {
  const clean = items.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (clean.length === 0) return fallback;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode - ignore */
  }
}

function buildTrackedUrl(baseUrl, { source, medium, campaign, content }) {
  try {
    const u = new URL(baseUrl);
    if (source) u.searchParams.set('utm_source', source);
    if (medium) u.searchParams.set('utm_medium', medium);
    if (campaign) u.searchParams.set('utm_campaign', campaign);
    if (content) u.searchParams.set('utm_content', content);
    u.searchParams.set('ref', 'growth_center');
    return u.toString();
  } catch {
    return baseUrl;
  }
}

function bumpCounter(key, channel) {
  const all = readJson(LS_TRACKED_CLICKS, {});
  const slot = all[key] || {};
  slot[channel] = (slot[channel] || 0) + 1;
  slot._total = Object.entries(slot).reduce((acc, [k, v]) => (k === '_total' ? acc : acc + v), 0);
  all[key] = slot;
  writeJson(LS_TRACKED_CLICKS, all);
  return all;
}

function formatRelativeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/* ---------------------------------------------------------------------------
 * Copy generators (multi-angle x multi-channel)
 * ------------------------------------------------------------------------- */

const ANGLES = [
  { id: 'intro', label: 'Friendly intro', icon: Heart, desc: 'Warm, neighborly opener.' },
  { id: 'urgency', label: 'Open this week', icon: Clock, desc: 'Last-minute booking nudge.' },
  { id: 'proof', label: 'Trusted locally', icon: ThumbsUp, desc: 'Lean on reviews and history.' },
  { id: 'value', label: 'Clear pricing', icon: DollarSign, desc: 'Transparent and easy to book.' },
  { id: 'problem', label: 'Problem solver', icon: Wrench, desc: 'Lead with the pain you fix.' },
  { id: 'seasonal', label: 'Right-now season', icon: Sparkles, desc: 'Tie offer to the season.' },
];

const CHANNELS = [
  { id: 'facebook', label: 'Facebook post', icon: Share2, maxChars: 600 },
  { id: 'instagram', label: 'Instagram caption', icon: ImageIcon, maxChars: 2200 },
  { id: 'nextdoor', label: 'Nextdoor neighbor post', icon: MapPin, maxChars: 1000 },
  { id: 'sms', label: 'Text message', icon: MessageSquare, maxChars: 320 },
  { id: 'email', label: 'Email', icon: Mail, maxChars: 1500 },
  { id: 'linkedin', label: 'LinkedIn post', icon: Briefcase, maxChars: 1300 },
];

const HASHTAG_POOL = {
  default: ['#LocalServices', '#SmallBusiness', '#NeighborhoodHelp', '#OxSteed', '#SupportLocal'],
  cleaning: ['#HomeCleaning', '#DeepClean', '#MoveOutClean'],
  landscaping: ['#LawnCare', '#YardWork', '#Landscaping', '#CurbAppeal'],
  handyman: ['#Handyman', '#HomeRepair', '#HonestyDoes'],
  plumbing: ['#Plumber', '#PlumbingHelp'],
  electrical: ['#Electrician', '#SafeWiring'],
  hvac: ['#HVAC', '#TuneUp'],
  moving: ['#Movers', '#MovingDay'],
  pets: ['#PetSitter', '#DogWalker'],
};

function pickHashtags(serviceText) {
  const s = (serviceText || '').toLowerCase();
  const tags = new Set(HASHTAG_POOL.default);
  for (const [k, list] of Object.entries(HASHTAG_POOL)) {
    if (k === 'default') continue;
    if (s.includes(k)) list.forEach((t) => tags.add(t));
  }
  return Array.from(tags).slice(0, 7).join(' ');
}

function buildAngleCopy(angle, channel, target, tone) {
  const { providerName, serviceText, locationText, profileUrl, bookingUrl, availabilityText } = target;
  const where = locationText ? (channel === 'nextdoor' ? `right here in ${locationText}` : `around ${locationText}`) : '';
  const greet = tone === 'direct' ? '' : channel === 'nextdoor' ? 'Hi neighbors,' : 'Hey there,';

  let body = '';
  switch (angle) {
    case 'urgency':
      body = `${greet} ${providerName} has a few openings ${where ? where + ' ' : ''}this week for ${serviceText}. ${availabilityText}. If you have been putting it off, this is the easy week to get it done.`;
      break;
    case 'proof':
      body = `${greet} I am ${providerName}, a local helper on OxSteed offering ${serviceText} ${where}. Reviewed and rated by neighbors who have hired me. You can read every review before you decide.`;
      break;
    case 'value':
      body = `${greet} Clear pricing, real availability, no guesswork. ${providerName} offers ${serviceText} ${where}. Pick a time, message me first if you want, and pay securely after the work is approved.`;
      break;
    case 'problem':
      body = `${greet} If something at home needs ${serviceText}, do not let it wait. ${providerName} handles it ${where} - quickly, cleanly, and on a schedule that works for you.`;
      break;
    case 'seasonal':
      body = `${greet} The season is changing fast. ${providerName} is booking ${serviceText} ${where} now so you stay ahead of the rush. Easier to schedule today than next month.`;
      break;
    case 'intro':
    default:
      body = `${greet} I am ${providerName}. I help neighbors with ${serviceText} ${where}. Honest work, easy to message, and you can compare options on my OxSteed page before you book.`;
      break;
  }

  const cta = (() => {
    switch (channel) {
      case 'sms':
        return `Book or message me: ${bookingUrl}`;
      case 'email':
        return `Reply to this email or book directly here: ${bookingUrl}`;
      case 'nextdoor':
        return `My profile, reviews, and booking: ${profileUrl}`;
      case 'linkedin':
        return `Profile and direct booking: ${profileUrl}`;
      default:
        return `See services, reviews, and book: ${profileUrl}`;
    }
  })();

  let composed = `${body} ${cta}`.replace(/\s+/g, ' ').trim();
  if (channel === 'sms') {
    composed = composed.length > 300 ? composed.slice(0, 297) + '...' : composed;
  }
  if (channel === 'email') {
    composed = `Subject: ${providerName} - ${serviceText.split(',')[0]}\n\n${body}\n\n${cta}\n\nThanks,\n${providerName}`;
  }
  if (channel === 'instagram' || channel === 'facebook') {
    composed = `${composed}\n\n${pickHashtags(serviceText)}`;
  }
  return composed;
}

/* ---------------------------------------------------------------------------
 * Seasonal campaign library
 * ------------------------------------------------------------------------- */

const SEASONAL_CAMPAIGNS = [
  // Winter (Jan-Feb, Dec)
  { id: 'new_year_decluttering', months: [1], emoji: '🧹', title: 'New Year Decluttering Sprint', tag: 'Cleaning', hook: 'Help neighbors reset their homes in the first 2 weeks of January.', body: 'Most people promise themselves a clean slate in January. Promote one decluttering package, with a flat price and a same-week slot. Show a quick before/after photo if you have one.' },
  { id: 'tax_season_orgnize', months: [2, 3], emoji: '📂', title: 'Tax-Season Home Organizing', tag: 'Organizing', hook: 'Customers want paperwork tamed before April.', body: 'Bundle 2-3 hours of paperwork sorting plus a labeled accordion file. Promote to home offices and small business owners on Nextdoor.' },
  { id: 'valentines_clean', months: [2], emoji: '💐', title: 'Valentine\'s Weekend Refresh', tag: 'Cleaning', hook: 'A spotless home for hosting or surprise dinners.', body: 'Offer a 2-hour blitz cleaning the day before Valentine\'s. Show that you protect candles, flowers, and surprise setups.' },
  // Spring (Mar-May)
  { id: 'spring_cleanup', months: [3, 4, 5], emoji: '🌱', title: 'Spring Yard Cleanup', tag: 'Outdoor', hook: 'The single biggest local-services season of the year.', body: 'Promote a one-visit yard reset: leaves, branches, mulch refresh, edging, first mow. Show a price band rather than a single price - this earns clicks.' },
  { id: 'spring_deep_clean', months: [3, 4], emoji: '🪟', title: 'Spring Deep Clean', tag: 'Cleaning', hook: 'Windows, baseboards, fans, and forgotten corners.', body: 'Sell a deep-clean against the regular clean - itemize what is included so customers know they are getting more than the standard visit.' },
  { id: 'mothers_day_prep', months: [5], emoji: '🌷', title: 'Mother\'s Day Hosting Prep', tag: 'Cleaning', hook: 'Last-minute hosting help the week of.', body: 'Offer a Friday or Saturday slot in the week of Mother\'s Day. People will pay for the convenience of arriving family seeing a tidy home.' },
  { id: 'gutter_spring', months: [3, 4], emoji: '🪜', title: 'Gutter Clear + Inspection', tag: 'Handyman', hook: 'After winter, gutters are full and damaged.', body: 'A flat-rate gutter clear with a quick photo report. Customers love seeing proof of what you found. Great upsell into minor repairs.' },
  { id: 'hvac_tuneup_spring', months: [4, 5], emoji: '❄️', title: 'AC Tune-Up Before Summer', tag: 'HVAC', hook: 'Easier to book a tune-up now than an emergency call in July.', body: 'Push a $89-$129 pre-summer AC tune-up. Promise an itemized report. This earns repeat customers who call you for the real summer break-down.' },
  // Summer (Jun-Aug)
  { id: 'pool_open', months: [5, 6], emoji: '🏊', title: 'Pool Opening Week', tag: 'Pools', hook: 'A short window where everyone wants the same Saturday.', body: 'Lock down your weekend calendar with a pool opening package: clean, balance, equipment check.' },
  { id: 'lawn_program', months: [5, 6, 7], emoji: '🌿', title: 'Summer Lawn Subscription', tag: 'Outdoor', hook: 'Turn one-off mows into recurring revenue.', body: 'Promote a 12-visit summer lawn plan billed in 3 installments. Show the per-visit price - it almost always looks like a win against the one-off rate.' },
  { id: 'pressure_wash', months: [5, 6, 7], emoji: '💦', title: 'Driveway + Deck Pressure Wash', tag: 'Outdoor', hook: 'High-contrast before/after photos are everything here.', body: 'Show a side-by-side photo. People scroll past pressure-washing posts unless the contrast is obvious. Bundle the drive and walkway for a small uplift.' },
  { id: 'moving_help', months: [5, 6, 7, 8], emoji: '📦', title: 'Local Move + Heavy-Lift Help', tag: 'Moving', hook: 'June through August is peak moving season.', body: 'Promote a 2-helper, 3-hour minimum package. Be very clear about what you do not do (out-of-state, mattresses, etc.) - it reduces bad-fit messages.' },
  { id: 'back_to_school_org', months: [7, 8], emoji: '🎒', title: 'Back-to-School Home Reset', tag: 'Organizing', hook: 'Parents want the chaos under control before week one.', body: 'Promote a "drop zone" install: hooks, bins, calendar wall. Easy to photograph for social.' },
  // Fall (Sep-Nov)
  { id: 'fall_cleanup', months: [9, 10, 11], emoji: '🍂', title: 'Fall Yard Cleanup', tag: 'Outdoor', hook: 'Leaves and pre-winter prep.', body: 'Bundle leaf removal, gutter clean, hose disconnect, and a quick weatherproofing pass. Push it as a single fall visit.' },
  { id: 'heating_tuneup', months: [9, 10], emoji: '🔥', title: 'Heating Tune-Up Before Winter', tag: 'HVAC', hook: 'Same play as AC, in reverse season.', body: 'Schedule the first cold weekend a customer will need it. Make the call now, before everyone else.' },
  { id: 'holiday_lights_install', months: [10, 11], emoji: '🎄', title: 'Holiday Light Install', tag: 'Seasonal', hook: 'Books up fast - 4-6 week lead time.', body: 'Lock in November weekends now. Offer storage/teardown in January as part of the package - it is the easiest upsell.' },
  { id: 'thanksgiving_clean', months: [10, 11], emoji: '🦃', title: 'Pre-Thanksgiving Deep Clean', tag: 'Cleaning', hook: 'Week-of slots disappear fast.', body: 'Sell the Monday-Wednesday before Thanksgiving as premium slots. People pay to host without the stress.' },
  { id: 'winter_prep', months: [10, 11], emoji: '🧊', title: 'Winterizing the House', tag: 'Handyman', hook: 'Pipe insulation, weather stripping, smoke alarm checks.', body: 'A 2-3 hour visit, flat rate. Bundle 4-5 small tasks customers know they should do but never get to.' },
  { id: 'holiday_hosting', months: [11, 12], emoji: '🎁', title: 'Holiday Hosting Help', tag: 'Cleaning', hook: 'Cleaning + reset + tear-down in one bundle.', body: 'Pitch a 3-visit package: before the party, after the party, and a January reset. Three bookings out of one conversation.' },
  { id: 'snow_emergency', months: [11, 12, 1, 2], emoji: '❄️', title: 'On-Call Snow + Salt', tag: 'Outdoor', hook: 'Pre-sell so phones ring less.', body: 'Sell a seasonal contract: X visits at a fixed rate, plus per-visit overage. Subscribers are calmer customers.' },
  // Evergreen
  { id: 'past_customer_re_engage', months: [1,2,3,4,5,6,7,8,9,10,11,12], emoji: '🤝', title: 'Past-Customer Re-Engagement', tag: 'Evergreen', hook: 'Cheapest customer is the one you already worked for.', body: 'Reach out to the last 25 customers with one warm note. Mention the season, the work you did last time, and one easy ask.' },
  { id: 'new_neighbor_welcome', months: [1,2,3,4,5,6,7,8,9,10,11,12], emoji: '🏡', title: 'New-Neighbor Welcome Service', tag: 'Evergreen', hook: 'Hyper-local, low-volume, high-loyalty.', body: 'Drop a small welcome card to homes that just sold. List 3 things you fix or clean for new owners. The lifetime value is huge.' },
  { id: 'workplace_referral', months: [1,2,3,4,5,6,7,8,9,10,11,12], emoji: '🏢', title: 'Workplace Partner Referral', tag: 'Evergreen', hook: 'One office can supply months of bookings.', body: 'Pitch a property manager, dentist, or coworking space: their tenants/customers get a small discount, you get steady referrals.' },
  { id: 'birthday_offer', months: [1,2,3,4,5,6,7,8,9,10,11,12], emoji: '🎂', title: 'Customer-Birthday Offer', tag: 'Evergreen', hook: 'Memorable, personal, and rarely matched.', body: 'Send a one-line note on a past customer\'s birthday. Free 15-minute add-on, no expectations. It works.' },
];

/* ---------------------------------------------------------------------------
 * Toolkit constants
 * ------------------------------------------------------------------------- */

const SEO_QUICK_WINS = [
  { id: 'google_business', title: 'Claim or update Google Business Profile', minutes: 15, impact: 'High', url: 'https://business.google.com/create', detail: 'Add hours, photos, services, and link your OxSteed profile in the description.' },
  { id: 'nextdoor', title: 'Verify Nextdoor business listing', minutes: 10, impact: 'High', url: 'https://nextdoor.com/business/', detail: 'Most local-services customers under 50 start here. Reply to every neighborhood thread.' },
  { id: 'yelp', title: 'Claim your Yelp page', minutes: 10, impact: 'Medium', url: 'https://biz.yelp.com', detail: 'Even if you do not love Yelp, claiming stops competitors from showing up on your page.' },
  { id: 'bbb', title: 'Set up Better Business Bureau profile', minutes: 25, impact: 'Medium', url: 'https://www.bbb.org/get-listed', detail: 'Older customers and insurance-conscious buyers check BBB before booking.' },
  { id: 'facebook_business', title: 'Set up a Facebook Business Page', minutes: 20, impact: 'High', url: 'https://www.facebook.com/business/pages', detail: 'Post your OxSteed booking link in the page CTA button.' },
  { id: 'instagram_pro', title: 'Convert Instagram to a Professional account', minutes: 5, impact: 'Medium', url: 'https://help.instagram.com', detail: 'Unlocks insights, contact buttons, and the "book" link sticker for stories.' },
  { id: 'angi', title: 'List on Angi (formerly Angie\'s List)', minutes: 30, impact: 'Medium', url: 'https://www.angi.com/promote', detail: 'Older homeowner audience. Worth the listing even without paying for leads.' },
  { id: 'oxsteed_complete', title: 'Hit 100% on the OxSteed profile readiness score', minutes: 30, impact: 'High', url: '/dashboard?tab=editprofile', detail: 'Photos, services, availability, pricing range, headline. The score below this section tells you what is missing.' },
];

const REVIEW_PLATFORMS = [
  { id: 'oxsteed', name: 'OxSteed review', placeholder: 'You can leave a review on my OxSteed page in 30 seconds.' },
  { id: 'google', name: 'Google review', placeholder: 'A Google review would mean a lot - it is the one neighbors trust most.' },
  { id: 'nextdoor', name: 'Nextdoor recommendation', placeholder: 'A quick Nextdoor recommendation helps me reach more neighbors right here in our area.' },
  { id: 'facebook', name: 'Facebook recommendation', placeholder: 'If you have a minute, a Facebook recommendation makes a huge difference for a small business like mine.' },
];

/* ---------------------------------------------------------------------------
 * Small presentational helpers
 * ------------------------------------------------------------------------- */

function ReadinessRow({ done, children }) {
  return (
    <li className={done ? 'promote-ready-row done' : 'promote-ready-row'}>
      <CheckCircle2 size={16} />
      <span>{children}</span>
    </li>
  );
}

function CopyBlock({ title, icon: Icon, value, onCopy }) {
  return (
    <div className="promote-copy-block">
      <div className="promote-copy-head">
        <div>
          <Icon size={17} />
          <span>{title}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            copyToClipboard(value, `${title} copied`);
            if (onCopy) onCopy();
          }}
        >
          <Copy size={15} />
          Copy
        </button>
      </div>
      <textarea readOnly value={value} />
    </div>
  );
}

function PrintableCard({ target, qrSrc, variant }) {
  const { t } = useTranslation();
  const isBusinessCard = variant === 'businessCards';
  const title = variant === 'qrCard'
    ? t('promotePage.print.scanTitle', { defaultValue: 'Scan to book or message me' })
    : target.providerName;
  return (
    <article className={isBusinessCard ? 'print-business-card' : `print-template print-${variant}`}>
      <div className="print-brand">OxSteed</div>
      <div className="print-main">
        <div>
          <p className="print-kicker">{target.locationText || t('promotePage.print.localServices', { defaultValue: 'Local services' })}</p>
          <h2>{title}</h2>
          <p>{target.serviceText}</p>
          <strong>{target.availabilityText || t('promotePage.print.availableThisWeek', { defaultValue: 'Available this week' })}</strong>
        </div>
        {qrSrc && <img src={qrSrc} alt="" />}
      </div>
      <div className="print-url">{target.bookingUrl}</div>
      <div className="print-footer">{t('promotePage.print.footer', { defaultValue: 'View services, availability, messages, and secure booking on OxSteed.' })}</div>
    </article>
  );
}

function PrintStudio({ target, qrSrc, printLayout, setPrintLayout, onPrint }) {
  const { t } = useTranslation();
  const enrichedTarget = {
    ...target,
    availabilityText: target.availabilityText || t('promotePage.print.availableThisWeek', { defaultValue: 'Available this week' }),
  };

  const businessCards = Array.from({ length: 10 }, (_, i) => (
    <PrintableCard key={i} target={enrichedTarget} qrSrc={qrSrc} variant="businessCards" />
  ));

  return (
    <section className="promote-print-studio">
      <div className="promote-print-header">
        <div>
          <span className="promote-kicker"><Printer size={18} /> {t('promotePage.print.title', { defaultValue: 'Print Studio' })}</span>
          <h2>{t('promotePage.print.heading', { defaultValue: 'Ready-to-print marketing materials' })}</h2>
          <p>{t('promotePage.print.body', { defaultValue: 'Print a flyer, QR handout, or business-card sheet. Use the browser print dialog to print directly or save as a PDF.' })}</p>
        </div>
        <button type="button" className="promote-btn primary" onClick={onPrint}>
          <Printer size={16} />
          {t('promotePage.print.printOrSave', { defaultValue: 'Print or save PDF' })}
        </button>
      </div>

      <div className="promote-print-layouts" role="tablist" aria-label={t('promotePage.print.layoutLabel', { defaultValue: 'Print layout' })}>
        {[
          ['flyer', t('promotePage.print.layouts.flyer', { defaultValue: 'Flyer' }), t('promotePage.print.layouts.flyerDesc', { defaultValue: 'A full-page poster for counters, bulletin boards, and community spaces.' })],
          ['qrCard', t('promotePage.print.layouts.qrCard', { defaultValue: 'QR handout' }), t('promotePage.print.layouts.qrCardDesc', { defaultValue: 'A compact scan card for quick in-person referrals.' })],
          ['businessCards', t('promotePage.print.layouts.businessCards', { defaultValue: 'Business cards' }), t('promotePage.print.layouts.businessCardsDesc', { defaultValue: 'Ten cards per page for repeat local promotion.' })],
        ].map(([id, label, description]) => (
          <button
            key={id}
            type="button"
            className={printLayout === id ? 'active' : ''}
            onClick={() => setPrintLayout(id)}
          >
            <strong>{label}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>

      <div className="promote-print-preview" aria-label="Print preview">
        {printLayout === 'businessCards' ? (
          <div className="print-sheet print-business-card-sheet">{businessCards}</div>
        ) : (
          <div className={`print-sheet print-${printLayout}-sheet`}>
            <PrintableCard target={enrichedTarget} qrSrc={qrSrc} variant={printLayout} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Studio Tab - quick promote + multi-angle generator
 * ------------------------------------------------------------------------- */

function StudioTab({
  target,
  qrSrc,
  loading,
  readinessScore,
  helperReadiness,
  targetType,
  setTargetType,
  businesses,
  selectedBusinessId,
  setSelectedBusinessId,
  availabilityText,
  setAvailabilityText,
  tone,
  setTone,
  printLayout,
  setPrintLayout,
  onPrint,
  onTrackedClick,
}) {
  const { t } = useTranslation();
  const [angle, setAngle] = useState('intro');
  const [channel, setChannel] = useState('facebook');

  const generated = useMemo(
    () => buildAngleCopy(angle, channel, target, tone),
    [angle, channel, target, tone]
  );

  const trackedShareUrl = useMemo(() => buildTrackedUrl(target.profileUrl, {
    source: channel, medium: 'organic', campaign: 'studio', content: angle,
  }), [angle, channel, target.profileUrl]);

  return (
    <>
      <section className="promote-grid">
        <div className="promote-panel promote-selector">
          <div className="promote-panel-title">
            <Sparkles size={18} />
            <h2>{t('promotePage.studio.choose', { defaultValue: 'Choose what you want to promote' })}</h2>
          </div>
          <div className="promote-segmented" role="tablist" aria-label={t('promotePage.studio.targetLabel', { defaultValue: 'Promotion target' })}>
            <button className={targetType === 'helper' ? 'active' : ''} onClick={() => setTargetType('helper')} type="button">{t('promotePage.studio.helperProfile', { defaultValue: 'Helper profile' })}</button>
            <button className={targetType === 'business' ? 'active' : ''} onClick={() => setTargetType('business')} disabled={businesses.length === 0} type="button">{t('promotePage.studio.businessPage', { defaultValue: 'Business page' })}</button>
          </div>
          {targetType === 'business' && (
            <label className="promote-field">
              <span>{t('promotePage.studio.business', { defaultValue: 'Business' })}</span>
              <select value={selectedBusinessId} onChange={(e) => setSelectedBusinessId(e.target.value)}>
                {businesses.map((biz) => (
                  <option key={biz.id} value={biz.id}>{biz.business_name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="promote-field">
            <span>{t('promotePage.studio.availabilityPhrase', { defaultValue: 'Availability phrase' })}</span>
            <input value={availabilityText} onChange={(e) => setAvailabilityText(e.target.value)} placeholder={t('promotePage.print.availableThisWeek', { defaultValue: 'Available this week' })} />
          </label>
          <label className="promote-field">
            <span>{t('promotePage.studio.tone', { defaultValue: 'Tone' })}</span>
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="friendly">{t('promotePage.studio.friendlyTone', { defaultValue: 'Friendly neighbor' })}</option>
              <option value="direct">{t('promotePage.studio.directTone', { defaultValue: 'Direct and professional' })}</option>
            </select>
          </label>
        </div>

        <div className="promote-panel promote-qr-card">
          <div className="promote-panel-title">
            <QrCode size={18} />
            <h2>{t('promotePage.studio.qrTitle', { defaultValue: 'Booking link and QR' })}</h2>
          </div>
          {loading ? (
            <div className="promote-skeleton">{t('promotePage.studio.loadingAssets', { defaultValue: 'Loading profile assets...' })}</div>
          ) : (
            <>
              {qrSrc && <img src={qrSrc} alt="Profile QR code" />}
              <div className="promote-link-row">
                <span>{target.profileUrl}</span>
                <button type="button" onClick={() => { copyToClipboard(target.profileUrl, 'Profile link copied'); onTrackedClick('profile_link', 'copy'); }} aria-label="Copy profile link">
                  <Copy size={15} />
                </button>
              </div>
              <div className="promote-card-actions">
                <a href={target.profilePath} target="_blank" rel="noopener noreferrer" className="promote-btn secondary" onClick={() => onTrackedClick('profile_link', 'open')}>
                  {t('promotePage.studio.viewPublicPage', { defaultValue: 'View public page' })} <ExternalLink size={14} />
                </a>
                <button type="button" className="promote-btn primary" onClick={() => { copyToClipboard(target.bookingUrl, 'Booking link copied'); onTrackedClick('booking_link', 'copy'); }}>
                  {t('promotePage.studio.copyBookingLink', { defaultValue: 'Copy booking link' })}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="promote-panel promote-ready">
          <div className="promote-panel-title">
            <Star size={18} />
            <h2>{t('promotePage.studio.readyToPromote', { defaultValue: 'Ready to promote' })}</h2>
          </div>
          <div className="promote-score">
            <strong>{readinessScore}%</strong>
            <span>{t('promotePage.studio.profileReadiness', { defaultValue: 'profile readiness' })}</span>
          </div>
          <div className="promote-ready-meter" aria-hidden="true">
            <div className="promote-ready-meter-fill" style={{ width: `${readinessScore}%` }} />
          </div>
          <ul>
            {helperReadiness.map((item) => (
              <ReadinessRow key={item.label} done={item.done}>{item.label}</ReadinessRow>
            ))}
          </ul>
        </div>
      </section>

      <section className="promote-section promote-studio-section">
          <div className="promote-section-head">
          <div>
            <span className="promote-kicker"><Wand2 size={18} /> {t('promotePage.studio.contentStudio', { defaultValue: 'Content Studio' })}</span>
            <h2>{t('promotePage.studio.sixAngles', { defaultValue: 'Six angles. Six channels. One profile.' })}</h2>
            <p>{t('promotePage.studio.description', { defaultValue: 'Pick an angle and a channel - OxSteed assembles a post tuned to that audience, complete with channel-specific length, CTA, and hashtags. Regenerate as many variants as you want.' })}</p>
          </div>
          <div className="promote-studio-actions">
            <button
              type="button"
              className="promote-btn secondary"
              onClick={() => {
                const idx = ANGLES.findIndex((a) => a.id === angle);
                setAngle(ANGLES[(idx + 1) % ANGLES.length].id);
              }}
            >
              <RefreshCw size={14} /> Try another angle
            </button>
          </div>
        </div>

        <div className="promote-angle-row">
          {ANGLES.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                className={'promote-angle-pill' + (angle === a.id ? ' active' : '')}
                onClick={() => setAngle(a.id)}
              >
                <Icon size={14} />
                <span>{a.label}</span>
                <em>{a.desc}</em>
              </button>
            );
          })}
        </div>

        <div className="promote-channel-row">
          {CHANNELS.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                type="button"
                className={'promote-channel-pill' + (channel === c.id ? ' active' : '')}
                onClick={() => setChannel(c.id)}
              >
                <Icon size={14} />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>

        <div className="promote-studio-output">
          <div className="promote-studio-textarea-wrap">
            <textarea readOnly value={generated} className="promote-studio-textarea" />
            <div className="promote-studio-meta">
              <span>{generated.length} chars</span>
              <span aria-hidden="true">•</span>
              <span>{t('promotePage.studio.trackedLinkHint', { defaultValue: 'Tracked link auto-added when you copy' })}</span>
            </div>
          </div>
          <div className="promote-studio-side">
            <button
              type="button"
              className="promote-btn primary block"
              onClick={() => { copyToClipboard(generated, 'Copy ready to paste'); onTrackedClick(`studio_${channel}`, angle); }}
            >
              <Copy size={15} /> {t('promotePage.studio.copyThisPost', { defaultValue: 'Copy this post' })}
            </button>
            <button
              type="button"
              className="promote-btn secondary block"
              onClick={() => { copyToClipboard(trackedShareUrl, 'Tracked link copied'); onTrackedClick(`studio_${channel}`, 'link_only'); }}
            >
              <LinkIcon size={15} /> {t('promotePage.studio.copyTrackedLinkOnly', { defaultValue: 'Copy tracked link only' })}
            </button>
            <div className="promote-studio-tips">
              <p><strong>{t('promotePage.studio.bestTime', { defaultValue: 'Best time:' })}</strong> {channel === 'facebook' ? 'Tue/Thu 7-9pm' : channel === 'instagram' ? 'Sat morning, Sun evening' : channel === 'nextdoor' ? 'Weekday lunch hour' : channel === 'sms' ? '10am-12pm or 5-7pm' : channel === 'email' ? 'Tue/Wed 9-11am' : 'Tue/Wed 7-9am'}</p>
              <p><strong>{t('promotePage.studio.image', { defaultValue: 'Image:' })}</strong> {channel === 'instagram' ? 'A real before/after, not a stock photo.' : channel === 'facebook' ? 'A photo of you on the job builds trust.' : channel === 'nextdoor' ? 'A photo of your work area or vehicle helps neighbors recognize you.' : 'Attach a recent photo if your channel allows it.'}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="promote-copy-grid">
        <CopyBlock title={t('promotePage.studio.oneShotSocial', { defaultValue: 'One-shot social post' })} icon={Share2} value={buildAngleCopy('intro', 'facebook', target, tone)} onCopy={() => onTrackedClick('copy_block_social', 'copy')} />
        <CopyBlock title={t('promotePage.studio.oneShotText', { defaultValue: 'One-shot text message' })} icon={MessageSquare} value={buildAngleCopy('intro', 'sms', target, tone)} onCopy={() => onTrackedClick('copy_block_sms', 'copy')} />
      </section>

      <PrintStudio
        target={target}
        qrSrc={qrSrc}
        printLayout={printLayout}
        setPrintLayout={setPrintLayout}
        onPrint={onPrint}
      />
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Campaigns tab - seasonal library
 * ------------------------------------------------------------------------- */

function CampaignsTab({ target, tone, onTrackedClick }) {
  const { t } = useTranslation();
  const currentMonth = new Date().getMonth() + 1;
  const [tagFilter, setTagFilter] = useState('All');
  const tags = useMemo(() => ['All', ...Array.from(new Set(SEASONAL_CAMPAIGNS.map((c) => c.tag)))], []);

  const inSeason = SEASONAL_CAMPAIGNS.filter((c) => c.months.includes(currentMonth) && c.tag !== 'Evergreen');
  const evergreen = SEASONAL_CAMPAIGNS.filter((c) => c.tag === 'Evergreen');
  const upcoming = SEASONAL_CAMPAIGNS.filter((c) => !c.months.includes(currentMonth) && c.tag !== 'Evergreen' && c.months.some((m) => ((m - currentMonth + 12) % 12) <= 2));

  const filtered = (list) => (tagFilter === 'All' ? list : list.filter((c) => c.tag === tagFilter));

  const activateCampaign = (campaign) => {
    const text = `${campaign.title}\n\n${campaign.body}\n\nReady to book this with me? ${target.bookingUrl}`;
    copyToClipboard(text, `${campaign.title} - campaign copied`);
    onTrackedClick(`campaign_${campaign.id}`, 'activate');
  };

  const renderCampaign = (c) => (
    <article key={c.id} className="promote-campaign-card">
      <div className="promote-campaign-head">
        <span className="promote-campaign-emoji" aria-hidden="true">{c.emoji}</span>
        <div>
          <span className="promote-campaign-tag">{c.tag}</span>
          <h3>{c.title}</h3>
        </div>
      </div>
      <p className="promote-campaign-hook">{c.hook}</p>
      <p className="promote-campaign-body">{c.body}</p>
      <div className="promote-campaign-actions">
        <button type="button" className="promote-btn secondary" onClick={() => activateCampaign(c)}>
          <Copy size={14} /> Copy campaign
        </button>
        <button
          type="button"
          className="promote-btn primary"
          onClick={() => {
            const post = buildAngleCopy('seasonal', 'facebook', { ...target, serviceText: c.title.toLowerCase() }, tone);
            copyToClipboard(`${c.emoji} ${c.title}\n\n${post}`, 'Ready-to-post version copied');
            onTrackedClick(`campaign_${c.id}`, 'social_post');
          }}
        >
          <Wand2 size={14} /> Generate post
        </button>
      </div>
    </article>
  );

  return (
    <section className="promote-section">
      <div className="promote-section-head">
        <div>
          <span className="promote-kicker"><CalendarDays size={18} /> {t('promotePage.campaigns.title', { defaultValue: 'Seasonal Campaign Library' })}</span>
          <h2>{t('promotePage.campaigns.heading', { count: SEASONAL_CAMPAIGNS.length, defaultValue: `${SEASONAL_CAMPAIGNS.length} pre-built campaigns, indexed to the calendar.` })}</h2>
          <p>{t('promotePage.campaigns.body', { defaultValue: 'Most local-services money is won by being early to the right season. OxSteed surfaces what is in-season this month and what is two months out so you can book the slots before everyone else.' })}</p>
        </div>
        <div className="promote-filter-row">
          <Filter size={14} />
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="promote-campaign-band">
        <Flame size={16} />
        <strong>In season right now</strong>
          <span>· {filtered(inSeason).length} {t('promotePage.campaigns.activeThisMonth', { defaultValue: 'campaigns active this month' })}</span>
      </div>
      <div className="promote-campaign-grid">
        {filtered(inSeason).length === 0 ? (
          <p className="promote-empty-small">{t('promotePage.campaigns.noMatch', { defaultValue: 'No campaigns match this filter. Try "All".' })}</p>
        ) : filtered(inSeason).map(renderCampaign)}
      </div>

      {filtered(upcoming).length > 0 && (
        <>
          <div className="promote-campaign-band soft">
            <Clock size={16} />
            <strong>{t('promotePage.campaigns.planAhead', { defaultValue: 'Plan ahead (next 60 days)' })}</strong>
            <span>· {t('promotePage.campaigns.lockSlots', { defaultValue: 'book conversations now to lock the slots' })}</span>
          </div>
          <div className="promote-campaign-grid">
            {filtered(upcoming).map(renderCampaign)}
          </div>
        </>
      )}

      <div className="promote-campaign-band soft">
        <Layers size={16} />
        <strong>{t('promotePage.campaigns.evergreen', { defaultValue: 'Evergreen plays' })}</strong>
        <span>· {t('promotePage.campaigns.runAnyMonth', { defaultValue: 'run any month of the year' })}</span>
      </div>
      <div className="promote-campaign-grid">
        {filtered(evergreen).map(renderCampaign)}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Slots tab - smart open-slot promoter
 * ------------------------------------------------------------------------- */

function SlotsTab({ target, tone, onTrackedClick }) {
  const { t } = useTranslation();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [discount, setDiscount] = useState(15);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.get('/calendar/appointments?role=helper')
      .then((res) => {
        if (!mounted) return;
        const list = Array.isArray(res.data) ? res.data : (res.data?.appointments || []);
        setAppointments(list);
      })
      .catch(() => { if (mounted) setAppointments([]); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const busyByDay = useMemo(() => {
    const map = {};
    for (const apt of appointments) {
      const iso = apt?.scheduled_start_at || apt?.scheduled_start_time || apt?.start_time || apt?.scheduled_time;
      if (!iso) continue;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) continue;
      if (['cancelled', 'declined', 'expired'].includes(apt.status)) continue;
      const dayKey = d.toISOString().slice(0, 10);
      map[dayKey] = (map[dayKey] || 0) + 1;
    }
    return map;
  }, [appointments]);

  const next7 = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      days.push({ date: new Date(d), key, busy: busyByDay[key] || 0 });
    }
    return days;
  }, [busyByDay]);

  const openDays = next7.filter((d) => d.busy === 0);
  const lightDays = next7.filter((d) => d.busy > 0 && d.busy < 2);

  const slotCopy = (day) => {
    const friendly = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(day);
    const greet = tone === 'direct' ? '' : 'Heads up neighbors -';
    return `${greet} ${target.providerName} has an open ${friendly} slot for ${target.serviceText}${target.locationText ? ` ${target.locationText}` : ''}. Booking this week earns ${discount}% off. Grab it here: ${target.bookingUrl}`.trim();
  };

  return (
    <section className="promote-section">
      <div className="promote-section-head">
        <div>
          <span className="promote-kicker"><Zap size={18} /> {t('promotePage.slots.title', { defaultValue: 'Smart Slot Filler' })}</span>
          <h2>{t('promotePage.slots.heading', { defaultValue: 'Turn empty calendar days into bookings.' })}</h2>
          <p>{t('promotePage.slots.body', { defaultValue: 'OxSteed scans your next 7 days and highlights the windows where you have no work scheduled. Each open day gets a ready-to-send promo with an optional last-minute discount.' })}</p>
        </div>
        <div className="promote-discount-row">
          <Tag size={14} />
          <label>
            <span>{t('promotePage.slots.discount', { defaultValue: 'Last-minute discount' })}</span>
            <select value={discount} onChange={(e) => setDiscount(Number(e.target.value))}>
              {[0, 5, 10, 15, 20, 25].map((p) => <option key={p} value={p}>{p}%</option>)}
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="promote-skeleton">Scanning your calendar...</div>
      ) : (
        <>
          <div className="promote-slot-summary">
              <div><strong>{openDays.length}</strong><span>{t('promotePage.slots.completelyOpen', { defaultValue: 'completely open day(s)' })}</span></div>
              <div><strong>{lightDays.length}</strong><span>{t('promotePage.slots.lightDays', { defaultValue: 'light day(s) with capacity' })}</span></div>
              <div><strong>{7 - openDays.length - lightDays.length}</strong><span>{t('promotePage.slots.fullyBooked', { defaultValue: 'fully booked' })}</span></div>
          </div>

          {openDays.length === 0 && lightDays.length === 0 ? (
              <div className="promote-empty-small">{t('promotePage.slots.fullyBookedMessage', { defaultValue: 'You are fully booked for the next 7 days - tremendous. Use the Campaigns tab to fill the week after next.' })}</div>
          ) : (
            <div className="promote-slot-grid">
              {[...openDays, ...lightDays].map((day) => (
                <article key={day.key} className={'promote-slot-card' + (day.busy === 0 ? ' open' : ' light')}>
                  <header>
                    <span className="promote-slot-day">{formatRelativeDate(day.date.toISOString())}</span>
                    <span className={'promote-slot-status ' + (day.busy === 0 ? 'free' : 'light')}>
                      {day.busy === 0 ? t('promotePage.slots.wideOpen', { defaultValue: 'Wide open' }) : `${day.busy} ${t('promotePage.slots.jobsBooked', { defaultValue: 'job(s) booked' })}`}
                    </span>
                  </header>
                  <p>{slotCopy(day.date)}</p>
                  <div className="promote-slot-actions">
                    <button
                      type="button"
                      className="promote-btn secondary"
                      onClick={() => { copyToClipboard(slotCopy(day.date), 'Slot promo copied'); onTrackedClick('slot_filler', day.key); }}
                    >
                      <Copy size={14} /> {t('promotePage.common.copy', { defaultValue: 'Copy' })}
                    </button>
                    <button
                      type="button"
                      className="promote-btn primary"
                      onClick={() => {
                        const smsBody = encodeURIComponent(slotCopy(day.date));
                        window.open(`sms:?&body=${smsBody}`, '_blank');
                        onTrackedClick('slot_filler', `sms_${day.key}`);
                      }}
                    >
                      <Send size={14} /> {t('promotePage.slots.sendAsText', { defaultValue: 'Send as text' })}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Referrals tab - tracked links, refer-a-neighbor offer
 * ------------------------------------------------------------------------- */

function ReferralsTab({ target, onTrackedClick }) {
  const { t } = useTranslation();
  const [offer, setOffer] = useState(() => readJson(LS_REFERRAL_OFFER, { give: 20, get: 20, currency: '$', cap: 100 }));
  const [campaignName, setCampaignName] = useState('neighbor_referral');
  const [channels] = useState(['facebook', 'instagram', 'nextdoor', 'sms', 'email', 'card']);
  const [channel, setChannel] = useState('facebook');

  useEffect(() => { writeJson(LS_REFERRAL_OFFER, offer); }, [offer]);

  const trackedLink = useMemo(() => buildTrackedUrl(target.profileUrl, {
    source: channel, medium: 'referral', campaign: campaignName, content: 'neighbor',
  }), [channel, campaignName, target.profileUrl]);

  const cardText = useMemo(() => (
`${target.providerName} - referral card

Hi neighbor,

If you have ever wished a friend or family member had someone reliable for ${target.serviceText}, here is your chance to help them out (and yourself).

When you send a neighbor my way and they book with me, you get ${offer.currency}${offer.get} off your next visit and they get ${offer.currency}${offer.give} off their first one. Up to ${offer.currency}${offer.cap} per year.

Share this link with them:
${trackedLink}

Thank you for trusting me with your home.
${target.providerName}`
  ), [offer, target, trackedLink]);

  return (
    <section className="promote-section">
      <div className="promote-section-head">
        <div>
          <span className="promote-kicker"><Gift size={18} /> {t('promotePage.referrals.title', { defaultValue: 'Referral Program Builder' })}</span>
          <h2>{t('promotePage.referrals.heading', { defaultValue: 'Turn happy customers into your sales team.' })}</h2>
          <p>{t('promotePage.referrals.body', { defaultValue: 'Build a "give $X, get $X" referral offer and generate trackable links for every channel. OxSteed counts clicks on each link so you can see which neighbors actually drive bookings.' })}</p>
        </div>
      </div>

      <div className="promote-referral-grid">
        <div className="promote-referral-builder">
          <div className="promote-panel-title"><Wand2 size={18} /><h3>{t('promotePage.referrals.offerDetails', { defaultValue: 'Offer details' })}</h3></div>
          <label className="promote-field">
            <span>{t('promotePage.referrals.give', { defaultValue: 'Give (their reward when they refer a neighbor)' })}</span>
            <div className="promote-currency-row">
              <select value={offer.currency} onChange={(e) => setOffer({ ...offer, currency: e.target.value })}>
                {['$', '£', '€', 'CA$', 'A$'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="number" min={0} value={offer.get} onChange={(e) => setOffer({ ...offer, get: Number(e.target.value) })} />
            </div>
          </label>
          <label className="promote-field">
            <span>{t('promotePage.referrals.get', { defaultValue: 'Get (the new neighbor&apos;s first-visit discount)' })}</span>
            <input type="number" min={0} value={offer.give} onChange={(e) => setOffer({ ...offer, give: Number(e.target.value) })} />
          </label>
          <label className="promote-field">
            <span>{t('promotePage.referrals.cap', { defaultValue: 'Annual cap per customer (sets a smart ceiling)' })}</span>
            <input type="number" min={0} value={offer.cap} onChange={(e) => setOffer({ ...offer, cap: Number(e.target.value) })} />
          </label>
          <label className="promote-field">
            <span>{t('promotePage.referrals.campaignName', { defaultValue: 'Campaign name (used in tracked links)' })}</span>
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase())} />
          </label>

          <div className="promote-channel-row tight">
            {channels.map((ch) => (
              <button
                key={ch}
                type="button"
                className={'promote-channel-pill' + (channel === ch ? ' active' : '')}
                onClick={() => setChannel(ch)}
              >
                <span>{ch}</span>
              </button>
            ))}
          </div>

          <div className="promote-link-row tracked">
            <span>{trackedLink}</span>
            <button type="button" onClick={() => { copyToClipboard(trackedLink, 'Tracked referral link copied'); onTrackedClick(`referral_${channel}`, campaignName); }} aria-label="Copy tracked link">
              <Copy size={14} />
            </button>
          </div>

          <p className="promote-help">{t('promotePage.referrals.help', { defaultValue: 'Send the right link from the right channel. OxSteed counts the click in your Performance tab. Whoever brings the most new bookings should get a thank-you note.' })}</p>
        </div>

        <div className="promote-referral-card">
          <div className="promote-panel-title"><Award size={18} /><h3>{t('promotePage.referrals.cardTitle', { defaultValue: 'Refer-a-Neighbor card' })}</h3></div>
          <div className="promote-referral-card-preview">
            <div className="promote-referral-card-head">
              <Gift size={18} />
              <strong>{target.providerName}</strong>
            </div>
            <h4>{t('promotePage.referrals.giveGet', { defaultValue: 'Give {give} - Get {get}' }).replace('{give}', `${offer.currency}${offer.give}`).replace('{get}', `${offer.currency}${offer.get}`)}</h4>
            <p>{t('promotePage.referrals.cardBody', { defaultValue: 'Send a neighbor my way for {service}. When they book, they save {give} and your next visit is {get} off. Annual cap: {cap}.' }).replace('{service}', target.serviceText).replace('{give}', `${offer.currency}${offer.give}`).replace('{get}', `${offer.currency}${offer.get}`).replace('{cap}', `${offer.currency}${offer.cap}`)}</p>
            <div className="promote-referral-card-foot">
              <span>{trackedLink}</span>
            </div>
          </div>
          <div className="promote-referral-actions">
            <button
              type="button"
              className="promote-btn secondary"
              onClick={() => { copyToClipboard(cardText, 'Referral card text copied'); onTrackedClick('referral_card', 'copy'); }}
            >
              <Copy size={14} /> {t('promotePage.referrals.copyCardText', { defaultValue: 'Copy card text' })}
            </button>
            <button
              type="button"
              className="promote-btn primary"
              onClick={() => { window.print(); onTrackedClick('referral_card', 'print'); }}
            >
              <Printer size={14} /> {t('promotePage.referrals.printHandOut', { defaultValue: 'Print and hand out' })}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Performance tab - tracked link analytics
 * ------------------------------------------------------------------------- */

function PerformanceTab({ trackedClicks, onReset }) {
  const { t } = useTranslation();
  const entries = Object.entries(trackedClicks)
    .map(([key, slot]) => ({ key, total: slot._total || 0, details: slot }))
    .sort((a, b) => b.total - a.total);

  const grandTotal = entries.reduce((acc, e) => acc + e.total, 0);
  const topRow = entries[0];

  return (
    <section className="promote-section">
      <div className="promote-section-head">
        <div>
          <span className="promote-kicker"><BarChart3 size={18} /> {t('promotePage.performance.title', { defaultValue: 'Performance' })}</span>
          <h2>{t('promotePage.performance.heading', { defaultValue: 'Track which promos actually move work.' })}</h2>
          <p>{t('promotePage.performance.body', { defaultValue: 'Every time you copy a tracked link or post, OxSteed records it locally. Look here weekly to spot which channels and angles are pulling weight - and which ones to stop running.' })}</p>
        </div>
        <div className="promote-perf-summary">
          <div><strong>{grandTotal}</strong><span>{t('promotePage.performance.trackedActions', { defaultValue: 'tracked actions' })}</span></div>
          <div><strong>{entries.length}</strong><span>{t('promotePage.performance.activeSources', { defaultValue: 'active sources' })}</span></div>
          <div><strong>{topRow ? topRow.key.replace(/_/g, ' ') : '-'}</strong><span>{t('promotePage.performance.topSource', { defaultValue: 'top source' })}</span></div>
        </div>
      </div>

      {entries.length === 0 ? (
          <div className="promote-empty-small">{t('promotePage.performance.empty', { defaultValue: 'Nothing tracked yet. Copy a post, slot promo, or referral link and OxSteed will record the source automatically. Reload after a few days for the first picture.' })}</div>
      ) : (
        <>
          <div className="promote-perf-bars">
            {entries.map((row) => {
              const pct = grandTotal === 0 ? 0 : Math.round((row.total / grandTotal) * 100);
              return (
                <div key={row.key} className="promote-perf-row">
                  <div className="promote-perf-label">
                    <strong>{row.key.replace(/_/g, ' ')}</strong>
                    <span>{row.total} actions · {pct}%</span>
                  </div>
                  <div className="promote-perf-bar">
                    <div className="promote-perf-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="promote-perf-breakdown">
                    {Object.entries(row.details).filter(([k]) => k !== '_total').map(([sub, n]) => (
                      <span key={sub}>{sub}: <strong>{n}</strong></span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="promote-perf-actions">
            <button type="button" className="promote-btn secondary" onClick={onReset}>
              <RefreshCw size={14} /> {t('promotePage.performance.resetTracking', { defaultValue: 'Reset tracking' })}
            </button>
            <span className="promote-help">{t('promotePage.performance.help', { defaultValue: 'Tracking is stored locally in your browser so you can experiment safely.' })}</span>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Toolkit tab - signature, embed widget, SEO checklist, drip, reviews
 * ------------------------------------------------------------------------- */

function ToolkitTab({ target, qrSrc, tone, seoChecks, setSeoChecks, onTrackedClick }) {
  const { t } = useTranslation();
  const [requestingPlacement, setRequestingPlacement] = useState(false);
  // Email signature ---------------------------------------------------------
  const sigName = target.providerName;
  const sigTitle = target.serviceText;
  const sigLine = target.locationText ? `${sigTitle} | ${target.locationText}` : sigTitle;
  const signatureHtml = useMemo(() => (
    `<table style="font-family:Arial, sans-serif;color:#111827;font-size:14px">
  <tr>
    <td style="padding-right:14px;border-right:3px solid #f97316">
      <strong style="font-size:16px">${sigName}</strong><br/>
      <span style="color:#64748b">${sigLine}</span><br/>
      <a href="${target.profileUrl}" style="color:#f97316;text-decoration:none">${target.profileUrl}</a>
    </td>
    <td style="padding-left:14px">
      <a href="${target.bookingUrl}" style="display:inline-block;background:#f97316;color:#111827;text-decoration:none;padding:6px 12px;border-radius:6px;font-weight:bold">Book on OxSteed</a>
    </td>
  </tr>
</table>`
  ), [sigName, sigLine, target.profileUrl, target.bookingUrl]);

  // Embed widget code ------------------------------------------------------
  const embedCode = useMemo(() => (
    `<!-- Book me on OxSteed -->
<a href="${target.bookingUrl}?utm_source=website&utm_medium=widget&utm_campaign=book_widget"
   style="display:inline-flex;align-items:center;gap:10px;background:#f97316;color:#111827;
          font-family:system-ui,sans-serif;font-weight:700;padding:12px 18px;border-radius:10px;
          text-decoration:none;box-shadow:0 4px 14px rgba(249,115,22,0.35)">
  Book ${target.providerName} on OxSteed
  <span style="background:#111827;color:#fff;padding:2px 8px;border-radius:99px;font-size:11px">Verified</span>
</a>`
  ), [target.bookingUrl, target.providerName]);

  // Drip sequence ----------------------------------------------------------
  const dripDay1 = `Day 1 - Hi {first_name}, this is ${target.providerName} on OxSteed. Saw you were looking for ${target.serviceText}. I have one window open this week if you want it: ${target.bookingUrl}`;
  const dripDay3 = `Day 3 - Hi {first_name}, ${target.providerName} again. Wanted to make sure my last message did not get buried. Easy way to grab a slot: ${target.bookingUrl}. Happy to answer questions first.`;
  const dripDay7 = `Day 7 - Hi {first_name}, I will stop following up after this. If timing is wrong, no worries. When you are ready, here is the link: ${target.bookingUrl}. I keep recent reviews on my profile if it helps.`;

  // Review request --------------------------------------------------------
  const [reviewName, setReviewName] = useState('');
  const [reviewPlatform, setReviewPlatform] = useState('oxsteed');
  const reviewPlatformDef = REVIEW_PLATFORMS.find((p) => p.id === reviewPlatform) || REVIEW_PLATFORMS[0];
  const reviewText = useMemo(() => {
    const who = reviewName || 'there';
    const greet = tone === 'direct' ? '' : 'Hi ';
    return `${greet}${who}, this is ${target.providerName}. Thanks again for trusting me with your ${target.serviceText.split(',')[0]}. ${reviewPlatformDef.placeholder} Profile: ${target.profileUrl}`;
  }, [reviewName, reviewPlatformDef, target, tone]);

  // SEO checklist ---------------------------------------------------------
  const toggleSeo = (id) => {
    const next = { ...seoChecks, [id]: !seoChecks[id] };
    setSeoChecks(next);
    writeJson(LS_SEO_CHECKS, next);
  };
  const seoDone = SEO_QUICK_WINS.filter((w) => seoChecks[w.id]).length;
  const seoTotalMinutes = SEO_QUICK_WINS.reduce((acc, w) => acc + (seoChecks[w.id] ? 0 : w.minutes), 0);

  const requestFeaturedPlacement = async () => {
    if (!target.businessId) {
      toast.error(t('promotePage.toolkit.chooseBusinessPageFirst', { defaultValue: 'Choose a business page in the Studio tab before requesting featured placement.' }));
      return;
    }

    try {
      setRequestingPlacement(true);
      await api.post(`/businesses/${target.businessId}/featured-placement-requests`, {
        category: target.serviceText,
        note: `Featured placement requested from Growth Center for ${target.providerName}.`,
        source: 'promote_page',
      });
      toast.success(t('promotePage.toolkit.featuredSent', { defaultValue: 'Featured placement request sent' }));
      onTrackedClick('featured_placement', 'request');
    } catch (error) {
      toast.error(error.response?.data?.error || t('promotePage.toolkit.featuredFailed', { defaultValue: 'Failed to request featured placement' }));
    } finally {
      setRequestingPlacement(false);
    }
  };

  return (
    <>
      <section className="promote-section">
        <div className="promote-section-head">
          <div>
            <span className="promote-kicker"><Wrench size={18} /> {t('promotePage.toolkit.title', { defaultValue: 'Toolkit' })}</span>
            <h2>{t('promotePage.toolkit.heading', { defaultValue: 'Five high-leverage tools, ready to use.' })}</h2>
            <p>{t('promotePage.toolkit.body', { defaultValue: 'These are the assets most providers never get around to building. Each one earns work for years after you set it up once.' })}</p>
          </div>
        </div>

        {/* Email signature */}
        <div className="promote-tool-block">
          <div className="promote-tool-head">
            <Mail size={18} />
            <h3>{t('promotePage.toolkit.signatureTitle', { defaultValue: 'Email signature builder' })}</h3>
            <span>{t('promotePage.toolkit.signatureBody', { defaultValue: 'Every email you send becomes an ad for your services.' })}</span>
          </div>
          <div className="promote-signature-preview" dangerouslySetInnerHTML={{ __html: signatureHtml }} />
          <div className="promote-tool-actions">
            <button type="button" className="promote-btn secondary" onClick={() => { copyToClipboard(signatureHtml, 'Signature HTML copied'); onTrackedClick('signature', 'html'); }}>
              <Code size={14} /> {t('promotePage.common.copyHtml', { defaultValue: 'Copy HTML' })}
            </button>
            <button type="button" className="promote-btn primary" onClick={() => { copyToClipboard(`${sigName}\n${sigLine}\n${target.profileUrl}\nBook: ${target.bookingUrl}`, 'Plain-text signature copied'); onTrackedClick('signature', 'text'); }}>
              <Copy size={14} /> {t('promotePage.toolkit.copyPlainText', { defaultValue: 'Copy plain text' })}
            </button>
          </div>
          <p className="promote-help">
            Paste the HTML in Gmail (Settings - Signature - rich format), Outlook, or Apple Mail.
          </p>
        </div>

        {/* Website embed widget */}
        <div className="promote-tool-block">
          <div className="promote-tool-head">
            <Globe size={18} />
            <h3>{t('promotePage.toolkit.embedTitle', { defaultValue: 'Embed a "Book me" button on any site' })}</h3>
            <span>{t('promotePage.toolkit.embedBody', { defaultValue: 'Drop this on your personal website, Squarespace, WordPress, or even a Google Site.' })}</span>
          </div>
          <pre className="promote-code-block"><code>{embedCode}</code></pre>
          <div className="promote-tool-actions">
            <button type="button" className="promote-btn primary" onClick={() => { copyToClipboard(embedCode, 'Embed code copied'); onTrackedClick('embed_widget', 'copy'); }}>
              <Code size={14} /> {t('promotePage.toolkit.copyEmbedCode', { defaultValue: 'Copy embed code' })}
            </button>
            <a className="promote-btn secondary" href={target.bookingUrl} target="_blank" rel="noopener noreferrer">
              {t('promotePage.toolkit.preview', { defaultValue: 'Preview' })} <ExternalLink size={14} />
            </a>
          </div>
        </div>

        {/* Drip sequence */}
        <div className="promote-tool-block">
          <div className="promote-tool-head">
            <Send size={18} />
            <h3>{t('promotePage.toolkit.followUpTitle', { defaultValue: '3-step follow-up sequence' })}</h3>
            <span>{t('promotePage.toolkit.followUpBody', { defaultValue: 'For leads who reach out but do not book on day one.' })}</span>
          </div>
          <div className="promote-drip-list">
            {[dripDay1, dripDay3, dripDay7].map((line, idx) => (
              <div key={idx} className="promote-drip-step">
                <strong>{t('promotePage.toolkit.step', { defaultValue: 'Step' })} {idx + 1}</strong>
                <textarea readOnly value={line} />
                <button type="button" className="promote-btn secondary" onClick={() => { copyToClipboard(line, `Step ${idx + 1} copied`); onTrackedClick('drip', `step_${idx + 1}`); }}>
                  <Copy size={14} /> {t('promotePage.common.copy', { defaultValue: 'Copy' })}
                </button>
              </div>
            ))}
          </div>
          <p className="promote-help">
            {t('promotePage.toolkit.replaceName', { defaultValue: 'Replace {first_name} with the lead&apos;s name before sending.' }).replace('{first_name}', '{first_name}')}
          </p>
        </div>

        {/* Review request */}
        <div className="promote-tool-block">
          <div className="promote-tool-head">
            <Star size={18} />
            <h3>{t('promotePage.toolkit.reviewTitle', { defaultValue: 'Personalized review request' })}</h3>
            <span>{t('promotePage.toolkit.reviewBody', { defaultValue: 'Send 1-2 days after a job. Reviews are the single biggest lift to bookings.' })}</span>
          </div>
          <div className="promote-review-row">
            <label className="promote-field">
              <span>{t('promotePage.toolkit.customerFirstName', { defaultValue: 'Customer first name' })}</span>
              <input value={reviewName} onChange={(e) => setReviewName(e.target.value)} placeholder="Sarah" />
            </label>
            <label className="promote-field">
              <span>{t('promotePage.toolkit.platform', { defaultValue: 'Platform' })}</span>
              <select value={reviewPlatform} onChange={(e) => setReviewPlatform(e.target.value)}>
                {REVIEW_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <textarea readOnly value={reviewText} className="promote-studio-textarea" />
          <div className="promote-tool-actions">
            <button type="button" className="promote-btn secondary" onClick={() => { copyToClipboard(reviewText, 'Review request copied'); onTrackedClick('review_request', reviewPlatform); }}>
              <Copy size={14} /> {t('promotePage.common.copy', { defaultValue: 'Copy' })}
            </button>
            <button
              type="button"
              className="promote-btn primary"
              onClick={() => {
                window.open(`sms:?&body=${encodeURIComponent(reviewText)}`, '_blank');
                onTrackedClick('review_request', `sms_${reviewPlatform}`);
              }}
            >
              <Send size={14} /> {t('promotePage.toolkit.sendAsText', { defaultValue: 'Send as text' })}
            </button>
          </div>
        </div>

        {/* SEO checklist */}
        <div className="promote-tool-block">
          <div className="promote-tool-head">
            <Target size={18} />
            <h3>{t('promotePage.toolkit.seoTitle', { defaultValue: 'Local SEO quick-wins' })}</h3>
            <span>{seoDone}/{SEO_QUICK_WINS.length} {t('promotePage.toolkit.complete', { defaultValue: 'complete' })} · {seoTotalMinutes} {t('promotePage.toolkit.minutesRemaining', { defaultValue: 'minutes of work remaining' })}</span>
          </div>
          <ul className="promote-seo-list">
            {SEO_QUICK_WINS.map((w) => {
              const done = !!seoChecks[w.id];
              const Icon = done ? CheckCircle2 : Plus;
              return (
                <li key={w.id} className={done ? 'done' : ''}>
                  <button type="button" className="promote-seo-toggle" onClick={() => toggleSeo(w.id)} aria-label={done ? t('promotePage.toolkit.markIncomplete', { defaultValue: 'Mark incomplete' }) : t('promotePage.toolkit.markComplete', { defaultValue: 'Mark complete' })}>
                    <Icon size={18} />
                  </button>
                  <div>
                    <div className="promote-seo-title">
                      <strong>{w.title}</strong>
                      <span className={'promote-seo-impact ' + w.impact.toLowerCase()}>{w.impact} {t('promotePage.toolkit.impact', { defaultValue: 'impact' })}</span>
                      <span className="promote-seo-time">{w.minutes} {t('promotePage.toolkit.min', { defaultValue: 'min' })}</span>
                    </div>
                    <p>{w.detail}</p>
                  </div>
                  {w.url?.startsWith('/') ? (
                    <Link to={w.url} className="promote-seo-link">{t('promotePage.common.open', { defaultValue: 'Open' })} <ChevronRight size={14} /></Link>
                  ) : (
                    <a href={w.url} target="_blank" rel="noopener noreferrer" className="promote-seo-link">{t('promotePage.common.open', { defaultValue: 'Open' })} <ExternalLink size={14} /></a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Boost spotlight */}
        <div className="promote-tool-block boost">
          <div className="promote-tool-head">
            <TrendingUp size={18} />
            <h3>{t('promotePage.toolkit.featuredTitle', { defaultValue: 'Featured Placement' })}</h3>
            <span>{t('promotePage.toolkit.featuredBody', { defaultValue: 'Promoted card at the top of search results in your category and ZIP.' })}</span>
          </div>
          <p className="promote-help">
            {t('promotePage.toolkit.featuredHelp', { defaultValue: 'Request a pilot boost review for your business. OxSteed will use your category, profile quality, service area, and recent reputation before approving paid placement.' })}
          </p>
          <div className="promote-tool-actions">
            <button
              type="button"
              className="promote-btn primary"
              onClick={requestFeaturedPlacement}
              disabled={requestingPlacement || !target.businessId}
            >
              <TrendingUp size={14} /> {requestingPlacement ? t('promotePage.common.sending', { defaultValue: 'Sending...' }) : t('promotePage.toolkit.requestReview', { defaultValue: 'Request review' })}
            </button>
            {!target.businessId && (
              <button
                type="button"
                className="promote-btn secondary"
                onClick={() => toast('Use the Studio tab to select a business page first.')}
              >
                {t('promotePage.toolkit.chooseBusinessPage', { defaultValue: 'Choose business page' })}
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Main page
 * ------------------------------------------------------------------------- */

export default function PromotePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [helperProfile, setHelperProfile] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [targetType, setTargetType] = useState('helper');
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [tone, setTone] = useState('friendly');
  const [availabilityText, setAvailabilityText] = useState('Available this week');
  const [printLayout, setPrintLayout] = useState('flyer');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('studio');
  const [trackedClicks, setTrackedClicks] = useState(() => readJson(LS_TRACKED_CLICKS, {}));
  const [seoChecks, setSeoChecks] = useState(() => readJson(LS_SEO_CHECKS, {}));

  const isProvider = HELPER_ROLES.has(user?.role);

  useEffect(() => {
    let mounted = true;
    async function loadGrowthInputs() {
      if (!isProvider) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [helperRes, businessRows] = await Promise.all([
          api.get('/helper-profile/me').catch(() => ({ data: null })),
          listBusinesses().catch(() => []),
        ]);
        if (!mounted) return;
        setHelperProfile(helperRes.data || null);
        setBusinesses(businessRows);
        if (businessRows.length > 0) setSelectedBusinessId(String(businessRows[0].id));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadGrowthInputs();
    return () => { mounted = false; };
  }, [isProvider]);

  const selectedBusiness = businesses.find((biz) => String(biz.id) === String(selectedBusinessId)) || null;
  const canUseBusiness = targetType === 'business' && selectedBusiness;
  const siteOrigin = getSiteOrigin();

  const target = useMemo(() => {
    const helperServices = helperProfile?.services || [];
    const serviceText = canUseBusiness
      ? selectedBusiness?.description?.split(/[.!?]/)[0] || 'local services'
      : compactList(helperServices.slice(0, 3).map((svc) => svc.name), user?.profile_headline || 'local services');
    const providerName = canUseBusiness
      ? selectedBusiness.business_name
      : user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'My OxSteed profile';
    const locationText = canUseBusiness
      ? compactList([
          selectedBusiness.city || selectedBusiness.location_city,
          selectedBusiness.state || selectedBusiness.location_state,
        ], '')
      : compactList([helperProfile?.service_city, helperProfile?.service_state], '');
    const profilePath = canUseBusiness ? `/businesses/public/${selectedBusiness.id}` : `/helpers/${user?.id}`;
    const bookingPath = canUseBusiness ? profilePath : `/book/${user?.id}`;
    return {
      businessId: canUseBusiness ? selectedBusiness.id : null,
      providerName,
      serviceText,
      locationText,
      profileUrl: `${siteOrigin}${profilePath}`,
      bookingUrl: `${siteOrigin}${bookingPath}`,
      profilePath,
      bookingPath,
      availabilityText,
    };
  }, [availabilityText, canUseBusiness, helperProfile, selectedBusiness, siteOrigin, user]);

  const helperReadiness = useMemo(() => {
    const services = helperProfile?.services || [];
    const gallery = helperProfile?.gallery || [];
    const hasHours = helperProfile?.has_availability_template
      ?? (helperProfile?.availability_json && Object.keys(helperProfile.availability_json || {}).length > 0);
    return [
      { done: !!helperProfile?.profile_headline, label: 'Headline explains what you do' },
      { done: !!helperProfile?.bio_long, label: 'About section tells customers what to expect' },
      { done: services.length > 0, label: 'At least one service has pricing or booking context' },
      { done: gallery.length > 0, label: 'Photos show your work or your business' },
      { done: hasHours || helperProfile?.is_available_now, label: 'Availability is visible before customers contact you' },
    ];
  }, [helperProfile]);

  const readinessScore = Math.round((helperReadiness.filter((item) => item.done).length / helperReadiness.length) * 100);
  const qrSrc = canUseBusiness
    ? `/api/business-profile/${encodeURIComponent(selectedBusiness.id)}/qr-code?format=buffer&size=240`
    : user?.id
      ? getHelperProfileQrPngUrl(user.id, 240)
      : '';

  const handlePrint = () => {
    if (!qrSrc) {
      toast.error('Add a profile first so OxSteed can print a QR code.');
      return;
    }
    window.setTimeout(() => window.print(), 80);
  };

  const onTrackedClick = useCallback((key, channel) => {
    const next = bumpCounter(key, channel || 'default');
    setTrackedClicks(next);
  }, []);

  const resetTracking = useCallback(() => {
    writeJson(LS_TRACKED_CLICKS, {});
    setTrackedClicks({});
    toast.success('Performance reset');
  }, []);

  return (
    <PageShell>
      <PageMeta
        title={t('promotePage.metaTitle', { defaultValue: 'Growth Center | OxSteed' })}
        description={t('promotePage.metaDescription', { defaultValue: 'Promote your OxSteed services with multi-angle posts, seasonal campaigns, slot fillers, referrals, performance tracking, and a professional toolkit.' })}
      />
      <div className="promote-page">
        <section className="promote-hero">
          <div>
            <span className="promote-kicker"><Megaphone size={18} /> {t('promotePage.kicker', { defaultValue: 'Growth Center' })}</span>
            <h1>{t('promotePage.heroTitle', { defaultValue: 'Promote your services the way successful local providers actually do.' })}</h1>
            <p>{t('promotePage.heroBody', { defaultValue: 'Six angles, six channels, 24 seasonal campaigns, smart slot fillers, a referral builder with tracked links, performance analytics, and a five-tool toolkit. Built right into your OxSteed profile - because the work of marketing should not be a second job.' })}</p>
          </div>
          <div className="promote-hero-actions">
            <Link to="/dashboard?tab=editprofile" className="promote-btn secondary">{t('promotePage.improveProfile', { defaultValue: 'Improve profile' })}</Link>
            <Link to="/qr-generator" className="promote-btn primary">{t('promotePage.openQrStudio', { defaultValue: 'Open QR studio' })}</Link>
          </div>
        </section>

        {!isProvider ? (
          <div className="promote-empty">
            <Briefcase size={28} />
            <h2>{t('promotePage.emptyTitle', { defaultValue: 'Growth Center is for helpers and business providers.' })}</h2>
            <p>{t('promotePage.emptyBody', { defaultValue: 'Create a helper profile or business page first, then come back to build your promotion kit.' })}</p>
            <Link to="/register/helper" className="promote-btn primary">{t('promotePage.joinAsHelper', { defaultValue: 'Join as a helper' })}</Link>
          </div>
        ) : (
          <>
            <nav className="promote-tabs" role="tablist" aria-label={t('promotePage.sectionsLabel', { defaultValue: 'Growth Center sections' })}>
              {[
                { id: 'studio', label: t('promotePage.tabs.studio', { defaultValue: 'Studio' }), icon: Sparkles },
                { id: 'campaigns', label: t('promotePage.tabs.campaigns', { defaultValue: 'Campaigns' }), icon: CalendarDays },
                { id: 'slots', label: t('promotePage.tabs.slots', { defaultValue: 'Smart Slots' }), icon: Zap },
                { id: 'referrals', label: t('promotePage.tabs.referrals', { defaultValue: 'Referrals' }), icon: Gift },
                { id: 'performance', label: t('promotePage.tabs.performance', { defaultValue: 'Performance' }), icon: BarChart3 },
                { id: 'toolkit', label: t('promotePage.tabs.toolkit', { defaultValue: 'Toolkit' }), icon: Wrench },
              ].map((tabItem) => {
                const Icon = tabItem.icon;
                return (
                  <button
                    key={tabItem.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tabItem.id}
                    className={'promote-tab' + (activeTab === tabItem.id ? ' active' : '')}
                    onClick={() => setActiveTab(tabItem.id)}
                  >
                    <Icon size={15} />
                    <span>{tabItem.label}</span>
                  </button>
                );
              })}
            </nav>

            {activeTab === 'studio' && (
              <StudioTab
                target={target}
                qrSrc={qrSrc}
                loading={loading}
                readinessScore={readinessScore}
                helperReadiness={helperReadiness}
                targetType={targetType}
                setTargetType={setTargetType}
                businesses={businesses}
                selectedBusinessId={selectedBusinessId}
                setSelectedBusinessId={setSelectedBusinessId}
                availabilityText={availabilityText}
                setAvailabilityText={setAvailabilityText}
                tone={tone}
                setTone={setTone}
                printLayout={printLayout}
                setPrintLayout={setPrintLayout}
                onPrint={handlePrint}
                onTrackedClick={onTrackedClick}
              />
            )}

            {activeTab === 'campaigns' && (
              <CampaignsTab target={target} tone={tone} onTrackedClick={onTrackedClick} />
            )}

            {activeTab === 'slots' && (
              <SlotsTab target={target} tone={tone} onTrackedClick={onTrackedClick} />
            )}

            {activeTab === 'referrals' && (
              <ReferralsTab target={target} onTrackedClick={onTrackedClick} />
            )}

            {activeTab === 'performance' && (
              <PerformanceTab trackedClicks={trackedClicks} onReset={resetTracking} />
            )}

            {activeTab === 'toolkit' && (
              <ToolkitTab
                target={target}
                qrSrc={qrSrc}
                tone={tone}
                seoChecks={seoChecks}
                setSeoChecks={setSeoChecks}
                onTrackedClick={onTrackedClick}
              />
            )}

            <section className="promote-playbook">
              <div>
                <span className="promote-kicker"><CalendarDays size={18} /> {t('promotePage.weeklyPlaybook', { defaultValue: 'Weekly playbook' })}</span>
                <h2>{t('promotePage.weeklyTitle', { defaultValue: 'The minimum you should do every week' })}</h2>
              </div>
              <div className="promote-playbook-grid">
                {[
                  [t('promotePage.playbook.monday', { defaultValue: 'Monday' }), t('promotePage.playbook.mondayText', { defaultValue: 'Share your booking link with a clear availability note. Studio tab handles the copy.' })],
                  [t('promotePage.playbook.wednesday', { defaultValue: 'Wednesday' }), t('promotePage.playbook.wednesdayText', { defaultValue: 'Send one slot-filler text to a past customer for any open day this week.' })],
                  [t('promotePage.playbook.friday', { defaultValue: 'Friday' }), t('promotePage.playbook.fridayText', { defaultValue: 'Post one before/after photo with a Campaigns-tab story angle.' })],
                  [t('promotePage.playbook.afterEachJob', { defaultValue: 'After each job' }), t('promotePage.playbook.afterEachJobText', { defaultValue: 'Send the personalized review request from the Toolkit tab.' })],
                ].map(([day, text]) => (
                  <div key={day} className="promote-playbook-item">
                    <strong>{day}</strong>
                    <p>{text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="promote-next">
              <div>
                <h2>{t('promotePage.whyInsideTitle', { defaultValue: 'Why this lives inside OxSteed' })}</h2>
                <p>{t('promotePage.whyInsideBody', { defaultValue: 'Most local-services providers know they should be marketing. Few have the time. The Growth Center turns the assets you already have - your profile, your reviews, your calendar - into ready-to-paste posts, ready-to-print flyers, and ready-to-track links.' })}</p>
              </div>
              <div className="promote-next-list">
                <Link to="/business-hub" className="promote-next-row">{t('promotePage.businessHubLink', { defaultValue: 'Business Hub - invoices, taxes, and goals' })} <ArrowRight size={16} /></Link>
                <Link to="/calendar" className="promote-next-row">{t('promotePage.calendarLink', { defaultValue: 'Calendar - mark availability customers can see' })} <ArrowRight size={16} /></Link>
                <Link to="/dashboard?tab=reviews" className="promote-next-row">{t('promotePage.reviewsLink', { defaultValue: 'Reviews - request and respond to customer feedback' })} <ArrowRight size={16} /></Link>
                <Link to="/templates?type=helper" className="promote-next-row">{t('promotePage.templatesLink', { defaultValue: 'Profile templates - upgrade how your page looks' })} <ArrowRight size={16} /></Link>
              </div>
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
