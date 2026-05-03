// HomeTemplates.jsx — Default + Home & Property templates (8 templates)
// Each template has a distinct layout, color system, section order, and industry-specific content blocks.
import {
  StarRating, Avatar, BadgeList, ServiceCard, GalleryGrid,
  ReviewCard, FAQList, LocationChip, StatsRow, ContactRow, SectionHead,
  ChecklistRow, HorizontalServiceBar, PackageCard, SpecialtyPill,
  ProcessStep, QuoteBlock, CredentialItem, StatCard,
} from '../shared.jsx';
import { CheckCircle, Wrench, Home, Leaf, Sparkles, Bug, Truck, Palette,
  Zap, Phone, Calendar, Shield, Star, AlertTriangle, Clock } from 'lucide-react';

// ─── 1. DEFAULT ───────────────────────────────────────────────────────────────
// Clean, neutral base — works for any helper. 2/3+1/3 layout.
export function DefaultTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      <div className="relative">
        {helper.coverImage && (
          <img src={helper.coverImage} alt="cover" className="w-full h-52 object-cover opacity-40" />
        )}
        <div className={`${helper.coverImage ? 'absolute bottom-0 left-0 right-0' : ''} p-6`}>
          <div className="max-w-4xl mx-auto flex items-end gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={90}
              className="border-4 border-gray-900 bg-gray-800 text-gray-300" />
            <div className="pb-1">
              <h1 className="text-2xl font-bold">{helper.businessName}</h1>
              <p className="text-gray-400 text-sm mt-0.5">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2">
                <StarRating rating={helper.rating} />
                <span className="text-sm text-gray-400">{helper.reviewCount} reviews</span>
                <LocationChip city={helper.city} state={helper.state} className="text-gray-400" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {helper.bio && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-white">About</SectionHead>
              <p className="text-gray-400 text-sm leading-relaxed">{helper.bio}</p>
            </section>
          )}
          {services.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-white">Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <ServiceCard key={s.id} service={s}
                    cardClass="bg-gray-800 border border-gray-700"
                    priceClass="text-orange-400" />
                ))}
              </div>
            </section>
          )}
          {gallery.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-white">Gallery</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}
          {reviews.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-white">Reviews</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-gray-800 text-gray-200" />
                ))}
              </div>
            </section>
          )}
          {faqs.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-white">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-gray-800"
                questionClass="text-gray-200" answerClass="text-gray-400" />
            </section>
          )}
        </div>
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount}
              jobsCompleted={helper.jobsCompleted}
              statClass="text-orange-400" labelClass="text-gray-500 text-xs" />
          </div>
          <BadgeList badges={helper.badges}
            badgeClass="bg-gray-800 text-green-400 border border-green-800" />
          <ContactRow phone={phone} website={website} linkClass="text-orange-400 hover:text-orange-300" />
        </div>
      </div>
    </div>
  );
}

