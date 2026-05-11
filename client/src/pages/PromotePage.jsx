import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Copy,
  ExternalLink,
  Mail,
  Megaphone,
  MessageSquare,
  Printer,
  QrCode,
  Share2,
  Sparkles,
  Star,
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

function buildPromotionCopy({ providerName, serviceText, locationText, profileUrl, bookingUrl, availabilityText, tone }) {
  const warmIntro = tone === 'direct'
    ? `I am available for ${serviceText}${locationText ? ` in ${locationText}` : ''}.`
    : `Hi neighbors, I am available for ${serviceText}${locationText ? ` around ${locationText}` : ''}.`;

  return {
    social: `${warmIntro} You can compare my services, check availability, message me, and book securely through OxSteed: ${profileUrl}`,
    sms: `${providerName} on OxSteed: ${serviceText}. ${availabilityText}. Book or message me here: ${bookingUrl}`,
    email: `Subject: Book ${providerName} on OxSteed\n\n${warmIntro}\n\nOxSteed lets you view my profile, services, reviews, availability, and secure booking options in one place.\n\nBook or message me here:\n${bookingUrl}`,
    flyer: `${providerName}\n${serviceText}\n${availabilityText}\nScan the QR code or visit:\n${profileUrl}`,
  };
}

function ReadinessRow({ done, children }) {
  return (
    <li className={done ? 'promote-ready-row done' : 'promote-ready-row'}>
      <CheckCircle2 size={16} />
      <span>{children}</span>
    </li>
  );
}

function CopyBlock({ title, icon: Icon, value }) {
  return (
    <div className="promote-copy-block">
      <div className="promote-copy-head">
        <div>
          <Icon size={17} />
          <span>{title}</span>
        </div>
        <button type="button" onClick={() => copyToClipboard(value, `${title} copied`)}>
          <Copy size={15} />
          Copy
        </button>
      </div>
      <textarea readOnly value={value} />
    </div>
  );
}

function PrintableCard({ target, qrSrc, variant }) {
  const isBusinessCard = variant === 'businessCards';
  const title = variant === 'qrCard' ? 'Scan to book or message me' : target.providerName;
  return (
    <article className={isBusinessCard ? 'print-business-card' : `print-template print-${variant}`}>
      <div className="print-brand">OxSteed</div>
      <div className="print-main">
        <div>
          <p className="print-kicker">{target.locationText || 'Local services'}</p>
          <h2>{title}</h2>
          <p>{target.serviceText}</p>
          <strong>{target.availabilityText}</strong>
        </div>
        {qrSrc && <img src={qrSrc} alt="" />}
      </div>
      <div className="print-url">{target.bookingUrl}</div>
      <div className="print-footer">View services, availability, messages, and secure booking on OxSteed.</div>
    </article>
  );
}

