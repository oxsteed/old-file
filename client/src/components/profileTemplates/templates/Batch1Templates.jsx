// client/src/components/profileTemplates/templates/Batch1Templates.jsx
// Batch 1 — 10 brand-new industry templates for design review

import {
  StarRating, Avatar, BadgeList, ServiceCard, GalleryGrid, ReviewCard,
  FAQList, LocationChip, StatsRow, ContactRow, SectionHead, VerifiedBadge,
  ChecklistRow, HorizontalServiceBar, PackageCard, SpecialtyPill,
  ProcessStep, QuoteBlock, CredentialItem, StatCard, MasonryGallery, TechChip,
} from '../shared.jsx';

import {
  Zap, Camera, Leaf, Wrench, Dog, ChefHat, Scissors, Calculator,
  BookOpen, PartyPopper, Shield, AlertTriangle, Clock, Phone, Globe,
  Star, Check, Award, MapPin, Users, Heart, Smile, Car, Key, DollarSign,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// 1. ELECTRICIAN — Dark navy + electric yellow, panel-style services
// ─────────────────────────────────────────────────────────────
export function ElectricianTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const NAVY = '#0F172A';
  const YELLOW = '#EAB308';

  const electricalSpecialties = [
    'Residential Wiring', 'Panel Upgrades', 'EV Charger Install',
    'Lighting Design', 'Generator Install', 'Smart Home', 'Commercial',
  ];

  return (
    <div style={{ background: '#F8FAFC', fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>

      {/* HEADER — dark navy with yellow bottom stripe */}
      <div style={{ background: NAVY, borderBottom: `4px solid ${YELLOW}` }}>
        <div className="max-w-5xl mx-auto px-6 py-8">

          {/* License badge — TOP of page, trust-first */}
          <div className="flex items-center gap-2 mb-5">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-black tracking-widest uppercase"
              style={{ background: YELLOW, color: NAVY }}
            >
              <Zap size={11} fill={NAVY} /> Licensed Electrician
            </span>
            {helper.badges?.slice(0, 2).map(b => (
              <span key={b.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold"
                style={{ background: 'rgba(234,179,8,0.15)', color: YELLOW, border: `1px solid ${YELLOW}33` }}>
                <Shield size={10} /> {b.label}
              </span>
            ))}
          </div>

          <div className="flex items-start gap-5">
            <Avatar
              src={helper.avatar}
              name={helper.ownerName}
              size={80}
              className="ring-2"
              style={{ '--tw-ring-color': YELLOW }}
            />
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-black text-white leading-none">{helper.businessName}</h1>
              <p className="text-sm mt-1" style={{ color: YELLOW }}>{helper.ownerName}</p>
              <p className="text-sm text-slate-400 mt-1">{helper.tagline}</p>
              <div className="flex flex-wrap items-center gap-4 mt-3">
                <LocationChip city={helper.city} state={helper.state} className="text-slate-400" />
                {phone && (
                  <a href={`tel:${phone}`} className="flex items-center gap-1 text-sm font-bold" style={{ color: YELLOW }}>
                    <Phone size={13} /> {phone}
                  </a>
                )}
              </div>
            </div>

            {/* Stats strip — top right */}
            <div className="hidden md:flex gap-6 text-center">
              {[
                { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
                { v: helper.reviewCount ?? 0, l: 'Reviews' },
                { v: helper.jobsCompleted ?? 0, l: 'Jobs' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-2xl font-black" style={{ color: YELLOW }}>{s.v}</div>
                  <div className="text-xs text-slate-500">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* Specialties chips */}
        <div>
          <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: NAVY }}>Specialties</p>
          <div className="flex flex-wrap gap-2">
            {electricalSpecialties.map(s => (
              <SpecialtyPill key={s} label={s}
                pillClass="rounded text-xs font-bold"
                style={{ background: `${YELLOW}22`, color: NAVY, border: `1px solid ${YELLOW}55` }}
              />
            ))}
          </div>
        </div>

        {/* Bio */}
        <div className="rounded-2xl p-6 bg-white shadow-sm">
          <SectionHead className="text-slate-900">About</SectionHead>
          <p className="text-sm text-slate-600 leading-relaxed">{helper.bio}</p>
        </div>

        {/* Services — electrical panel grid style */}
        {services.length > 0 && (
          <div>
            <SectionHead className="text-slate-900">Services &amp; Pricing</SectionHead>
            <div className="grid md:grid-cols-2 gap-3">
              {services.map(s => (
                <HorizontalServiceBar
                  key={s.id}
                  service={s}
                  accentColor={YELLOW}
                  bgClass="bg-white shadow-sm"
                  textClass="text-slate-900"
                  priceClass="font-black"
                  style={{ color: NAVY }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Gallery */}
        {gallery.length > 0 && (
          <div>
            <SectionHead className="text-slate-900">Recent Work</SectionHead>
            <GalleryGrid gallery={gallery} cols={4} />
          </div>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <div>
            <SectionHead className="text-slate-900">Customer Reviews</SectionHead>
            <div className="grid md:grid-cols-2 gap-3">
              {reviews.slice(0, 4).map(r => (
                <ReviewCard key={r.id} review={r} cardClass="bg-white shadow-sm" />
              ))}
            </div>
          </div>
        )}

        {/* Emergency CTA */}
        <div className="rounded-2xl p-6 text-center" style={{ background: NAVY }}>
          <Zap size={28} className="mx-auto mb-2" style={{ color: YELLOW }} />
          <p className="font-black text-white text-lg">Electrical Emergency?</p>
          <p className="text-slate-400 text-sm mb-4">Available for urgent calls</p>
          {phone && (
            <a href={`tel:${phone}`}
              className="inline-block px-6 py-3 rounded-xl font-black text-sm"
              style={{ background: YELLOW, color: NAVY }}>
              Call Now: {phone}
            </a>
          )}
        </div>

        {faqs.length > 0 && (
          <div>
            <SectionHead className="text-slate-900">FAQ</SectionHead>
            <FAQList faqs={faqs} itemClass="bg-white shadow-sm" questionClass="text-slate-900" answerClass="text-slate-600" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 2. PHOTOGRAPHER — Gallery-first, dark editorial, no sidebar
// ─────────────────────────────────────────────────────────────
export function PhotographerTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;

  const photoStyles = ['Portrait', 'Wedding', 'Commercial', 'Editorial', 'Event', 'Newborn', 'Product'];

  return (
    <div style={{ background: '#0A0A0A', fontFamily: 'Georgia, serif', minHeight: '100vh', color: '#E5E5E5' }}>

      {/* FULL-WIDTH MASONRY GALLERY — leads the page */}
      {gallery.length > 0 && (
        <div className="w-full overflow-hidden" style={{ maxHeight: 500 }}>
          <div className="grid grid-cols-4 gap-0.5">
            {gallery.slice(0, 8).map((img, i) => (
              <div key={img.id} className="overflow-hidden"
                style={{ aspectRatio: i === 0 ? '1/1.2' : i % 3 === 0 ? '1/0.8' : '1/1' }}>
                <img src={img.url} alt={img.alt} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Identity — centered below gallery */}
      <div className="max-w-2xl mx-auto px-6 py-10 text-center">
        <div className="flex justify-center mb-4">
          <Avatar src={helper.avatar} name={helper.ownerName} size={72}
            className="ring-2 ring-white ring-opacity-20" />
        </div>
        <h1 className="text-4xl font-black text-white" style={{ letterSpacing: '-1px' }}>
          {helper.businessName}
        </h1>
        <p className="text-sm mt-2 italic" style={{ color: '#A3A3A3' }}>{helper.tagline}</p>

        {/* Photography style chips */}
        <div className="flex flex-wrap justify-center gap-2 mt-5">
          {photoStyles.map(s => (
            <span key={s} className="px-3 py-1 text-xs font-semibold rounded-full"
              style={{ background: '#1A1A1A', color: '#D4D4D4', border: '1px solid #333' }}>
              {s}
            </span>
          ))}
        </div>

        {/* Stats */}
        <div className="flex justify-center gap-8 mt-6">
          {[
            { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
            { v: helper.reviewCount ?? 0, l: 'Reviews' },
            { v: helper.jobsCompleted ?? 0, l: 'Sessions' },
          ].map(s => (
            <div key={s.l} className="text-center">
              <div className="text-2xl font-black text-white">{s.v}</div>
              <div className="text-xs" style={{ color: '#737373' }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* About */}
      <div className="max-w-2xl mx-auto px-6 pb-8">
        <p className="text-sm leading-relaxed italic text-center" style={{ color: '#A3A3A3' }}>
          {helper.bio}
        </p>
      </div>

      {/* Services — elegant price menu style */}
      {services.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-10">
          <div className="border-t border-b py-2 text-center mb-6" style={{ borderColor: '#333' }}>
            <p className="text-xs tracking-widest uppercase font-bold" style={{ color: '#737373' }}>Packages &amp; Pricing</p>
          </div>
          <div className="space-y-4">
            {services.map(s => (
              <div key={s.id} className="flex justify-between items-center py-3"
                style={{ borderBottom: '1px solid #1F1F1F' }}>
                <div>
                  <p className="text-sm font-semibold text-white">{s.name}</p>
                  {s.description && <p className="text-xs mt-0.5 italic" style={{ color: '#737373' }}>{s.description}</p>}
                </div>
                {s.price > 0 && (
                  <span className="text-sm font-bold text-white ms-4">
                    ${s.price.toFixed(0)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reviews — pull quotes */}
      {reviews.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-10 space-y-5">
          <div className="border-t py-2 text-center" style={{ borderColor: '#333' }}>
            <p className="text-xs tracking-widest uppercase font-bold" style={{ color: '#737373' }}>Client Stories</p>
          </div>
          {reviews.slice(0, 3).map(r => (
            <QuoteBlock key={r.id} text={r.content} author={r.authorName}
              accentColor="#737373" textClass="text-slate-300" authorClass="text-slate-500" />
          ))}
        </div>
      )}

      {/* Contact footer */}
      <div className="border-t py-8 text-center" style={{ borderColor: '#1F1F1F' }}>
        <LocationChip city={helper.city} state={helper.state} className="justify-center text-slate-500 mb-3" />
        <ContactRow phone={phone} website={website} linkClass="text-slate-400 justify-center" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3. MASSAGE THERAPIST — Warm earth tones, centered, duration cards
// ─────────────────────────────────────────────────────────────
export function MassageTherapistTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const SAND = '#F5EFE6';
  const BROWN = '#78350F';
  const WARM = '#92400E';

  const modalities = ['Swedish', 'Deep Tissue', 'Hot Stone', 'Prenatal', 'Sports', 'Reflexology', 'Aromatherapy', 'Cupping'];
  const durations = [
    { min: 60, label: '60 min', desc: 'Focus session', price: services[0]?.price ?? 80 },
    { min: 90, label: '90 min', desc: 'Full body', price: services[1]?.price ?? 110 },
    { min: 120, label: '2 hours', desc: 'Deep restoration', price: services[2]?.price ?? 145 },
  ];

  return (
    <div style={{ background: SAND, fontFamily: 'Georgia, serif', minHeight: '100vh' }}>

      {/* HEADER — warm gradient */}
      <div style={{ background: `linear-gradient(135deg, ${BROWN} 0%, ${WARM} 100%)` }}>
        <div className="max-w-2xl mx-auto px-6 py-12 text-center text-white">
          <div className="flex justify-center mb-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="ring-4 ring-white ring-opacity-30" />
          </div>
          <h1 className="text-3xl font-black" style={{ letterSpacing: '-0.5px' }}>{helper.businessName}</h1>
          <p className="text-sm mt-1 opacity-80">{helper.ownerName} · Licensed Massage Therapist</p>
          <p className="text-sm mt-2 italic opacity-70">{helper.tagline}</p>

          <div className="flex justify-center gap-8 mt-6">
            {[
              { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
              { v: helper.reviewCount ?? 0, l: 'Reviews' },
              { v: helper.jobsCompleted ?? 0, l: 'Sessions' },
            ].map(s => (
              <div key={s.l}>
                <div className="text-xl font-black">{s.v}</div>
                <div className="text-xs opacity-60">{s.l}</div>
              </div>
            ))}
          </div>

          <LocationChip city={helper.city} state={helper.state} className="justify-center mt-4 opacity-70" />
        </div>
      </div>

      {/* BODY — single centered column */}
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">

        {/* Modalities */}
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-widest mb-4" style={{ color: WARM }}>Modalities</p>
          <div className="flex flex-wrap justify-center gap-2">
            {modalities.map(m => (
              <span key={m} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: '#FEF3C7', color: BROWN, border: `1px solid ${BROWN}33` }}>
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* Bio */}
        <div className="bg-white rounded-2xl p-7 shadow-sm">
          <p className="text-sm leading-relaxed italic text-center" style={{ color: '#6B4423' }}>
            {helper.bio}
          </p>
        </div>

        {/* Certifications */}
        {helper.badges?.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            <BadgeList badges={helper.badges}
              badgeClass="bg-amber-50 text-amber-900 border border-amber-200" />
          </div>
        )}

        {/* Duration cards */}
        <div>
          <p className="text-xs font-black uppercase tracking-widest mb-4 text-center" style={{ color: WARM }}>
            Session Lengths
          </p>
          <div className="grid grid-cols-3 gap-3">
            {durations.map(d => (
              <div key={d.min} className="bg-white rounded-2xl p-5 text-center shadow-sm">
                <Clock size={20} className="mx-auto mb-2" style={{ color: WARM }} />
                <p className="font-black text-lg" style={{ color: BROWN }}>{d.label}</p>
                <p className="text-xs italic mb-3" style={{ color: '#92400E' }}>{d.desc}</p>
                <p className="text-xl font-black" style={{ color: BROWN }}>${d.price}</p>
              </div>
            ))}
          </div>
        </div>

        {/* First visit info box */}
        <div className="rounded-2xl p-6" style={{ background: '#FEF3C7', border: `1px solid ${BROWN}22` }}>
          <p className="text-sm font-black mb-3" style={{ color: BROWN }}>Your First Visit</p>
          <div className="space-y-1.5">
            {[
              'Arrive 10 minutes early for intake form',
              'Discuss pressure preferences and problem areas',
              'Communicate during session, your comfort comes first',
              'Drink plenty of water after your session',
            ].map(t => (
              <ChecklistRow key={t} iconColor={WARM} textClass="text-amber-900">{t}</ChecklistRow>
            ))}
          </div>
        </div>

        {/* Reviews */}
        {reviews.length > 0 && (
          <div>
            <p className="text-xs font-black uppercase tracking-widest mb-5 text-center" style={{ color: WARM }}>
              What Clients Say
            </p>
            <div className="space-y-4">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor={BROWN} textClass="text-amber-900" authorClass="text-amber-700" />
              ))}
            </div>
          </div>
        )}

        {/* Book CTA */}
        {phone && (
          <div className="text-center">
            <a href={`tel:${phone}`}
              className="inline-block px-8 py-4 rounded-2xl font-black text-white text-sm shadow-lg"
              style={{ background: `linear-gradient(135deg, ${BROWN}, ${WARM})` }}>
              Book Your Session: {phone}
            </a>
          </div>
        )}

        {faqs.length > 0 && (
          <FAQList faqs={faqs} itemClass="bg-white shadow-sm"
            questionClass="text-amber-900" answerClass="text-amber-800" />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 4. AUTO MECHANIC — Dark gunmetal, orange accent, vehicle chips
// ─────────────────────────────────────────────────────────────
export function AutoMechanicTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const GUNMETAL = '#1A1A1A';
  const ORANGE = '#F97316';
  const DARK = '#111111';

  const carMakes = ['Toyota', 'Honda', 'Ford', 'Chevy', 'BMW', 'Mercedes', 'Audi', 'Subaru', 'Jeep', 'Hyundai'];
  const certifications = ['ASE Certified', 'EPA 609', 'OSHA Compliant'];

  return (
    <div style={{ background: '#F4F4F5', fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: GUNMETAL, borderBottom: `3px solid ${ORANGE}` }}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-start gap-5">
            <div className="relative">
              <Avatar src={helper.avatar} name={helper.ownerName} size={80}
                className="ring-2" style={{ '--tw-ring-color': ORANGE }} />
              <Wrench size={18} className="absolute -bottom-1 -end-1 rounded-full p-1"
                style={{ background: ORANGE, color: '#fff' }} />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-black text-white">{helper.businessName}</h1>
              <p className="text-sm mt-0.5" style={{ color: ORANGE }}>{helper.ownerName}</p>
              <p className="text-sm mt-1 text-gray-400">{helper.tagline}</p>

              {/* Cert badges */}
              <div className="flex flex-wrap gap-2 mt-3">
                {certifications.map(c => (
                  <span key={c} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold"
                    style={{ background: `${ORANGE}22`, color: ORANGE, border: `1px solid ${ORANGE}44` }}>
                    <Award size={10} /> {c}
                  </span>
                ))}
                {helper.badges?.map(b => (
                  <span key={b.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold"
                    style={{ background: `${ORANGE}22`, color: ORANGE, border: `1px solid ${ORANGE}44` }}>
                    <Shield size={10} /> {b.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="hidden md:flex gap-6 text-center">
              {[
                { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
                { v: helper.reviewCount ?? 0, l: 'Reviews' },
                { v: helper.jobsCompleted ?? 0, l: 'Repairs' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-2xl font-black" style={{ color: ORANGE }}>{s.v}</div>
                  <div className="text-xs text-gray-500">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 grid md:grid-cols-3 gap-6">

        {/* MAIN */}
        <div className="md:col-span-2 space-y-6">

          {/* Vehicle makes */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-zinc-900">Vehicle Makes I Service</SectionHead>
            <div className="flex flex-wrap gap-2">
              {carMakes.map(m => (
                <span key={m} className="px-3 py-1 rounded text-xs font-bold"
                  style={{ background: '#F4F4F5', color: GUNMETAL, border: '1px solid #E4E4E7' }}>
                  {m}
                </span>
              ))}
            </div>
          </div>

          {/* Bio */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-zinc-900">About</SectionHead>
            <p className="text-sm text-zinc-600 leading-relaxed">{helper.bio}</p>
          </div>

          {/* Services — flat-rate style */}
          {services.length > 0 && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <SectionHead className="text-zinc-900">Services &amp; Flat Rates</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor={ORANGE}
                    bgClass="bg-zinc-50" textClass="text-zinc-900" priceClass="text-orange-600" />
                ))}
              </div>
            </div>
          )}

          {/* Diagnostic process */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-zinc-900">How It Works</SectionHead>
            <div className="space-y-4">
              <ProcessStep number={1} title="Schedule &amp; Drop Off" description="Book online or call, same-day appointments often available" numBg={ORANGE} textClass="text-zinc-900" />
              <ProcessStep number={2} title="Free Diagnostic" description="We scan your vehicle and explain what we find, no surprises" numBg={ORANGE} textClass="text-zinc-900" />
              <ProcessStep number={3} title="Flat-Rate Repair" description="Approve the quote, we get to work, parts + labor included" numBg={ORANGE} textClass="text-zinc-900" />
              <ProcessStep number={4} title="Quality Check + Pick Up" description="Test drive and inspection before you take the keys back" numBg={ORANGE} textClass="text-zinc-900" />
            </div>
          </div>

          {gallery.length > 0 && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <SectionHead className="text-zinc-900">Shop &amp; Work Photos</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} />
            </div>
          )}

          {reviews.length > 0 && (
            <div>
              <SectionHead className="text-zinc-900">Reviews</SectionHead>
              <div className="grid grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-white shadow-sm" />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="space-y-4">
          <div className="rounded-2xl p-5 shadow-sm" style={{ background: GUNMETAL }}>
            <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: ORANGE }}>Contact</p>
            <ContactRow phone={phone} website={website} linkClass="text-gray-300" />
            <LocationChip city={helper.city} state={helper.state} className="text-gray-400 mt-2" />
          </div>

          <div className="rounded-2xl p-5 bg-white shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest mb-3 text-zinc-900">Hours</p>
            {[
              { d: 'Mon – Fri', h: '8 AM – 6 PM' },
              { d: 'Saturday', h: '9 AM – 4 PM' },
              { d: 'Sunday', h: 'Closed' },
            ].map(r => (
              <div key={r.d} className="flex justify-between py-1.5 border-b last:border-0 border-zinc-100">
                <span className="text-xs text-zinc-600">{r.d}</span>
                <span className="text-xs font-bold text-zinc-900">{r.h}</span>
              </div>
            ))}
          </div>

          {phone && (
            <a href={`tel:${phone}`}
              className="block text-center py-3 rounded-xl font-black text-sm"
              style={{ background: ORANGE, color: '#fff' }}>
              📞 Schedule Repair
            </a>
          )}

          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest mb-3 text-zinc-900">FAQ</p>
              <FAQList faqs={faqs} itemClass="bg-zinc-50 mb-1"
                questionClass="text-zinc-900 text-xs" answerClass="text-zinc-600 text-xs" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 5. DOG WALKER — Bright green, playful, dog-size chips
// ─────────────────────────────────────────────────────────────
export function DogWalkerTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const GREEN = '#16A34A';
  const LIGHT_GREEN = '#DCFCE7';

  const dogSizes = ['Tiny (0-10 lbs)', 'Small (10-25 lbs)', 'Medium (25-50 lbs)', 'Large (50-80 lbs)', 'Giant (80+ lbs)'];
  const walkTypes = [
    { icon: '🦮', name: 'Solo Walk', desc: 'One-on-one attention, 30 or 60 min' },
    { icon: '🐕‍🦺', name: 'Group Walk', desc: 'Small group, 3–5 dogs max, 60 min' },
    { icon: '🐾', name: 'Puppy Walk', desc: 'Short 20-min walks, twice daily' },
    { icon: '🏃', name: 'Adventure Run', desc: 'Trail run for high-energy dogs' },
  ];

  return (
    <div style={{ background: '#F0FDF4', fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: GREEN }}>
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={80}
              className="ring-4 ring-white ring-opacity-40" />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Dog size={18} className="text-white" />
                <span className="text-xs font-black uppercase tracking-widest text-green-200">Dog Walker</span>
              </div>
              <h1 className="text-2xl font-black text-white">{helper.businessName}</h1>
              <p className="text-sm text-green-200">{helper.ownerName}</p>
              <p className="text-sm italic text-green-100 mt-1">{helper.tagline}</p>
              <LocationChip city={helper.city} state={helper.state} className="text-green-200 mt-2" />
            </div>
            <div className="hidden md:flex gap-5 text-center">
              {[
                { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
                { v: helper.reviewCount ?? 0, l: 'Reviews' },
                { v: helper.jobsCompleted ?? 0, l: 'Walks' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-2xl font-black text-white">{s.v}</div>
                  <div className="text-xs text-green-200">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-7">

        {/* Dog sizes accepted */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SectionHead className="text-green-900">Dogs I Walk</SectionHead>
          <div className="flex flex-wrap gap-2">
            {dogSizes.map(s => (
              <span key={s} className="px-3 py-1.5 rounded-full text-xs font-bold"
                style={{ background: LIGHT_GREEN, color: GREEN }}>
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Walk types — card grid */}
        <div>
          <SectionHead className="text-green-900">Walk Options</SectionHead>
          <div className="grid grid-cols-2 gap-3">
            {walkTypes.map(w => (
              <div key={w.name} className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="text-3xl mb-2">{w.icon}</div>
                <p className="font-black text-green-900 text-sm">{w.name}</p>
                <p className="text-xs text-green-700 mt-1">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bio */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SectionHead className="text-green-900">About Me</SectionHead>
          <p className="text-sm text-green-800 leading-relaxed">{helper.bio}</p>
        </div>

        {/* Vaccination / requirements box */}
        <div className="rounded-2xl p-5" style={{ background: LIGHT_GREEN, border: `1px solid ${GREEN}44` }}>
          <p className="text-sm font-black mb-3" style={{ color: GREEN }}>
            🐾 Dog Requirements
          </p>
          {[
            'Up-to-date rabies vaccination required',
            'Bordetella (kennel cough) vaccine recommended',
            'Dogs must be flea & tick treated',
            'Aggressive dogs not accepted. Please disclose behavior history',
            'All dogs must be leash-trained or notified in advance',
          ].map(r => (
            <ChecklistRow key={r} iconColor={GREEN} textClass="text-green-800">{r}</ChecklistRow>
          ))}
        </div>

        {/* Pricing */}
        {services.length > 0 && (
          <div>
            <SectionHead className="text-green-900">Pricing</SectionHead>
            <div className="grid md:grid-cols-2 gap-3">
              {services.map(s => (
                <HorizontalServiceBar key={s.id} service={s} accentColor={GREEN}
                  bgClass="bg-white shadow-sm" textClass="text-green-900" priceClass="text-green-700 font-black" />
              ))}
            </div>
          </div>
        )}

        {/* Photo gallery */}
        {gallery.length > 0 && (
          <div>
            <SectionHead className="text-green-900">Happy Pups 🐶</SectionHead>
            <GalleryGrid gallery={gallery} cols={4} rounded="rounded-2xl" />
          </div>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <div>
            <SectionHead className="text-green-900">What Pet Parents Say</SectionHead>
            <div className="grid md:grid-cols-2 gap-3">
              {reviews.slice(0, 4).map(r => (
                <ReviewCard key={r.id} review={r} cardClass="bg-white shadow-sm" />
              ))}
            </div>
          </div>
        )}

        {/* Book CTA */}
        {phone && (
          <div className="text-center py-4">
            <a href={`tel:${phone}`}
              className="inline-block px-8 py-4 rounded-2xl font-black text-white text-sm"
              style={{ background: GREEN }}>
              Book a Walk: {phone}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 6. PRIVATE CHEF — Burgundy/cream, restaurant-menu layout
// ─────────────────────────────────────────────────────────────
export function PrivateChefTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const BURGUNDY = '#7C1D3A';
  const CREAM = '#FBF7F0';
  const GOLD = '#B45309';

  const cuisines = ['French', 'Italian', 'Japanese', 'Mediterranean', 'Latin', 'Plant-Based', 'Asian Fusion'];
  const dietary = ['Gluten-Free', 'Vegan', 'Vegetarian', 'Kosher', 'Halal', 'Nut-Free', 'Keto'];

  const menuSections = [
    { category: 'Appetizers', price: '$12–$18/person' },
    { category: 'Main Course', price: '$28–$55/person' },
    { category: 'Dessert', price: '$10–$16/person' },
    { category: 'Wine Pairing', price: 'upon request' },
  ];

  return (
    <div style={{ background: CREAM, fontFamily: 'Georgia, serif', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: BURGUNDY }}>
        <div className="max-w-3xl mx-auto px-8 py-10 text-center text-white">
          <ChefHat size={32} className="mx-auto mb-4 opacity-80" />
          <h1 className="text-3xl font-black tracking-tight">{helper.businessName}</h1>
          <p className="text-sm mt-1" style={{ color: '#FECDD3' }}>{helper.ownerName} · Private Chef</p>
          <p className="text-sm mt-2 italic opacity-70">{helper.tagline}</p>
          <LocationChip city={helper.city} state={helper.state} className="justify-center mt-3 opacity-60" />
          <div className="flex justify-center gap-8 mt-5">
            {[
              { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
              { v: helper.reviewCount ?? 0, l: 'Reviews' },
              { v: helper.jobsCompleted ?? 0, l: 'Dinners Hosted' },
            ].map(s => (
              <div key={s.l}>
                <div className="text-2xl font-black">{s.v}</div>
                <div className="text-xs opacity-60">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-10 space-y-8">

        {/* Cuisine specialties */}
        <div className="text-center">
          <p className="text-xs tracking-widest uppercase font-black mb-4" style={{ color: GOLD }}>Cuisine Specialties</p>
          <div className="flex flex-wrap justify-center gap-2">
            {cuisines.map(c => (
              <span key={c} className="px-4 py-1.5 rounded-full text-xs font-bold"
                style={{ background: `${BURGUNDY}15`, color: BURGUNDY, border: `1px solid ${BURGUNDY}33` }}>
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* About */}
        <div className="text-center py-2">
          <div className="w-16 h-px mx-auto mb-6" style={{ background: GOLD }} />
          <p className="text-sm leading-relaxed italic" style={{ color: '#5C3A1E' }}>{helper.bio}</p>
          <div className="w-16 h-px mx-auto mt-6" style={{ background: GOLD }} />
        </div>

        {/* Dietary accommodations */}
        <div>
          <p className="text-xs tracking-widest uppercase font-black mb-4 text-center" style={{ color: GOLD }}>Dietary Accommodations</p>
          <div className="flex flex-wrap justify-center gap-2">
            {dietary.map(d => (
              <span key={d} className="px-3 py-1 rounded text-xs font-semibold"
                style={{ background: '#FEF9C3', color: '#713F12', border: '1px solid #FDE68A' }}>
                {d}
              </span>
            ))}
          </div>
        </div>

        {/* Sample menu — restaurant menu style */}
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${BURGUNDY}33` }}>
          <div className="py-3 text-center" style={{ background: BURGUNDY }}>
            <p className="text-xs font-black tracking-widest uppercase text-white opacity-80">Sample Menu Structure</p>
          </div>
          {menuSections.map((m, i) => (
            <div key={m.category}
              className="flex justify-between items-center px-6 py-4"
              style={{ background: i % 2 === 0 ? CREAM : '#F7F1E8', borderBottom: `1px solid ${BURGUNDY}15` }}>
              <span className="text-sm font-semibold italic" style={{ color: BURGUNDY }}>{m.category}</span>
              <span className="text-xs font-bold" style={{ color: GOLD }}>{m.price}</span>
            </div>
          ))}
        </div>

        {/* Services */}
        {services.length > 0 && (
          <div>
            <p className="text-xs tracking-widest uppercase font-black mb-4 text-center" style={{ color: GOLD }}>Services</p>
            <div className="space-y-3">
              {services.map(s => (
                <div key={s.id} className="flex justify-between items-center py-3"
                  style={{ borderBottom: `1px solid ${BURGUNDY}15` }}>
                  <div>
                    <p className="text-sm font-semibold italic" style={{ color: BURGUNDY }}>{s.name}</p>
                    {s.description && <p className="text-xs mt-0.5" style={{ color: '#5C3A1E' }}>{s.description}</p>}
                  </div>
                  {s.price > 0 && <span className="text-sm font-bold" style={{ color: GOLD }}>${s.price.toFixed(0)}/person</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gallery — plated dishes */}
        {gallery.length > 0 && (
          <div>
            <p className="text-xs tracking-widest uppercase font-black mb-4 text-center" style={{ color: GOLD }}>The Food</p>
            <div className="grid grid-cols-3 gap-2">
              {gallery.slice(0, 6).map(img => (
                <div key={img.id} className="aspect-square rounded-xl overflow-hidden">
                  <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <div>
            <p className="text-xs tracking-widest uppercase font-black mb-6 text-center" style={{ color: GOLD }}>From the Table</p>
            <div className="space-y-5">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor={BURGUNDY} textClass="italic" authorClass="text-amber-700" />
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        {phone && (
          <div className="text-center py-4">
            <a href={`tel:${phone}`}
              className="inline-block px-8 py-4 rounded-xl font-black text-white text-sm"
              style={{ background: BURGUNDY }}>
              Reserve Your Dinner: {phone}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 7. HAIR STYLIST — Black/rose gold, photo-grid leads, salon menu
// ─────────────────────────────────────────────────────────────
export function HairStylistTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const BLACK = '#0A0A0A';
  const ROSE = '#F9A8D4';
  const ROSE_DARK = '#DB2777';

  const techniques = ['Balayage', 'Highlights', 'Keratin', 'Extensions', 'Color Correction', 'Brazilian Blowout', 'Perms'];
  const serviceCategories = [
    { cat: 'Cuts', services: services.slice(0, 2) },
    { cat: 'Color', services: services.slice(2, 4) },
    { cat: 'Treatments', services: services.slice(4, 6) },
  ];

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#FAFAFA' }}>

      {/* Photo grid — LEADS the page (Instagram aesthetic) */}
      {gallery.length > 0 && (
        <div className="grid grid-cols-4 gap-0.5 bg-black">
          {gallery.slice(0, 8).map(img => (
            <div key={img.id} className="aspect-square overflow-hidden">
              <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
            </div>
          ))}
        </div>
      )}

      {/* Identity below gallery */}
      <div style={{ background: BLACK }}>
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4">
            <Avatar src={helper.avatar} name={helper.ownerName} size={72}
              className="ring-2" style={{ '--tw-ring-color': ROSE }} />
            <div className="flex-1">
              <h1 className="text-2xl font-black text-white">{helper.businessName}</h1>
              <p className="text-sm mt-0.5" style={{ color: ROSE }}>{helper.ownerName} · Hair Stylist</p>
              <p className="text-sm mt-1 text-gray-400 italic">{helper.tagline}</p>
            </div>
            <div className="hidden md:flex items-center gap-4">
              {phone && (
                <a href={`tel:${phone}`}
                  className="px-5 py-2.5 rounded-xl text-xs font-black"
                  style={{ background: ROSE_DARK, color: '#fff' }}>
                  Book Now
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 grid md:grid-cols-3 gap-6">

        {/* MAIN */}
        <div className="md:col-span-2 space-y-6">

          {/* Specialty techniques */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead>Signature Techniques</SectionHead>
            <div className="flex flex-wrap gap-2">
              {techniques.map(t => (
                <span key={t} className="px-3 py-1 rounded-full text-xs font-bold"
                  style={{ background: '#FDF2F8', color: ROSE_DARK, border: `1px solid ${ROSE}88` }}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* About */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead>About</SectionHead>
            <p className="text-sm text-gray-600 leading-relaxed">{helper.bio}</p>
          </div>

          {/* Service menu — salon price list style */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead>Service Menu</SectionHead>
            {serviceCategories.map(({ cat, services: svcList }) => (
              svcList.length > 0 && (
                <div key={cat} className="mb-5">
                  <p className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: ROSE_DARK }}>
                    {cat}
                  </p>
                  {svcList.map(s => (
                    <div key={s.id} className="flex justify-between items-center py-2.5"
                      style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                        {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                      </div>
                      {s.price > 0 && <span className="text-sm font-black ms-4" style={{ color: ROSE_DARK }}>${s.price.toFixed(0)}+</span>}
                    </div>
                  ))}
                </div>
              )
            ))}
            {services.length === 0 && (
              <p className="text-sm text-gray-400 italic">Contact for pricing</p>
            )}
          </div>

          {/* Reviews */}
          {reviews.length > 0 && (
            <div>
              <SectionHead>Client Love</SectionHead>
              <div className="grid grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-white shadow-sm" />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="space-y-4">
          <div className="rounded-2xl p-5 shadow-sm" style={{ background: BLACK }}>
            <Avatar src={helper.avatar} name={helper.ownerName} size={56} className="mb-3 ring-2" style={{ '--tw-ring-color': ROSE }} />
            <p className="font-black text-white text-sm">{helper.ownerName}</p>
            <div className="flex items-center gap-1 mt-1">
              <StarRating rating={helper.rating} size={12} color={ROSE} />
              <span className="text-xs text-gray-400 ms-1">{helper.reviewCount} reviews</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">{helper.jobsCompleted} clients served</p>
            <LocationChip city={helper.city} state={helper.state} className="text-gray-500 mt-2 text-xs" />
          </div>

          {phone && (
            <a href={`tel:${phone}`}
              className="flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm text-white"
              style={{ background: ROSE_DARK }}>
              <Scissors size={14} /> Book Appointment
            </a>
          )}

          {helper.badges?.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest mb-3 text-gray-900">Certifications</p>
              <BadgeList badges={helper.badges} badgeClass="bg-pink-50 text-pink-900 border border-pink-200" />
            </div>
          )}

          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <SectionHead className="text-gray-900 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-gray-50 mb-1" questionClass="text-gray-900 text-xs" answerClass="text-gray-600 text-xs" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 8. ACCOUNTANT — Deep navy, trust-first, software chips
// ─────────────────────────────────────────────────────────────
export function AccountantTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const NAVY = '#1E3A5F';
  const GOLD = '#D4A853';
  const LIGHT = '#F0F4F8';

  const software = ['QuickBooks', 'Xero', 'FreshBooks', 'TurboTax', 'Drake', 'NetSuite', 'Excel'];
  const industries = ['Small Business', 'Real Estate', 'Nonprofits', 'E-Commerce', 'Freelancers', 'Startups', 'Healthcare'];

  return (
    <div style={{ background: LIGHT, fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: NAVY, borderBottom: `3px solid ${GOLD}` }}>
        <div className="max-w-4xl mx-auto px-8 py-8">

          {/* Trust signals FIRST */}
          <div className="flex flex-wrap gap-3 mb-6">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-black"
              style={{ background: GOLD, color: NAVY }}>
              <Award size={11} /> CPA Certified
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold"
              style={{ background: 'rgba(212,168,83,0.2)', color: GOLD, border: `1px solid ${GOLD}44` }}>
              <Shield size={11} /> IRS Enrolled Agent
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold"
              style={{ background: 'rgba(212,168,83,0.2)', color: GOLD, border: `1px solid ${GOLD}44` }}>
              <Clock size={11} /> {helper.jobsCompleted ?? 12}+ Years Experience
            </span>
          </div>

          <div className="flex items-start gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={80}
              className="ring-2" style={{ '--tw-ring-color': GOLD }} />
            <div className="flex-1">
              <h1 className="text-2xl font-black text-white">{helper.businessName}</h1>
              <p className="text-sm mt-0.5" style={{ color: GOLD }}>{helper.ownerName}, CPA</p>
              <p className="text-sm mt-1 text-blue-300">{helper.tagline}</p>
              <div className="flex flex-wrap gap-3 mt-3">
                <LocationChip city={helper.city} state={helper.state} className="text-blue-300" />
                {phone && <a href={`tel:${phone}`} className="text-sm font-bold flex items-center gap-1" style={{ color: GOLD }}><Phone size={13}/> {phone}</a>}
              </div>
            </div>
            <div className="hidden md:flex gap-5 text-center">
              {[
                { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
                { v: helper.reviewCount ?? 0, l: 'Reviews' },
                { v: `${helper.jobsCompleted ?? 0}+`, l: 'Clients' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-2xl font-black" style={{ color: GOLD }}>{s.v}</div>
                  <div className="text-xs text-blue-300">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-8 grid md:grid-cols-3 gap-6">

        {/* MAIN */}
        <div className="md:col-span-2 space-y-5">

          {/* Confidentiality notice */}
          <div className="rounded-xl p-4 flex items-start gap-3"
            style={{ background: `${NAVY}15`, border: `1px solid ${NAVY}33` }}>
            <Shield size={16} style={{ color: NAVY, flexShrink: 0, marginTop: 2 }} />
            <p className="text-xs text-slate-700 leading-relaxed">
              All financial information shared is held in strict confidence. Client data is never shared with third parties. Engagement letters provided for all services.
            </p>
          </div>

          {/* Bio */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <SectionHead className="text-slate-900">About</SectionHead>
            <p className="text-sm text-slate-600 leading-relaxed">{helper.bio}</p>
          </div>

          {/* Software */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-slate-900">Software Expertise</SectionHead>
            <div className="flex flex-wrap gap-2">
              {software.map(s => (
                <TechChip key={s} label={s} bgClass="bg-slate-100" textClass="text-slate-800" />
              ))}
            </div>
          </div>

          {/* Industries served */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-slate-900">Industries Served</SectionHead>
            <div className="flex flex-wrap gap-2">
              {industries.map(i => (
                <span key={i} className="px-3 py-1 rounded text-xs font-semibold"
                  style={{ background: `${NAVY}12`, color: NAVY }}>
                  {i}
                </span>
              ))}
            </div>
          </div>

          {/* Services */}
          {services.length > 0 && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <SectionHead className="text-slate-900">Services</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor={GOLD}
                    bgClass="bg-slate-50" textClass="text-slate-900" priceClass="font-black text-amber-700" />
                ))}
              </div>
            </div>
          )}

          {/* Reviews */}
          {reviews.length > 0 && (
            <div>
              <SectionHead className="text-slate-900">Client Reviews</SectionHead>
              <div className="grid grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-white shadow-sm" />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SIDEBAR */}
        <div className="space-y-4">
          <div className="rounded-2xl p-5 shadow-sm" style={{ background: NAVY }}>
            <p className="text-xs font-black uppercase tracking-widest mb-3" style={{ color: GOLD }}>Contact</p>
            <ContactRow phone={phone} website={website} linkClass="text-blue-300" />
            <LocationChip city={helper.city} state={helper.state} className="text-blue-300 mt-2" />
            <p className="text-xs text-blue-400 mt-3">Free 30-min consultation available</p>
          </div>

          {helper.badges?.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest mb-3 text-slate-900">Credentials</p>
              <BadgeList badges={helper.badges} badgeClass="bg-amber-50 text-amber-900 border border-amber-200" />
            </div>
          )}

          {phone && (
            <a href={`tel:${phone}`}
              className="block text-center py-3 rounded-xl font-black text-sm"
              style={{ background: GOLD, color: NAVY }}>
              Schedule Consultation
            </a>
          )}

          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <SectionHead className="text-slate-900 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-slate-50 mb-1"
                questionClass="text-slate-900 text-xs" answerClass="text-slate-600 text-xs" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 9. MATH TUTOR — Light blue/indigo, grade levels, subjects grid
// ─────────────────────────────────────────────────────────────
export function MathTutorTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const INDIGO = '#4F46E5';
  const LIGHT_BLUE = '#EFF6FF';

  const gradeLevels = ['Elementary', 'Middle School', 'High School', 'AP / IB', 'College', 'Test Prep'];
  const subjects = [
    'Pre-Algebra', 'Algebra I & II', 'Geometry', 'Trigonometry',
    'Pre-Calculus', 'Calculus (AB/BC)', 'Statistics', 'Linear Algebra',
    'Differential Equations', 'SAT Math', 'ACT Math', 'GRE Quant',
  ];
  const formats = ['In-Person', 'Online (Zoom)', 'Hybrid', 'Group Sessions', 'Intensive Bootcamp'];

  return (
    <div style={{ background: '#F8FAFF', fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${INDIGO} 0%, #6366F1 100%)` }}>
        <div className="max-w-3xl mx-auto px-6 py-10 text-center text-white">
          <div className="flex justify-center mb-4">
            <BookOpen size={32} className="opacity-80" />
          </div>
          <Avatar src={helper.avatar} name={helper.ownerName} size={80}
            className="mx-auto mb-4 ring-4 ring-white ring-opacity-30" />
          <h1 className="text-2xl font-black">{helper.businessName}</h1>
          <p className="text-sm mt-1 opacity-80">{helper.ownerName} · Math Tutor</p>
          <p className="text-sm mt-2 italic opacity-70">{helper.tagline}</p>

          {/* Grade level pills */}
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {gradeLevels.map(g => (
              <span key={g} className="px-3 py-1 rounded-full text-xs font-bold"
                style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)' }}>
                {g}
              </span>
            ))}
          </div>

          <div className="flex justify-center gap-8 mt-6">
            {[
              { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
              { v: helper.reviewCount ?? 0, l: 'Reviews' },
              { v: helper.jobsCompleted ?? 0, l: 'Students' },
            ].map(s => (
              <div key={s.l}>
                <div className="text-2xl font-black">{s.v}</div>
                <div className="text-xs opacity-60">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body — centered single column */}
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* About */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <SectionHead style={{ color: INDIGO }}>About</SectionHead>
          <p className="text-sm text-slate-600 leading-relaxed">{helper.bio}</p>
          {helper.badges?.length > 0 && (
            <div className="mt-4">
              <BadgeList badges={helper.badges} badgeClass="bg-indigo-50 text-indigo-900 border border-indigo-200" />
            </div>
          )}
        </div>

        {/* Subjects grid */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <SectionHead style={{ color: INDIGO }}>Subjects Covered</SectionHead>
          <div className="grid grid-cols-3 gap-2">
            {subjects.map(s => (
              <span key={s} className="text-center px-2 py-2 rounded-lg text-xs font-semibold"
                style={{ background: LIGHT_BLUE, color: INDIGO }}>
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Session formats */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <SectionHead style={{ color: INDIGO }}>Session Formats</SectionHead>
          <div className="space-y-2">
            {formats.map(f => (
              <ChecklistRow key={f} iconColor={INDIGO} textClass="text-slate-700">{f}</ChecklistRow>
            ))}
          </div>
        </div>

        {/* Pricing / packages */}
        {services.length > 0 && (
          <div>
            <SectionHead style={{ color: INDIGO }}>Packages &amp; Rates</SectionHead>
            <div className="grid md:grid-cols-2 gap-3">
              {services.map(s => (
                <HorizontalServiceBar key={s.id} service={s} accentColor={INDIGO}
                  bgClass="bg-white shadow-sm" textClass="text-slate-900" priceClass="text-indigo-700 font-black" />
              ))}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <SectionHead style={{ color: INDIGO }}>How We Work</SectionHead>
          <div className="space-y-4">
            <ProcessStep number={1} title="Free Assessment" description="15-min call to understand learning style and gaps" numBg={INDIGO} textClass="text-slate-900" />
            <ProcessStep number={2} title="Personalized Plan" description="Custom curriculum targeting problem areas first" numBg={INDIGO} textClass="text-slate-900" />
            <ProcessStep number={3} title="Weekly Sessions" description="Interactive sessions with worked examples and practice problems" numBg={INDIGO} textClass="text-slate-900" />
            <ProcessStep number={4} title="Track Progress" description="End-of-month summary reports shared with student and parent" numBg={INDIGO} textClass="text-slate-900" />
          </div>
        </div>

        {/* Reviews */}
        {reviews.length > 0 && (
          <div>
            <SectionHead style={{ color: INDIGO }}>Student & Parent Reviews</SectionHead>
            <div className="grid md:grid-cols-2 gap-3">
              {reviews.slice(0, 4).map(r => (
                <ReviewCard key={r.id} review={r} cardClass="bg-white shadow-sm" />
              ))}
            </div>
          </div>
        )}

        {/* Contact */}
        <div className="rounded-2xl p-6 text-center shadow-sm"
          style={{ background: `linear-gradient(135deg, ${INDIGO} 0%, #6366F1 100%)` }}>
          <p className="font-black text-white mb-1">Ready to improve your grades?</p>
          <p className="text-sm text-indigo-200 mb-4">First session free for new students</p>
          {phone && (
            <a href={`tel:${phone}`}
              className="inline-block px-6 py-3 rounded-xl font-black text-sm"
              style={{ background: '#fff', color: INDIGO }}>
              Book Free Session: {phone}
            </a>
          )}
        </div>

        {faqs.length > 0 && (
          <div>
            <SectionHead style={{ color: INDIGO }}>FAQ</SectionHead>
            <FAQList faqs={faqs} itemClass="bg-white shadow-sm"
              questionClass="text-slate-900" answerClass="text-slate-600" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 10. PARTY ENTERTAINER — Purple/confetti, fun, age groups, packages
// ─────────────────────────────────────────────────────────────
export function PartyEntertainerTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const PURPLE = '#7C3AED';
  const LIGHT_PURPLE = '#EDE9FE';

  const ageGroups = ['Toddlers (1-3)', 'Kids (4-8)', 'Tweens (9-12)', 'Teens', 'Adults', 'All Ages'];
  const entertainmentTypes = ['Magic Shows', 'Balloon Twisting', 'Face Painting', 'Clown', 'DJ', 'Petting Zoo', 'Science Show', 'Character Visit', 'Juggling'];
  const confettiColors = ['#F472B6', '#FB923C', '#FACC15', '#4ADE80', '#60A5FA', '#A78BFA'];

  const packages = [
    { name: 'Starter', price: 149, duration: '1 hour', features: ['1 entertainer', 'Core activity', 'Up to 15 kids'] },
    { name: 'Party Pack', price: 249, duration: '2 hours', features: ['1 entertainer', '2 activities', 'Up to 30 kids', 'Props included'], highlight: true },
    { name: 'Ultimate', price: 399, duration: '3 hours', features: ['2 entertainers', '3 activities', 'Unlimited guests', 'Costume included', 'Photo moments'] },
  ];

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#FAFAF9' }}>

      {/* Confetti header */}
      <div style={{ background: PURPLE, position: 'relative', overflow: 'hidden' }}>
        {/* Decorative confetti dots */}
        {confettiColors.map((c, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: 12 + i * 4,
            height: 12 + i * 4,
            borderRadius: '50%',
            background: c,
            opacity: 0.6,
            top: `${10 + i * 15}%`,
            left: `${5 + i * 16}%`,
          }} />
        ))}
        {confettiColors.map((c, i) => (
          <div key={`r${i}`} style={{
            position: 'absolute',
            width: 8 + i * 3,
            height: 8 + i * 3,
            borderRadius: '2px',
            background: c,
            opacity: 0.5,
            top: `${20 + i * 12}%`,
            right: `${5 + i * 14}%`,
            transform: `rotate(${i * 30}deg)`,
          }} />
        ))}

        <div className="max-w-4xl mx-auto px-6 py-10 text-center relative z-10 text-white">
          <div className="flex justify-center mb-3">
            <PartyPopper size={36} className="opacity-90" />
          </div>
          <Avatar src={helper.avatar} name={helper.ownerName} size={88}
            className="mx-auto mb-4 ring-4 ring-white ring-opacity-40" />
          <h1 className="text-3xl font-black" style={{ letterSpacing: '-1px' }}>{helper.businessName}</h1>
          <p className="text-sm mt-1 opacity-80">{helper.ownerName} · Party Entertainer</p>
          <p className="text-sm mt-2 italic opacity-70">{helper.tagline}</p>

          {/* Entertainment types */}
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {entertainmentTypes.map((t, i) => (
              <span key={t} className="px-3 py-1 rounded-full text-xs font-bold"
                style={{ background: confettiColors[i % confettiColors.length] + '33', border: `1px solid ${confettiColors[i % confettiColors.length]}66`, color: '#fff' }}>
                {t}
              </span>
            ))}
          </div>

          <div className="flex justify-center gap-8 mt-6">
            {[
              { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
              { v: helper.reviewCount ?? 0, l: 'Reviews' },
              { v: `${helper.jobsCompleted ?? 0}+`, l: 'Parties' },
            ].map(s => (
              <div key={s.l}>
                <div className="text-2xl font-black">{s.v}</div>
                <div className="text-xs opacity-60">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Age groups */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SectionHead style={{ color: PURPLE }}>Perfect For</SectionHead>
          <div className="flex flex-wrap gap-2">
            {ageGroups.map((g, i) => (
              <span key={g} className="px-4 py-2 rounded-full text-xs font-black"
                style={{ background: confettiColors[i % confettiColors.length] + '22', color: PURPLE, border: `1px solid ${confettiColors[i % confettiColors.length]}66` }}>
                {g}
              </span>
            ))}
          </div>
        </div>

        {/* Bio */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SectionHead style={{ color: PURPLE }}>About the Show</SectionHead>
          <p className="text-sm text-gray-600 leading-relaxed">{helper.bio}</p>
        </div>

        {/* Packages — 3 col */}
        <div>
          <SectionHead style={{ color: PURPLE }}>Party Packages 🎉</SectionHead>
          <div className="grid md:grid-cols-3 gap-4">
            {packages.map(p => (
              <div key={p.name}
                className="rounded-2xl p-5 shadow-sm text-center"
                style={{
                  background: p.highlight ? PURPLE : '#fff',
                  border: p.highlight ? 'none' : `2px solid ${LIGHT_PURPLE}`,
                  color: p.highlight ? '#fff' : '#111',
                }}>
                <p className="text-xs font-black uppercase tracking-widest mb-1"
                  style={{ color: p.highlight ? 'rgba(255,255,255,0.7)' : PURPLE }}>
                  {p.name}
                </p>
                <p className="text-3xl font-black">${p.price}</p>
                <p className="text-xs mt-0.5 mb-4 opacity-70">{p.duration}</p>
                <div className="space-y-1.5 text-start">
                  {p.features.map(f => (
                    <div key={f} className="flex items-center gap-2 text-xs">
                      <Check size={11} style={{ flexShrink: 0, opacity: 0.8 }} />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Custom services from profile */}
        {services.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead style={{ color: PURPLE }}>Add-Ons &amp; Custom Bookings</SectionHead>
            <div className="grid md:grid-cols-2 gap-3">
              {services.map(s => (
                <HorizontalServiceBar key={s.id} service={s} accentColor={PURPLE}
                  bgClass="bg-violet-50" textClass="text-gray-900" priceClass="text-violet-700 font-black" />
              ))}
            </div>
          </div>
        )}

        {/* Gallery */}
        {gallery.length > 0 && (
          <div>
            <SectionHead style={{ color: PURPLE }}>Party Highlights 📸</SectionHead>
            <GalleryGrid gallery={gallery} cols={3} rounded="rounded-2xl" />
          </div>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <div>
            <SectionHead style={{ color: PURPLE }}>What Families Say</SectionHead>
            <div className="grid md:grid-cols-2 gap-3">
              {reviews.slice(0, 4).map(r => (
                <ReviewCard key={r.id} review={r} cardClass="bg-white shadow-sm" />
              ))}
            </div>
          </div>
        )}

        {/* Book CTA */}
        <div className="rounded-2xl p-8 text-center shadow-sm" style={{ background: PURPLE }}>
          <PartyPopper size={28} className="mx-auto mb-3 text-yellow-300" />
          <p className="text-xl font-black text-white mb-1">Make It Unforgettable! 🎈</p>
          <p className="text-sm text-purple-200 mb-5">Book early, weekends fill up fast</p>
          {phone && (
            <a href={`tel:${phone}`}
              className="inline-block px-8 py-4 rounded-2xl font-black text-sm"
              style={{ background: '#FACC15', color: PURPLE }}>
              Book My Party: {phone}
            </a>
          )}
        </div>

        {faqs.length > 0 && (
          <div>
            <SectionHead style={{ color: PURPLE }}>FAQ</SectionHead>
            <FAQList faqs={faqs} itemClass="bg-white shadow-sm"
              questionClass="text-gray-900" answerClass="text-gray-600" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 11. CAR DEALERSHIP — Showroom dark, metallic silver + red, inventory-style layout
// ─────────────────────────────────────────────────────────────
export function CarDealershipTemplate({ profileData }) {
  const { helper, services = [], gallery = [], reviews = [], faqs = [], phone, website } = profileData;
  const CHARCOAL = '#0A0A0F';
  const RED = '#DC2626';
  const SILVER = '#94A3B8';
  const LIGHT = '#F1F5F9';

  const brands = ['Ford', 'Toyota', 'Honda', 'Chevrolet', 'BMW', 'Mercedes', 'Audi', 'Hyundai', 'Subaru', 'Jeep'];
  const vehicleTypes = [
    { icon: '🚗', label: 'Sedans' },
    { icon: '🚙', label: 'SUVs' },
    { icon: '🛻', label: 'Trucks' },
    { icon: '⚡', label: 'EVs' },
    { icon: '🏎️', label: 'Sports' },
    { icon: '💎', label: 'Luxury' },
    { icon: '🚐', label: 'Vans' },
    { icon: '🔄', label: 'Trade-Ins' },
  ];

  const dealerServices = [
    { icon: '🔑', name: 'New Vehicle Sales', desc: 'Latest models from top brands with factory incentives' },
    { icon: '🚘', name: 'Certified Pre-Owned', desc: 'Inspected, warrantied used vehicles you can trust' },
    { icon: '💰', name: 'Financing & Leasing', desc: 'Competitive rates, all credit types welcome' },
    { icon: '🔄', name: 'Trade-In Appraisal', desc: 'Instant offer, trade toward your next vehicle' },
    { icon: '🔧', name: 'Service & Parts', desc: 'Factory-trained technicians, genuine OEM parts' },
    { icon: '📋', name: 'Extended Warranties', desc: 'Coverage plans for any budget, no surprises' },
  ];

  return (
    <div style={{ background: LIGHT, fontFamily: 'system-ui, sans-serif', minHeight: '100vh' }}>

      {/* HERO — full-bleed cover photo or gradient showroom */}
      <div style={{ position: 'relative', height: 280, overflow: 'hidden', background: CHARCOAL }}>
        {helper.coverImage ? (
          <img
            src={helper.coverImage}
            alt="Dealership"
            className="w-full h-full object-cover"
            style={{ opacity: 0.5 }}
            loading="lazy"
          />
        ) : (
          /* Showroom gradient abstraction */
          <div style={{
            position: 'absolute', inset: 0,
            background: `linear-gradient(135deg, ${CHARCOAL} 0%, #1E293B 50%, #0F172A 100%)`,
          }}>
            {/* Decorative chrome grid lines */}
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: `${10 + i * 16}%`,
                top: 0,
                bottom: 0,
                width: 1,
                background: `linear-gradient(to bottom, transparent, ${SILVER}22, transparent)`,
              }} />
            ))}
          </div>
        )}

        {/* Red bottom accent stripe */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: RED }} />

        {/* Dealer badge overlay */}
        <div style={{ position: 'absolute', top: 24, left: 24 }}>
          <div style={{ background: RED, color: '#fff', padding: '6px 14px', borderRadius: 4, fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Car size={12} />
            Licensed Dealership
          </div>
        </div>

        {/* Stats overlay bottom-right */}
        <div style={{ position: 'absolute', bottom: 20, right: 24, display: 'flex', gap: 24, textAlign: 'center' }}>
          {[
            { v: helper.rating?.toFixed(1) ?? '—', l: 'Rating' },
            { v: `${helper.reviewCount ?? 0}`, l: 'Reviews' },
            { v: `${helper.jobsCompleted ?? 0}+`, l: 'Vehicles Sold' },
          ].map(s => (
            <div key={s.l}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{s.v}</div>
              <div style={{ fontSize: 10, color: SILVER, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Identity bar */}
      <div style={{ background: CHARCOAL, borderBottom: `1px solid #1E293B` }}>
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center gap-4">
            <Avatar src={helper.avatar} name={helper.ownerName} size={64}
              className="ring-2 rounded-xl" style={{ '--tw-ring-color': RED, borderRadius: 12 }} />
            <div className="flex-1">
              <h1 className="text-xl font-black text-white leading-tight">{helper.businessName}</h1>
              <p className="text-sm mt-0.5" style={{ color: SILVER }}>{helper.ownerName}</p>
              <LocationChip city={helper.city} state={helper.state} className="mt-1" style={{ color: SILVER, fontSize: 12 }} />
            </div>
            <div className="hidden md:flex items-center gap-3">
              {phone && (
                <a href={`tel:${phone}`}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-black"
                  style={{ background: RED, color: '#fff' }}>
                  <Phone size={13} /> Call Dealer
                </a>
              )}
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
                  style={{ background: '#1E293B', color: SILVER, border: `1px solid #334155` }}>
                  <Globe size={13} /> Website
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="max-w-5xl mx-auto px-6 py-8 grid md:grid-cols-3 gap-6">

        {/* MAIN — 2/3 */}
        <div className="md:col-span-2 space-y-6">

          {/* Brands we carry */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-slate-900">Brands We Carry</SectionHead>
            <div className="flex flex-wrap gap-2">
              {brands.map(b => (
                <span key={b}
                  className="px-3 py-1.5 rounded text-xs font-black tracking-wide"
                  style={{ background: LIGHT, color: '#1E293B', border: '1px solid #CBD5E1' }}>
                  {b}
                </span>
              ))}
            </div>
          </div>

          {/* Vehicle types — icon tile grid */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-slate-900">Inventory Types</SectionHead>
            <div className="grid grid-cols-4 gap-3">
              {vehicleTypes.map(v => (
                <div key={v.label} className="text-center py-4 rounded-xl"
                  style={{ background: LIGHT }}>
                  <div className="text-2xl mb-1">{v.icon}</div>
                  <p className="text-xs font-bold text-slate-700">{v.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* About */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-slate-900">About Us</SectionHead>
            <p className="text-sm text-slate-600 leading-relaxed">{helper.bio}</p>
          </div>

          {/* Dealer services — 2-col icon cards */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <SectionHead className="text-slate-900">What We Offer</SectionHead>
            <div className="grid grid-cols-2 gap-3">
              {dealerServices.map(s => (
                <div key={s.name} className="rounded-xl p-4 flex gap-3 items-start"
                  style={{ background: LIGHT }}>
                  <span className="text-xl flex-shrink-0">{s.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-snug">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom services from profile (pricing) */}
          {services.length > 0 && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <SectionHead className="text-slate-900">Pricing &amp; Specials</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor={RED}
                    bgClass="bg-slate-50" textClass="text-slate-900" priceClass="text-red-600 font-black" />
                ))}
              </div>
            </div>
          )}

          {/* Financing info box */}
          <div className="rounded-2xl p-5 shadow-sm"
            style={{ background: CHARCOAL, border: `1px solid #1E293B` }}>
            <div className="flex items-start gap-3">
              <DollarSign size={20} style={{ color: RED, flexShrink: 0, marginTop: 2 }} />
              <div>
                <p className="font-black text-white mb-2">Financing Available</p>
                <div className="space-y-1">
                  {[
                    'All credit types welcome: good, fair, and rebuilding',
                    'Pre-approval in minutes, no hard credit hit',
                    'Terms from 24 to 84 months available',
                    'Trade-in value applied directly to your down payment',
                  ].map(t => (
                    <ChecklistRow key={t} iconColor={RED} textClass="text-slate-300">{t}</ChecklistRow>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Lot photo gallery */}
          {gallery.length > 0 && (
            <div>
              <SectionHead className="text-slate-900">Our Lot</SectionHead>
              <div className="grid grid-cols-4 gap-1.5">
                {gallery.slice(0, 8).map((img, i) => (
                  <div key={img.id}
                    className="overflow-hidden rounded-xl"
                    style={{ aspectRatio: i === 0 ? '16/9' : '1/1', gridColumn: i === 0 ? 'span 2' : 'span 1' }}>
                    <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reviews */}
          {reviews.length > 0 && (
            <div>
              <SectionHead className="text-slate-900">Customer Reviews</SectionHead>
              <div className="grid grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-white shadow-sm" />
                ))}
              </div>
            </div>
          )}

          {faqs.length > 0 && (
            <div>
              <SectionHead className="text-slate-900">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-white shadow-sm"
                questionClass="text-slate-900" answerClass="text-slate-600" />
            </div>
          )}
        </div>

        {/* SIDEBAR — 1/3 */}
        <div className="space-y-4">

          {/* Contact card */}
          <div className="rounded-2xl p-5 shadow-sm" style={{ background: CHARCOAL }}>
            <p className="text-xs font-black uppercase tracking-widest mb-4" style={{ color: RED }}>Visit or Call</p>
            {phone && (
              <a href={`tel:${phone}`}
                className="flex items-center gap-2 py-3 px-4 rounded-xl font-black text-sm mb-3"
                style={{ background: RED, color: '#fff' }}>
                <Phone size={14} /> {phone}
              </a>
            )}
            <ContactRow phone={undefined} website={website} linkClass="text-slate-400" />
            <LocationChip city={helper.city} state={helper.state} className="text-slate-400 mt-2" />
          </div>

          {/* Hours */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest mb-3 text-slate-900">Showroom Hours</p>
            {[
              { d: 'Mon – Fri', h: '9 AM – 8 PM' },
              { d: 'Saturday',  h: '9 AM – 7 PM' },
              { d: 'Sunday',    h: '11 AM – 5 PM' },
            ].map(r => (
              <div key={r.d} className="flex justify-between py-2"
                style={{ borderBottom: '1px solid #F1F5F9' }}>
                <span className="text-xs text-slate-500">{r.d}</span>
                <span className="text-xs font-bold text-slate-900">{r.h}</span>
              </div>
            ))}
          </div>

          {/* Test drive CTA */}
          {phone && (
            <div className="rounded-2xl p-5 text-center shadow-sm" style={{ background: RED }}>
              <Key size={22} className="mx-auto mb-2 text-white" />
              <p className="font-black text-white text-sm mb-1">Schedule a Test Drive</p>
              <p className="text-xs text-red-200 mb-3">No commitment, just come in</p>
              <a href={`tel:${phone}`}
                className="block py-2.5 px-4 rounded-xl text-xs font-black"
                style={{ background: '#fff', color: RED }}>
                Book Now
              </a>
            </div>
          )}

          {/* Why choose us */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest mb-3 text-slate-900">Why Choose Us</p>
            {[
              'No-pressure sales environment',
              'Carfax reports on every vehicle',
              'Price-match guarantee',
              'Military &amp; first-responder discounts',
              'Free loaner cars during service',
            ].map(t => (
              <ChecklistRow key={t} iconColor={RED} textClass="text-slate-700">{t}</ChecklistRow>
            ))}
          </div>

          {/* Badges */}
          {helper.badges?.length > 0 && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest mb-3 text-slate-900">Accreditations</p>
              <BadgeList badges={helper.badges} badgeClass="bg-slate-100 text-slate-800 border border-slate-200" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