// ─── 2. TRADES PRO ───────────────────────────────────────────────────────────
// Industrial authority layout. License card prominently at top. Services as bold horizontal bars.
// Wide single-column for services, certifications sidebar leads with credentials.
export function TradesProTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#0d1117', color: '#e6edf3' }}>
      {/* Heavy industrial banner */}
      <div style={{ background: 'linear-gradient(90deg, #1c2333 0%, #21262d 100%)', borderBottom: '3px solid #3b82f6' }}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <div className="relative flex-shrink-0">
              <Avatar src={helper.avatar} name={helper.ownerName} size={96}
                className="border-3 bg-gray-700 text-white" style={{ borderColor: '#3b82f6' }} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Wrench size={14} style={{ color: '#3b82f6' }} />
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#3b82f6' }}>
                  Licensed Trade Professional
                </span>
              </div>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p style={{ color: '#8b949e' }} className="mt-1 text-sm">{helper.tagline}</p>
              <div className="flex flex-wrap items-center gap-4 mt-3">
                <StarRating rating={helper.rating} color="#3b82f6" />
                <span style={{ color: '#8b949e' }} className="text-sm">{helper.reviewCount} verified reviews</span>
                <LocationChip city={helper.city} state={helper.state} className="text-gray-400" />
              </div>
            </div>
            {/* Stats block */}
            <div className="grid grid-cols-3 gap-4 text-center flex-shrink-0">
              {[
                { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
                { v: helper.reviewCount ?? 0, l: 'Reviews' },
                { v: helper.jobsCompleted ?? 0, l: 'Jobs' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-2xl font-black" style={{ color: '#3b82f6' }}>{s.v}</div>
                  <div className="text-xs" style={{ color: '#8b949e' }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Certifications row — prominent for trades */}
          {helper.badges.length > 0 && (
            <section style={{ background: '#161b22', border: '1px solid #30363d' }} className="rounded-2xl p-5">
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#3b82f6' }}>
                Licenses & Certifications
              </p>
              <div className="flex flex-wrap gap-2">
                {helper.badges.map(b => (
                  <span key={b.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: '#1f6feb22', border: '1px solid #1f6feb', color: '#58a6ff' }}>
                    <Shield size={11} />{b.label}
                  </span>
                ))}
              </div>
            </section>
          )}

          {helper.bio && (
            <section style={{ background: '#161b22', border: '1px solid #30363d' }} className="rounded-2xl p-5">
              <SectionHead style={{ color: '#e6edf3' }} className="">About the Contractor</SectionHead>
              <p style={{ color: '#8b949e' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section style={{ background: '#161b22', border: '1px solid #30363d' }} className="rounded-2xl p-5">
              <SectionHead style={{ color: '#e6edf3' }} className="">Services & Rates</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#3b82f6"
                    bgClass="bg-gray-800" textClass="text-white" priceClass="text-blue-400" />
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section style={{ background: '#161b22', border: '1px solid #30363d' }} className="rounded-2xl p-5">
              <SectionHead style={{ color: '#e6edf3' }} className="">Project Gallery</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section style={{ background: '#161b22', border: '1px solid #30363d' }} className="rounded-2xl p-5">
              <SectionHead style={{ color: '#e6edf3' }} className="">Client Reviews</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="text-gray-300" style={{ background: '#21262d' }} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div style={{ background: '#1f6feb', borderRadius: 16 }} className="p-5">
            <p className="text-sm font-bold text-white mb-1">Get a Quote</p>
            <ContactRow phone={phone} website={website} linkClass="text-blue-100 hover:text-white" />
          </div>
          {faqs.length > 0 && (
            <div style={{ background: '#161b22', border: '1px solid #30363d' }} className="rounded-2xl p-5">
              <SectionHead className="text-sm" style={{ color: '#58a6ff' }}>FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="" questionClass="text-white text-sm"
                answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 3. HANDYMAN ─────────────────────────────────────────────────────────────
// Friendly neighborhood feel. "What I Fix" as a 3-column icon-tile grid.
// Contact CTA floats prominently in hero. Warm earth tones, no sidebar — full-width flow.
export function HandymanTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const fixCategories = services.slice(0, 9);
  return (
    <div className="min-h-screen font-sans" style={{ background: '#faf5eb', color: '#1c1003' }}>
      {/* Warm hero with embedded phone CTA */}
      <div style={{ background: 'linear-gradient(135deg, #92400e 0%, #b45309 50%, #d97706 100%)' }}>
        <div className="max-w-3xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-5 mb-6">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="border-4 bg-amber-800 text-white shadow-xl" style={{ borderColor: 'rgba(255,255,255,0.4)' }} />
            <div className="text-center sm:text-left">
              <span className="text-xs font-bold uppercase tracking-widest opacity-70">Your Neighborhood Handyman</span>
              <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
              <p className="opacity-85 text-sm mt-1">{helper.tagline}</p>
              <div className="flex flex-wrap gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#fde68a" size={14} />
                <span className="text-amber-200 text-xs">{helper.reviewCount} happy clients</span>
                <LocationChip city={helper.city} state={helper.state} className="text-amber-200 text-xs" />
              </div>
            </div>
          </div>
          {/* Big phone CTA */}
          {phone && (
            <a href={`tel:${phone}`}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-black text-lg"
              style={{ background: 'rgba(255,255,255,0.15)', border: '2px solid rgba(255,255,255,0.3)' }}>
              <Phone size={20} /> Call Now: {phone}
            </a>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Jobs counter strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { v: helper.jobsCompleted ?? 0, l: 'Jobs Done', c: '#d97706' },
            { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Avg Rating', c: '#d97706' },
            { v: helper.reviewCount ?? 0, l: 'Reviews', c: '#d97706' },
          ].map(s => (
            <div key={s.l} className="bg-white rounded-2xl p-4 text-center shadow-sm border border-amber-100">
              <div className="text-2xl font-black" style={{ color: s.c }}>{s.v}</div>
              <div className="text-xs text-amber-800 mt-0.5">{s.l}</div>
            </div>
          ))}
        </div>

        {/* What I Fix — icon tile grid */}
        {fixCategories.length > 0 && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
            <SectionHead className="text-amber-800">What I Can Fix</SectionHead>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {fixCategories.map(s => (
                <div key={s.id} className="rounded-xl p-3 text-center"
                  style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                  <Wrench size={18} className="mx-auto mb-1.5" style={{ color: '#d97706' }} />
                  <p className="text-xs font-semibold text-amber-900 leading-tight">{s.name}</p>
                  {s.price > 0 && <p className="text-xs text-amber-600 mt-0.5 font-bold">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {helper.bio && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
            <SectionHead className="text-amber-800">About Me</SectionHead>
            <p className="text-amber-900 leading-relaxed text-sm">{helper.bio}</p>
            {helper.badges.length > 0 && (
              <div className="mt-4 pt-4 border-t border-amber-100">
                <BadgeList badges={helper.badges} badgeClass="bg-amber-100 text-amber-800 border border-amber-200" />
              </div>
            )}
          </section>
        )}

        {gallery.length > 0 && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
            <SectionHead className="text-amber-800">My Work</SectionHead>
            <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
          </section>
        )}

        {reviews.length > 0 && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
            <SectionHead className="text-amber-800">What Neighbors Say</SectionHead>
            <div className="grid sm:grid-cols-2 gap-3">
              {reviews.slice(0, 4).map(r => (
                <ReviewCard key={r.id} review={r} cardClass="bg-amber-50 text-amber-900 border border-amber-100" />
              ))}
            </div>
          </section>
        )}

        {faqs.length > 0 && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
            <SectionHead className="text-amber-800">Common Questions</SectionHead>
            <FAQList faqs={faqs} itemClass="bg-amber-50" questionClass="text-amber-900" answerClass="text-amber-700" />
          </section>
        )}

        {website && (
          <div className="text-center pb-4">
            <a href={website} target="_blank" rel="noopener noreferrer"
              className="text-sm text-amber-600 hover:text-amber-800 underline">{website.replace(/^https?:\/\//, '')}</a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 4. HOME & GARDEN ────────────────────────────────────────────────────────
// Nature-forward. Photo banner hero. Services as seasonal-style cards. Before/after gallery pairs.
// Wide two-column for services. Sidebar: availability + contact.
export function HomeGardenTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f0fdf4', color: '#14532d' }}>
      {/* Photo banner or gradient */}
      <div className="relative overflow-hidden" style={{ minHeight: 200 }}>
        {helper.coverImage
          ? <img src={helper.coverImage} alt="cover" className="w-full h-56 object-cover" />
          : <div className="h-56" style={{ background: 'linear-gradient(135deg, #15803d 0%, #166534 60%, #052e16 100%)' }} />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/60" />
        <div className="absolute bottom-0 left-0 right-0 px-6 py-5">
          <div className="max-w-5xl mx-auto flex items-end gap-4">
            <Avatar src={helper.avatar} name={helper.ownerName} size={84}
              className="border-4 bg-green-800 text-white shadow-xl flex-shrink-0"
              style={{ borderColor: '#86efac' }} />
            <div className="text-white pb-1">
              <span className="text-xs font-bold uppercase tracking-widest text-green-300">
                Landscaping & Garden Care
              </span>
              <h1 className="text-2xl font-black drop-shadow">{helper.businessName}</h1>
              <div className="flex items-center gap-3 mt-1">
                <StarRating rating={helper.rating} color="#86efac" size={13} />
                <span className="text-green-200 text-xs">{helper.reviewCount} reviews</span>
                <LocationChip city={helper.city} state={helper.state} className="text-green-200 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Our Story</SectionHead>
              <p className="text-green-900 leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Garden Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="rounded-xl p-4 flex gap-3 items-start"
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    <Leaf size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#16a34a' }} />
                    <div className="flex-1">
                      <p className="font-semibold text-sm text-green-900">{s.name}</p>
                      {s.description && <p className="text-xs text-green-700 mt-0.5">{s.description}</p>}
                      {s.price > 0 && <p className="text-xs font-bold text-green-600 mt-1">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Before & After</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Happy Clients</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-green-50 text-green-900" />
                ))}
              </div>
            </section>
          )}

          {faqs.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-green-50" questionClass="text-green-900" answerClass="text-green-700" />
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #15803d, #166534)' }}>
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-green-200 text-2xl" labelClass="text-green-400 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5 border border-green-100 shadow-sm space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-green-100 text-green-700 border border-green-200" />
            <ContactRow phone={phone} website={website} linkClass="text-green-700 hover:text-green-800" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 5. CLEANING SERVICE ─────────────────────────────────────────────────────
// Package-first layout. Three cleaning tiers displayed as prominent cards.
// Checklist-style "what's included" per package. Eco badges. Single main column.
export function CleaningServiceTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const [pkg1, pkg2, pkg3, ...extraServices] = services;
  const packages = [pkg1, pkg2, pkg3].filter(Boolean);
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f0fdfa', color: '#134e4a' }}>
      {/* Crisp teal header */}
      <div style={{ background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="border-4 bg-teal-700 text-white" style={{ borderColor: 'rgba(255,255,255,0.4)' }} />
            <div className="text-center sm:text-left">
              <div className="flex items-center gap-1.5 mb-1 justify-center sm:justify-start">
                <Sparkles size={13} className="text-teal-200" />
                <span className="text-xs font-bold uppercase tracking-widest text-teal-200">Professional Cleaning</span>
              </div>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p className="text-teal-100 text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#99f6e4" size={13} />
                <span className="text-teal-200 text-xs">{helper.reviewCount} reviews</span>
                <LocationChip city={helper.city} state={helper.state} className="text-teal-200 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Eco badges strip */}
        {helper.badges.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center">
            {helper.badges.map(b => (
              <span key={b.id} className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: '#ccfbf1', color: '#0d9488', border: '1px solid #99f6e4' }}>
                <Sparkles size={10} />{b.label}
              </span>
            ))}
          </div>
        )}

        {/* Package cards — prominent */}
        {packages.length > 0 && (
          <section>
            <SectionHead className="text-teal-700 text-center">Cleaning Packages</SectionHead>
            <div className="grid sm:grid-cols-3 gap-4">
              {packages.map((s, i) => (
                <div key={s.id} className="rounded-2xl p-5 flex flex-col"
                  style={i === 1
                    ? { background: '#0d9488', color: '#fff', border: '2px solid #0d9488' }
                    : { background: '#fff', border: '1px solid #ccfbf1', color: '#134e4a' }}>
                  {i === 1 && <span className="text-xs font-bold uppercase tracking-widest text-teal-200 mb-2">Most Popular</span>}
                  <p className={`font-black text-lg ${i === 1 ? 'text-white' : 'text-teal-800'}`}>{s.name}</p>
                  {s.price > 0 && (
                    <p className={`text-3xl font-black mt-1 ${i === 1 ? 'text-teal-200' : 'text-teal-600'}`}>
                      ${s.price.toFixed(0)}<span className="text-sm font-normal opacity-70">/{s.priceUnit}</span>
                    </p>
                  )}
                  {s.description && <p className={`text-xs mt-2 leading-relaxed ${i === 1 ? 'text-teal-100' : 'text-teal-700'}`}>{s.description}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* What's included checklist */}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-teal-100">
          <SectionHead className="text-teal-700">What's Always Included</SectionHead>
          <div className="grid sm:grid-cols-2 gap-1">
            {['Vacuuming all floors', 'Mopping hard surfaces', 'Kitchen surfaces wiped down',
              'Bathroom sanitized', 'Dusting furniture', 'Trash emptied',
              'Eco-friendly products', '100% satisfaction guarantee'].map(item => (
              <ChecklistRow key={item} iconColor="#0d9488" textClass="text-teal-900">{item}</ChecklistRow>
            ))}
          </div>
        </section>

        {extraServices.length > 0 && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-teal-100">
            <SectionHead className="text-teal-700">Add-On Services</SectionHead>
            <div className="grid sm:grid-cols-2 gap-2">
              {extraServices.map(s => (
                <HorizontalServiceBar key={s.id} service={s} accentColor="#0d9488"
                  bgClass="bg-teal-50" textClass="text-teal-900" priceClass="text-teal-600" />
              ))}
            </div>
          </section>
        )}

        {helper.bio && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-teal-100">
            <SectionHead className="text-teal-700">About Our Service</SectionHead>
            <p className="text-teal-900 leading-relaxed text-sm">{helper.bio}</p>
          </section>
        )}

        {gallery.length > 0 && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-teal-100">
            <SectionHead className="text-teal-700">Our Work</SectionHead>
            <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
          </section>
        )}

        {reviews.length > 0 && (
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-teal-100">
            <SectionHead className="text-teal-700">Client Satisfaction</SectionHead>
            <div className="grid sm:grid-cols-2 gap-3">
              {reviews.slice(0, 4).map(r => (
                <ReviewCard key={r.id} review={r} cardClass="bg-teal-50 text-teal-800" />
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-4 justify-between items-center bg-teal-600 rounded-2xl p-5 text-white">
          <div>
            <p className="font-black text-lg">Ready for a Spotless Home?</p>
            <p className="text-teal-100 text-sm">Book your first clean today</p>
          </div>
          <ContactRow phone={phone} website={website} linkClass="text-white font-semibold hover:text-teal-200" />
        </div>
      </div>
    </div>
  );
}

// ─── 6. PEST CONTROL ─────────────────────────────────────────────────────────
// Urgent authority design. "Pests We Handle" chips. Guarantee badge prominent.
// Dark red & gunmetal. Service list with treatment protocol feel.
export function PestControlTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const pestTypes = ['Ants', 'Roaches', 'Rodents', 'Termites', 'Bed Bugs', 'Wasps', 'Spiders', 'Mosquitoes'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#111111', color: '#f5f5f5' }}>
      {/* Emergency-tone hero */}
      <div style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%)', borderBottom: '3px solid #ef4444' }}>
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="relative">
              <Avatar src={helper.avatar} name={helper.ownerName} size={96}
                className="border-4 bg-red-900 text-white" style={{ borderColor: '#ef4444' }} />
              <Bug size={18} className="absolute -bottom-1 -right-1 rounded-full p-1 text-white"
                style={{ background: '#ef4444' }} />
            </div>
            <div className="flex-1 text-center md:text-left">
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#fca5a5' }}>
                Certified Pest Elimination Specialists
              </span>
              <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
              <p style={{ color: '#fca5a5' }} className="mt-1 text-sm">{helper.tagline}</p>
              <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
                <StarRating rating={helper.rating} color="#fca5a5" size={14} />
                <span style={{ color: '#fca5a5' }} className="text-sm">{helper.reviewCount} reviews</span>
                <LocationChip city={helper.city} state={helper.state} className="text-red-300 text-sm" />
              </div>
            </div>
            <div className="flex flex-col gap-2 items-center">
              <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid #ef4444' }}>
                <div className="text-3xl font-black text-red-300">{helper.jobsCompleted}+</div>
                <div className="text-xs text-red-400">Homes Protected</div>
              </div>
              {/* Guarantee badge */}
              <div className="rounded-xl px-3 py-2 text-center" style={{ background: '#15803d22', border: '1px solid #16a34a' }}>
                <Shield size={14} className="mx-auto text-green-400 mb-0.5" />
                <p className="text-xs font-bold text-green-400">100% Guaranteed</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Pests we handle */}
          <section className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
            <SectionHead className="text-red-400">Pests We Eliminate</SectionHead>
            <div className="flex flex-wrap gap-2">
              {pestTypes.map(p => (
                <span key={p} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: '#7f1d1d33', border: '1px solid #7f1d1d', color: '#fca5a5' }}>
                  <Bug size={10} />{p}
                </span>
              ))}
            </div>
          </section>

          {services.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <SectionHead className="text-red-400">Treatment Services</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#ef4444"
                    bgClass="" textClass="text-white" priceClass="text-red-300"
                    style={{ background: '#2a1a1a' }} />
                ))}
              </div>
            </section>
          )}

          {helper.bio && (
            <section className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <SectionHead className="text-red-400">About Our Specialists</SectionHead>
              <p style={{ color: '#d4d4d4' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <SectionHead className="text-red-400">Client Results</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="text-gray-300" style={{ background: '#222' }} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {/* Emergency CTA */}
          <div className="rounded-2xl p-5 text-center" style={{ background: '#ef4444' }}>
            <AlertTriangle size={24} className="mx-auto mb-2 text-white" />
            <p className="font-black text-white text-lg">Pest Problem?</p>
            <p className="text-red-100 text-xs mb-3">Call for same-day service</p>
            {phone && (
              <a href={`tel:${phone}`} className="block w-full py-2 rounded-xl font-bold text-sm"
                style={{ background: 'rgba(0,0,0,0.2)', color: '#fff' }}>
                {phone}
              </a>
            )}
          </div>
          {helper.badges.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">Certifications</p>
              <BadgeList badges={helper.badges} badgeClass="text-white" style={{ background: '#7f1d1d33' }} />
            </div>
          )}
          {faqs.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
              <SectionHead className="text-red-400 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="" questionClass="text-white text-sm" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 7. MOVING & HAULING ──────────────────────────────────────────────────────
// Process-forward layout. "How Your Move Works" 4-step timeline is the hero.
// Navy + safety yellow. Services as distance-based pricing rows.
export function MovingHaulingTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const steps = [
    { n: 1, t: 'Free Quote', d: 'We assess your inventory and distance' },
    { n: 2, t: 'Pack & Prep', d: 'Wrap, box, and label everything carefully' },
    { n: 3, t: 'Load & Drive', d: 'Your belongings transported safely' },
    { n: 4, t: 'Delivery & Setup', d: 'Everything placed exactly where you want' },
  ];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f8faff', color: '#0f1b35' }}>
      {/* Bold navy hero */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className="relative">
              <Avatar src={helper.avatar} name={helper.ownerName} size={96}
                className="border-4 bg-blue-800 text-white shadow-xl"
                style={{ borderColor: '#facc15' }} />
              <Truck size={18} className="absolute -bottom-1 -right-1 rounded-full p-1"
                style={{ background: '#facc15', color: '#1e3a5f' }} />
            </div>
            <div className="flex-1 text-center md:text-left">
              <span className="text-xs font-bold uppercase tracking-widest text-yellow-300">Moving & Hauling</span>
              <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
              <p className="text-blue-100 text-sm mt-1">{helper.tagline}</p>
              <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
                <StarRating rating={helper.rating} color="#facc15" size={14} />
                <span className="text-blue-200 text-sm">{helper.reviewCount} reviews</span>
                <LocationChip city={helper.city} state={helper.state} className="text-blue-200 text-sm" />
              </div>
            </div>
            <div className="rounded-2xl p-4 text-center font-black flex-shrink-0"
              style={{ background: '#facc15', color: '#1e3a5f' }}>
              <div className="text-3xl">{helper.jobsCompleted}</div>
              <div className="text-xs font-bold">Moves Done</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* How your move works */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
            <SectionHead className="text-blue-800">How Your Move Works</SectionHead>
            <div className="space-y-4">
              {steps.map(s => (
                <ProcessStep key={s.n} number={s.n} title={s.t} description={s.d}
                  numBg="#1e40af" textClass="text-blue-900" />
              ))}
            </div>
          </section>

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-800">Services & Pricing</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#1e40af"
                    bgClass="bg-blue-50" textClass="text-blue-900" priceClass="text-blue-700" />
                ))}
              </div>
            </section>
          )}

          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-800">About Us</SectionHead>
              <p className="text-blue-900 leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-800">Happy Movers</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-blue-50 text-blue-900" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5 text-white" style={{ background: '#1e40af' }}>
            <p className="font-bold text-sm mb-3 text-blue-100">What We Include</p>
            {['Fully insured & licensed', 'Blanket wrap protection', 'Furniture disassembly/reassembly',
              'No hidden fees'].map(item => (
              <ChecklistRow key={item} iconColor="#facc15" textClass="text-blue-100">{item}</ChecklistRow>
            ))}
          </div>
          {helper.badges.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm">
              <BadgeList badges={helper.badges} badgeClass="bg-blue-100 text-blue-700 border border-blue-200" />
            </div>
          )}
          <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-blue-700 hover:text-blue-800" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm">
              <SectionHead className="text-blue-800 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-blue-50" questionClass="text-blue-900" answerClass="text-blue-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 8. INTERIOR DESIGN ───────────────────────────────────────────────────────
// Full editorial magazine layout. Gallery IS the hero. Single narrative column.
// Pull quotes for reviews. No standard sidebar — info flows in a long editorial column.
export function InteriorDesignTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const heroImg = gallery[0];
  return (
    <div className="min-h-screen font-serif" style={{ background: '#faf8f3', color: '#1a1208' }}>
      {/* Full-bleed gallery hero */}
      <div className="relative h-80 overflow-hidden">
        {heroImg
          ? <img src={heroImg.url} alt="featured interior" className="w-full h-full object-cover" />
          : <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #d4a853, #92620c)' }} />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 px-8 py-6">
          <span className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-amber-300">Interior Design Studio</span>
          <h1 className="text-4xl font-serif font-bold text-white mt-1 drop-shadow-lg">{helper.businessName}</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Designer bio bar */}
        <div className="flex items-center gap-5 mb-10 pb-8 border-b border-amber-200">
          <Avatar src={helper.avatar} name={helper.ownerName} size={72}
            className="border-2 bg-amber-100 text-amber-800 font-sans flex-shrink-0"
            style={{ borderColor: '#d4a853' }} />
          <div>
            <h2 className="text-lg font-serif font-bold">{helper.ownerName}</h2>
            <p className="text-sm font-sans" style={{ color: '#92620c' }}>{helper.tagline}</p>
            <div className="flex items-center gap-3 mt-1">
              <StarRating rating={helper.rating} color="#d4a853" size={12} />
              <span className="text-xs font-sans" style={{ color: '#92620c' }}>{helper.reviewCount} projects</span>
              <LocationChip city={helper.city} state={helper.state} className="font-sans text-xs text-amber-700" />
            </div>
          </div>
          <div className="ml-auto text-right hidden sm:block">
            <ContactRow phone={phone} website={website} linkClass="text-amber-700 text-sm font-sans hover:text-amber-900" />
          </div>
        </div>

        {/* Design philosophy */}
        {helper.bio && (
          <section className="mb-10">
            <span className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-amber-500 block mb-3">Philosophy</span>
            <p className="leading-relaxed text-base font-serif" style={{ color: '#2c1a00' }}>{helper.bio}</p>
          </section>
        )}

        {/* Services editorial */}
        {services.length > 0 && (
          <section className="mb-10">
            <span className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-amber-500 block mb-4">Services</span>
            <div className="grid sm:grid-cols-2 gap-4">
              {services.map(s => (
                <div key={s.id} className="p-4 rounded-xl font-sans"
                  style={{ background: '#fdf6e3', border: '1px solid #e8d5a3' }}>
                  <p className="font-serif font-semibold">{s.name}</p>
                  {s.description && <p className="text-xs mt-1" style={{ color: '#92620c' }}>{s.description}</p>}
                  {s.price > 0 && <p className="text-sm font-bold text-amber-700 mt-2">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Portfolio grid (skip first image used as hero) */}
        {gallery.length > 1 && (
          <section className="mb-10">
            <span className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-amber-500 block mb-4">Portfolio</span>
            <div className="grid grid-cols-3 gap-2">
              {gallery.slice(1, 7).map(img => (
                <div key={img.id} className="aspect-square rounded-xl overflow-hidden">
                  <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Client testimonials as pull quotes */}
        {reviews.length > 0 && (
          <section className="mb-10">
            <span className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-amber-500 block mb-5">Client Words</span>
            <div className="space-y-5">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor="#d4a853" textClass="font-serif text-base" authorClass="text-amber-700 font-sans text-xs" />
              ))}
            </div>
          </section>
        )}

        {/* Stats in editorial style */}
        <div className="grid grid-cols-3 gap-4 py-8 border-y border-amber-200 mb-10">
          {[
            { v: helper.rating?.toFixed(1) ?? '—', l: 'Average Rating' },
            { v: helper.reviewCount ?? 0, l: 'Happy Clients' },
            { v: helper.jobsCompleted ?? 0, l: 'Projects Done' },
          ].map(s => (
            <div key={s.l} className="text-center">
              <div className="text-3xl font-serif font-black" style={{ color: '#d4a853' }}>{s.v}</div>
              <div className="text-xs font-sans mt-0.5" style={{ color: '#92620c' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {helper.badges.length > 0 && (
          <div className="mb-8">
            <BadgeList badges={helper.badges} badgeClass="bg-amber-100 text-amber-800 border border-amber-200 font-sans" />
          </div>
        )}

        {faqs.length > 0 && (
          <section>
            <span className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-amber-500 block mb-4">FAQ</span>
            <FAQList faqs={faqs} itemClass="bg-amber-50 font-sans" questionClass="text-amber-900 font-sans text-sm"
              answerClass="text-amber-700 font-sans" />
          </section>
        )}
      </div>
    </div>
  );
}