function PrintStudio({ target, qrSrc, printLayout, setPrintLayout, onPrint }) {
  const enrichedTarget = {
    ...target,
    availabilityText: target.availabilityText || 'Available this week',
  };

  const businessCards = Array.from({ length: 10 }, (_, i) => (
    <PrintableCard key={i} target={enrichedTarget} qrSrc={qrSrc} variant="businessCards" />
  ));

  return (
    <section className="promote-print-studio">
      <div className="promote-print-header">
        <div>
          <span className="promote-kicker"><Printer size={18} /> Print Studio</span>
          <h2>Ready-to-print marketing materials</h2>
          <p>
            Print a flyer, QR handout, or business-card sheet. Providers can use the browser print dialog
            to print directly or save as a PDF.
          </p>
        </div>
        <button type="button" className="promote-btn primary" onClick={onPrint}>
          <Printer size={16} />
          Print or save PDF
        </button>
      </div>

      <div className="promote-print-layouts" role="tablist" aria-label="Print layout">
        {[
          ['flyer', 'Flyer', 'A full-page poster for counters, bulletin boards, and community spaces.'],
          ['qrCard', 'QR handout', 'A compact scan card for quick in-person referrals.'],
          ['businessCards', 'Business cards', 'Ten cards per page for repeat local promotion.'],
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

export default function PromotePage() {
  const { user } = useAuth();
  const [helperProfile, setHelperProfile] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [targetType, setTargetType] = useState('helper');
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [tone, setTone] = useState('friendly');
  const [availabilityText, setAvailabilityText] = useState('Available this week');
  const [printLayout, setPrintLayout] = useState('flyer');
  const [loading, setLoading] = useState(true);

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
    return () => {
      mounted = false;
    };
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
    const profilePath = canUseBusiness ? `/business/${selectedBusiness.id}` : `/helpers/${user?.id}`;
    const bookingPath = canUseBusiness ? profilePath : `/book/${user?.id}`;
    return {
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

  const copy = useMemo(() => buildPromotionCopy({
    ...target,
    availabilityText,
    tone,
  }), [availabilityText, target, tone]);

  const helperReadiness = useMemo(() => {
    const services = helperProfile?.services || [];
    const gallery = helperProfile?.gallery || [];
    const hasHours = helperProfile?.availability_json && Object.keys(helperProfile.availability_json || {}).length > 0;
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

  return (
    <PageShell>
      <PageMeta title="Growth Center | OxSteed" description="Promote your OxSteed services with profile links, QR codes, share copy, and local marketing guidance." />
      <div className="promote-page">
        <section className="promote-hero">
          <div>
            <span className="promote-kicker"><Megaphone size={18} /> Growth Center</span>
            <h1>Promote your services without starting from a blank page.</h1>
            <p>
              Turn your OxSteed profile into links, QR codes, posts, texts, emails, and local follow-up ideas
              that help customers understand what you do and book with confidence.
            </p>
          </div>
          <div className="promote-hero-actions">
            <Link to="/dashboard?tab=editprofile" className="promote-btn secondary">Improve profile</Link>
            <Link to="/qr-generator" className="promote-btn primary">Open QR studio</Link>
          </div>
        </section>

        {!isProvider ? (
          <div className="promote-empty">
            <Briefcase size={28} />
            <h2>Growth Center is for helpers and business providers.</h2>
            <p>Create a helper profile or business page first, then come back to build your promotion kit.</p>
            <Link to="/register/helper" className="promote-btn primary">Join as a helper</Link>
          </div>
        ) : (
          <>
            <section className="promote-grid">
              <div className="promote-panel promote-selector">
                <div className="promote-panel-title">
                  <Sparkles size={18} />
                  <h2>Choose what you want to promote</h2>
                </div>
                <div className="promote-segmented" role="tablist" aria-label="Promotion target">
                  <button className={targetType === 'helper' ? 'active' : ''} onClick={() => setTargetType('helper')} type="button">Helper profile</button>
                  <button className={targetType === 'business' ? 'active' : ''} onClick={() => setTargetType('business')} disabled={businesses.length === 0} type="button">Business page</button>
                </div>
                {targetType === 'business' && (
                  <label className="promote-field">
                    <span>Business</span>
                    <select value={selectedBusinessId} onChange={(e) => setSelectedBusinessId(e.target.value)}>
                      {businesses.map((biz) => (
                        <option key={biz.id} value={biz.id}>{biz.business_name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="promote-field">
                  <span>Availability phrase</span>
                  <input value={availabilityText} onChange={(e) => setAvailabilityText(e.target.value)} placeholder="Available this week" />
                </label>
                <label className="promote-field">
                  <span>Tone</span>
                  <select value={tone} onChange={(e) => setTone(e.target.value)}>
                    <option value="friendly">Friendly neighbor</option>
                    <option value="direct">Direct and professional</option>
                  </select>
                </label>
              </div>

              <div className="promote-panel promote-qr-card">
                <div className="promote-panel-title">
                  <QrCode size={18} />
                  <h2>Booking link and QR</h2>
                </div>
                {loading ? (
                  <div className="promote-skeleton">Loading profile assets...</div>
                ) : (
                  <>
                    {qrSrc && <img src={qrSrc} alt="Profile QR code" />}
                    <div className="promote-link-row">
                      <span>{target.profileUrl}</span>
                      <button type="button" onClick={() => copyToClipboard(target.profileUrl, 'Profile link copied')} aria-label="Copy profile link">
                        <Copy size={15} />
                      </button>
                    </div>
                    <div className="promote-card-actions">
                      <a href={target.profilePath} target="_blank" rel="noopener noreferrer" className="promote-btn secondary">
                        View public page <ExternalLink size={14} />
                      </a>
                      <button type="button" className="promote-btn primary" onClick={() => copyToClipboard(target.bookingUrl, 'Booking link copied')}>
                        Copy booking link
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="promote-panel promote-ready">
                <div className="promote-panel-title">
                  <Star size={18} />
                  <h2>Ready to promote</h2>
                </div>
                <div className="promote-score">
                  <strong>{readinessScore}%</strong>
                  <span>profile readiness</span>
                </div>
                <ul>
                  {helperReadiness.map((item) => (
                    <ReadinessRow key={item.label} done={item.done}>{item.label}</ReadinessRow>
                  ))}
                </ul>
              </div>
            </section>

            <section className="promote-copy-grid">
              <CopyBlock title="Social post" icon={Share2} value={copy.social} />
              <CopyBlock title="Text message" icon={MessageSquare} value={copy.sms} />
              <CopyBlock title="Email" icon={Mail} value={copy.email} />
              <CopyBlock title="Flyer text" icon={QrCode} value={copy.flyer} />
            </section>

            <PrintStudio
              target={target}
              qrSrc={qrSrc}
              printLayout={printLayout}
              setPrintLayout={setPrintLayout}
              onPrint={handlePrint}
            />

            <section className="promote-playbook">
              <div>
                <span className="promote-kicker"><CalendarDays size={18} /> Weekly playbook</span>
                <h2>Simple ways to get more local work</h2>
              </div>
              <div className="promote-playbook-grid">
                {[
                  ['Monday', 'Share your booking link with a clear weekly availability note.'],
                  ['Wednesday', 'Post one photo, one service, and one price range customers can understand fast.'],
                  ['Friday', 'Send the booking link to past customers and ask if they need help next week.'],
                  ['After each job', 'Ask for a review while the work is still fresh.'],
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
                <h2>Next growth features worth adding</h2>
                <p>These are the natural next steps once this first Growth Center is in production.</p>
              </div>
              <div className="promote-next-list">
                <Link to="/business-hub" className="promote-next-row">Referral campaigns and returning-customer offers <ArrowRight size={16} /></Link>
                <Link to="/calendar" className="promote-next-row">Promote open appointment slots from the calendar <ArrowRight size={16} /></Link>
                <Link to="/dashboard?tab=reviews" className="promote-next-row">Review requests after completed jobs <ArrowRight size={16} /></Link>
              </div>
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
