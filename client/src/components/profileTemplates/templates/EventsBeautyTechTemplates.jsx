// EventsBeautyTechTemplates.jsx — Events, Beauty & Tech templates (10 templates)
// Each has a fully distinct layout, color palette, section ordering, and industry-specific content.
import {
  StarRating, Avatar, BadgeList, GalleryGrid, ReviewCard, FAQList,
  LocationChip, ContactRow, SectionHead, HorizontalServiceBar,
  SpecialtyPill, QuoteBlock, TechChip, ChecklistRow, PackageCard,
  ProcessStep, CredentialItem, MasonryGallery,
} from '../shared.jsx';
import { Calendar, Code, Shield, Star, Scissors, Cpu, Globe, Briefcase, Scale, Zap } from 'lucide-react';

// ─── 21. EVENTS & ENTERTAINMENT ────────────────────────────────────────────
// Event showcase first — gallery of past events leads.
// Deep celebration purple/gold. Past event types as chips.
export function EventsEntertainmentTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const eventTypes = ['Corporate Events', 'Birthday Parties', 'Weddings', 'Baby Showers', 'Graduations', 'Holiday Parties', 'Fundraisers', 'Product Launches'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#0d0a1a', color: '#f5f0ff' }}>
      {/* Celebration hero with gallery */}
      {gallery.length > 0 && (
        <div className="relative h-72 overflow-hidden">
          <img src={gallery[0].url} alt="event" className="w-full h-full object-cover opacity-70" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(13,10,26,0.95) 85%)' }} />
        </div>
      )}
      {!gallery.length && (
        <div className="h-40" style={{ background: 'linear-gradient(135deg, #4c1d95 0%, #6d28d9 50%, #7c3aed 100%)' }} />
      )}

      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-start gap-5 -mt-12 relative z-10">
          <Avatar src={helper.avatar} name={helper.ownerName} size={88}
            className="border-4 flex-shrink-0" style={{ borderColor: '#c4b5fd', background: '#2d1a6e', color: '#ddd6fe' }} />
          <div className="pt-2 flex-1">
            <span className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: '#c4b5fd' }}>
              Events & Entertainment Professional
            </span>
            <h1 className="text-3xl font-black mt-0.5">{helper.businessName}</h1>
            <p style={{ color: '#a78bfa' }} className="text-sm mt-0.5">{helper.tagline}</p>
            <div className="flex items-center gap-3 mt-2">
              <StarRating rating={helper.rating} color="#c4b5fd" size={13} />
              <span style={{ color: '#7c3aed' }} className="text-xs">{helper.reviewCount} events</span>
              <LocationChip city={helper.city} state={helper.state} className="text-purple-400 text-xs" />
            </div>
          </div>
        </div>

        <div className="mt-8 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            {/* Event types */}
            <section className="rounded-2xl p-5" style={{ background: '#1a1030', border: '1px solid #2d1a6e' }}>
              <SectionHead className="text-purple-300">Events I Specialize In</SectionHead>
              <div className="flex flex-wrap gap-2">
                {eventTypes.map(e => (
                  <SpecialtyPill key={e} label={e} pillClass="text-purple-200 text-xs bg-purple-950 border border-purple-800" />
                ))}
              </div>
            </section>

            {helper.bio && (
              <section className="rounded-2xl p-5" style={{ background: '#1a1030', border: '1px solid #2d1a6e' }}>
                <SectionHead className="text-purple-300">About Me</SectionHead>
                <p style={{ color: '#c4b5fd' }} className="leading-relaxed text-sm">{helper.bio}</p>
              </section>
            )}

            {services.length > 0 && (
              <section className="rounded-2xl p-5" style={{ background: '#1a1030', border: '1px solid #2d1a6e' }}>
                <SectionHead className="text-purple-300">Services & Packages</SectionHead>
                <div className="space-y-2">
                  {services.map(s => (
                    <HorizontalServiceBar key={s.id} service={s} accentColor="#7c3aed"
                      bgClass="" textClass="text-white" priceClass="text-purple-300"
                      style={{ background: '#231545' }} />
                  ))}
                </div>
              </section>
            )}

            {gallery.length > 1 && (
              <section className="rounded-2xl p-5" style={{ background: '#1a1030', border: '1px solid #2d1a6e' }}>
                <SectionHead className="text-purple-300">Past Events</SectionHead>
                <GalleryGrid gallery={gallery.slice(1)} cols={3} rounded="rounded-xl" />
              </section>
            )}

            {reviews.length > 0 && (
              <section className="rounded-2xl p-5" style={{ background: '#1a1030', border: '1px solid #2d1a6e' }}>
                <SectionHead className="text-purple-300">Client Reviews</SectionHead>
                <div className="space-y-4">
                  {reviews.slice(0, 3).map(r => (
                    <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                      accentColor="#7c3aed" textClass="text-purple-100" authorClass="text-purple-400" />
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #4c1d95, #6d28d9)' }}>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { v: helper.jobsCompleted ?? 0, l: 'Events' },
                  { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
                  { v: `${helper.reviewCount}+`, l: 'Reviews' },
                ].map(s => (
                  <div key={s.l}>
                    <div className="text-xl font-black">{s.v}</div>
                    <div className="text-xs text-purple-300">{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
            {helper.badges.length > 0 && (
              <div className="rounded-2xl p-5" style={{ background: '#1a1030', border: '1px solid #2d1a6e' }}>
                <BadgeList badges={helper.badges} badgeClass="text-purple-300 bg-purple-950 border border-purple-800" />
              </div>
            )}
            <div className="rounded-2xl p-5" style={{ background: '#1a1030', border: '1px solid #2d1a6e' }}>
              <ContactRow phone={phone} website={website} linkClass="text-purple-400 hover:text-purple-300 text-sm" />
            </div>
            {faqs.length > 0 && (
              <div className="rounded-2xl p-5" style={{ background: '#1a1030', border: '1px solid #2d1a6e' }}>
                <SectionHead className="text-purple-300 text-sm">FAQ</SectionHead>
                <FAQList faqs={faqs} itemClass="bg-purple-950 border border-purple-900"
                  questionClass="text-white text-sm" answerClass="text-purple-300" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 22. CATERING & FOOD ──────────────────────────────────────────────────────
// Restaurant-menu inspired layout. Cuisine categories. Dark warm/cream.
// Sample menu items displayed. Dietary accommodation icons.
export function CateringFoodTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const cuisines = ['American', 'Italian', 'Mexican', 'Mediterranean', 'Asian Fusion', 'BBQ', 'Vegan', 'Farm-to-Table'];
  const dietary = ['Vegan', 'Vegetarian', 'Gluten-Free', 'Nut-Free', 'Halal', 'Kosher', 'Dairy-Free'];
  const eventTypes = ['Corporate Lunches', 'Wedding Receptions', 'Birthday Parties', 'Meal Prep Services', 'Holiday Dinners', 'Cocktail Receptions'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#faf6f1', color: '#2c1810' }}>
      {/* Warm restaurant header */}
      <div style={{ background: 'linear-gradient(135deg, #78350f 0%, #92400e 60%, #b45309 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="border-4 flex-shrink-0"
              style={{ borderColor: 'rgba(255,255,255,0.35)', background: '#431407', color: '#fcd34d' }} />
            <div className="flex-1">
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-amber-300 block mb-1">Catering & Food Services</span>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p className="text-amber-100 text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#fcd34d" size={13} />
                <span className="text-amber-200 text-xs">{helper.reviewCount} events catered</span>
                <LocationChip city={helper.city} state={helper.state} className="text-amber-200 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Cuisine types */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
            <SectionHead className="text-amber-800">Cuisine Specialties</SectionHead>
            <div className="flex flex-wrap gap-2">
              {cuisines.map(c => (
                <span key={c} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#78350f' }}>{c}</span>
              ))}
            </div>
          </section>

          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
              <SectionHead className="text-amber-800">About the Chef</SectionHead>
              <p style={{ color: '#2c1810' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {/* Services as menu */}
          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
              <SectionHead className="text-amber-800">Services & Packages</SectionHead>
              <div className="divide-y divide-amber-100">
                {services.map(s => (
                  <div key={s.id} className="py-4 flex justify-between items-start gap-4">
                    <div>
                      <p className="font-bold text-amber-900">{s.name}</p>
                      {s.description && <p className="text-sm text-amber-700 mt-1">{s.description}</p>}
                    </div>
                    {s.price > 0 && (
                      <span className="font-bold whitespace-nowrap" style={{ color: '#78350f' }}>
                        ${s.price.toFixed(0)}/{s.priceUnit}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
              <SectionHead className="text-amber-800">From Our Kitchen</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
              <SectionHead className="text-amber-800">Client Reviews</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 3).map(r => (
                  <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                    accentColor="#d97706" textClass="text-amber-900" authorClass="text-amber-600" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {/* Event types */}
          <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-3">Events I Cater</p>
            {eventTypes.map(e => (
              <ChecklistRow key={e} iconColor="#d97706" textClass="text-amber-900 text-xs">{e}</ChecklistRow>
            ))}
          </div>
          {/* Dietary */}
          <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-3">Dietary Accommodations</p>
            <div className="flex flex-wrap gap-2">
              {dietary.map(d => (
                <span key={d} className="px-2 py-1 rounded-lg text-xs"
                  style={{ background: '#fef3c7', color: '#78350f', border: '1px solid #fde68a' }}>{d}</span>
              ))}
            </div>
          </div>
          {helper.badges.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
              <BadgeList badges={helper.badges} badgeClass="bg-amber-100 text-amber-800 border border-amber-200" />
            </div>
          )}
          <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-amber-700 hover:text-amber-900" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
              <SectionHead className="text-amber-800 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-amber-50" questionClass="text-amber-900" answerClass="text-amber-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 23. WEDDING SERVICES ─────────────────────────────────────────────────────
// Romantic editorial. Champagne/blush palette. Service tiers. Real weddings gallery.
export function WeddingServicesTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const weddingServices = ['Day-of Coordination', 'Full Planning', 'Venue Styling', 'Floral Design', 'Catering Coordination', 'Vendor Management'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#fdf8f5', color: '#2d1515' }}>
      {/* Romantic hero */}
      <div className="relative overflow-hidden" style={{ minHeight: 300 }}>
        {gallery.length > 0
          ? <img src={gallery[0].url} alt="wedding" className="w-full h-80 object-cover" />
          : <div className="h-72" style={{ background: 'linear-gradient(135deg, #fce7f3 0%, #fda4af 50%, #fb7185 100%)' }} />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 30%, rgba(45,21,21,0.85) 100%)' }} />
        <div className="absolute bottom-0 left-0 right-0 px-8 py-6 text-white text-center">
          <span className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: '#fda4af' }}>
            Wedding & Event Services
          </span>
          <h1 className="text-4xl font-bold mt-1 drop-shadow-lg">{helper.businessName}</h1>
          <p style={{ color: '#fce7f3' }} className="text-sm mt-1">{helper.tagline}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        {/* Profile row */}
        <div className="flex items-center gap-5 pb-6 border-b border-pink-100">
          <Avatar src={helper.avatar} name={helper.ownerName} size={64}
            className="border-2 flex-shrink-0" style={{ borderColor: '#fda4af', background: '#fff1f2', color: '#e11d48' }} />
          <div className="flex-1">
            <p className="font-bold text-pink-900">{helper.ownerName}</p>
            <div className="flex items-center gap-3 mt-1">
              <StarRating rating={helper.rating} color="#e11d48" size={13} />
              <span className="text-pink-500 text-xs">{helper.reviewCount} weddings</span>
              <LocationChip city={helper.city} state={helper.state} className="text-pink-400 text-xs" />
            </div>
          </div>
          <ContactRow phone={phone} website={website} linkClass="text-pink-600 hover:text-pink-800 text-sm" />
        </div>

        {helper.bio && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#e11d48' }}>Our Story</span>
            <p style={{ color: '#2d1515' }} className="leading-relaxed">{helper.bio}</p>
          </section>
        )}

        {/* Services grid */}
        {services.length > 0 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#e11d48' }}>Wedding Packages</span>
            <div className="grid sm:grid-cols-3 gap-4">
              {services.slice(0, 3).map((s, i) => (
                <div key={s.id} className="rounded-2xl p-5 text-center"
                  style={i === 1
                    ? { background: '#e11d48', color: '#fff', border: '2px solid #e11d48' }
                    : { background: '#fff1f2', border: '1px solid #fecdd3', color: '#2d1515' }}>
                  {i === 1 && <span className="text-xs font-bold text-pink-200 uppercase block mb-1">Most Popular</span>}
                  <p className={`font-bold text-lg ${i === 1 ? 'text-white' : 'text-pink-900'}`}>{s.name}</p>
                  {s.price > 0 && (
                    <p className={`text-3xl font-black mt-1 ${i === 1 ? 'text-pink-200' : 'text-pink-600'}`}>
                      ${s.price.toFixed(0)}<span className="text-sm font-normal opacity-70">/{s.priceUnit}</span>
                    </p>
                  )}
                  {s.description && <p className={`text-xs mt-2 ${i === 1 ? 'text-pink-100' : 'text-pink-700'}`}>{s.description}</p>}
                </div>
              ))}
            </div>
            {services.length > 3 && (
              <div className="mt-3 space-y-2">
                {services.slice(3).map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#e11d48"
                    bgClass="bg-pink-50" textClass="text-pink-900" priceClass="text-pink-600" />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Real weddings gallery */}
        {gallery.length > 1 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#e11d48' }}>Real Weddings</span>
            <div className="grid grid-cols-3 gap-2">
              {gallery.slice(1, 7).map(img => (
                <div key={img.id} className="aspect-square rounded-xl overflow-hidden">
                  <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          </section>
        )}

        {reviews.length > 0 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-5" style={{ color: '#e11d48' }}>What Couples Say</span>
            <div className="space-y-5">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor="#e11d48" textClass="text-pink-900 italic" authorClass="text-pink-500" />
              ))}
            </div>
          </section>
        )}

        {helper.badges.length > 0 && (
          <BadgeList badges={helper.badges} badgeClass="bg-pink-50 text-pink-700 border border-pink-200" />
        )}

        {faqs.length > 0 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#e11d48' }}>FAQ</span>
            <FAQList faqs={faqs} itemClass="bg-pink-50 border border-pink-100"
              questionClass="text-pink-900" answerClass="text-pink-700" />
          </section>
        )}
      </div>
    </div>
  );
}

// ─── 24. BEAUTY & STYLE ───────────────────────────────────────────────────────
// Fashion editorial price-menu layout. Dark/rose gold. Service price list leads.
// Instagram-style photo grid. Specialties chips prominently displayed.
export function BeautyStyleTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const specialties = ['Balayage', 'Color Correction', 'Extensions', 'Keratin', 'Cuts & Styling', 'Highlights', 'Ombre', 'Bridal Hair'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#0a0a0a', color: '#f5f5f5' }}>
      {/* Fashion dark header */}
      <div className="relative overflow-hidden">
        {helper.coverImage
          ? <img src={helper.coverImage} alt="beauty" className="w-full h-64 object-cover opacity-60" />
          : <div className="h-48" style={{ background: 'linear-gradient(135deg, #1a0a12 0%, #3d0a24 100%)' }} />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, transparent 20%, rgba(10,10,10,0.95) 85%)' }} />
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-6">
          <div className="max-w-4xl mx-auto flex items-end gap-4">
            <Avatar src={helper.avatar} name={helper.ownerName} size={80}
              className="border-4 flex-shrink-0" style={{ borderColor: '#f9a8d4', background: '#1a0a12', color: '#f9a8d4' }} />
            <div className="pb-1">
              <div className="flex items-center gap-2 mb-1">
                <Scissors size={12} style={{ color: '#f9a8d4' }} />
                <span className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: '#f9a8d4' }}>Beauty & Style</span>
              </div>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p style={{ color: '#d4d4d4' }} className="text-sm mt-0.5">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2">
                <StarRating rating={helper.rating} color="#f9a8d4" size={13} />
                <span style={{ color: '#a3a3a3' }} className="text-xs">{helper.reviewCount} clients</span>
                <LocationChip city={helper.city} state={helper.state} className="text-gray-500 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Specialties chips */}
          <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1f1f1f' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#f9a8d4' }}>Specialties</span>
            <div className="flex flex-wrap gap-2">
              {specialties.map(s => (
                <SpecialtyPill key={s} label={s} pillClass="text-pink-200 text-xs bg-pink-950 border border-pink-900" />
              ))}
            </div>
          </section>

          {/* Service price list — like a salon menu */}
          {services.length > 0 && (
            <section className="rounded-2xl overflow-hidden" style={{ background: '#111', border: '1px solid #1f1f1f' }}>
              <div className="p-5 pb-0">
                <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#f9a8d4' }}>Service Menu</span>
              </div>
              <div className="divide-y divide-gray-800">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-start px-5 py-3">
                    <div>
                      {s.popular && <span className="text-xs font-bold text-pink-400 block">Popular</span>}
                      <p className="font-semibold text-sm">{s.name}</p>
                      {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                    </div>
                    {s.price > 0 && (
                      <span className="text-sm font-bold whitespace-nowrap ml-4" style={{ color: '#f9a8d4' }}>
                        ${s.price.toFixed(0)}+
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {helper.bio && (
            <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1f1f1f' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#f9a8d4' }}>About Me</span>
              <p style={{ color: '#d4d4d4' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {/* Photo grid */}
          {gallery.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1f1f1f' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#f9a8d4' }}>Gallery</span>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1f1f1f' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#f9a8d4' }}>Client Reviews</span>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="text-gray-300" style={{ background: '#1f1f1f' }} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: '#f9a8d4', color: '#1a0a12' }}>
            <p className="font-black text-lg">Book Now</p>
            <p className="text-pink-900 text-xs mb-3">Appointments available online</p>
            <ContactRow phone={phone} website={website} linkClass="text-pink-900 font-semibold hover:text-black text-sm" />
          </div>
          {helper.badges.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1f1f1f' }}>
              <BadgeList badges={helper.badges} badgeClass="text-pink-300 bg-pink-950 border border-pink-900" />
            </div>
          )}
          {faqs.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1f1f1f' }}>
              <span className="text-xs font-bold uppercase tracking-wider block mb-3" style={{ color: '#f9a8d4' }}>FAQ</span>
              <FAQList faqs={faqs} itemClass="bg-gray-900 border border-gray-800"
                questionClass="text-white text-sm" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 25. BARBERSHOP ───────────────────────────────────────────────────────────
// Urban street aesthetic. Bold high-contrast. Walk-in indicator. Cut gallery grid.
// Red/black/white classic barberpole feel with modern edge.
export function BarbershopTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const cuts = ['Fade', 'Taper', 'Buzz Cut', 'Line Up', 'Beard Trim', 'Hot Towel Shave', 'Skin Fade', 'Dreadlocks', 'Designs'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#111', color: '#fff' }}>
      {/* Bold stripe header */}
      <div style={{ background: '#dc2626', borderBottom: '4px solid #fff' }}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="border-4 flex-shrink-0" style={{ borderColor: '#fff', background: '#7f1d1d', color: '#fca5a5' }} />
            <div className="flex-1">
              <span className="text-xs font-black uppercase tracking-[0.4em] text-red-200">Professional Barbershop</span>
              <h1 className="text-4xl font-black leading-tight">{helper.businessName}</h1>
              <p className="text-red-100 text-sm mt-0.5">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2">
                <StarRating rating={helper.rating} color="#fff" size={13} />
                <span className="text-red-200 text-xs">{helper.reviewCount} cuts</span>
                <LocationChip city={helper.city} state={helper.state} className="text-red-100 text-xs" />
              </div>
            </div>
            {/* Walk-in indicator */}
            <div className="rounded-xl p-4 text-center flex-shrink-0" style={{ background: 'rgba(0,0,0,0.3)', border: '2px solid #fff' }}>
              <div className="text-xs font-bold text-white uppercase tracking-wide">Walk-Ins</div>
              <div className="text-2xl font-black text-green-400 mt-0.5">Open</div>
              <div className="text-xs text-gray-300">No appointment needed</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Cut styles chips */}
          <section className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3 text-red-400">What We Do</span>
            <div className="flex flex-wrap gap-2">
              {cuts.map(c => (
                <span key={c} className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase"
                  style={{ background: '#2a2a2a', border: '1px solid #444', color: '#f5f5f5' }}>{c}</span>
              ))}
            </div>
          </section>

          {services.length > 0 && (
            <section className="rounded-2xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
              <div className="bg-red-600 px-5 py-3">
                <span className="text-xs font-black uppercase tracking-[0.3em] text-white">Price List</span>
              </div>
              <div className="divide-y divide-gray-800">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-center px-5 py-3">
                    <span className="font-semibold text-sm">{s.name}</span>
                    {s.price > 0 && <span className="font-black text-red-400">${s.price.toFixed(0)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {helper.bio && (
            <section className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3 text-red-400">The Barber</span>
              <p className="text-gray-300 leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4 text-red-400">The Cuts</span>
              <GalleryGrid gallery={gallery} cols={4} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4 text-red-400">Client Reviews</span>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="text-gray-300 bg-gray-900 border border-gray-800" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5 text-center" style={{ background: '#dc2626' }}>
            <p className="font-black text-lg">Book Your Cut</p>
            <ContactRow phone={phone} website={website} linkClass="text-white font-semibold hover:text-red-100 mt-2 block" />
          </div>
          <div className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
            <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-3">Hours</p>
            {[['Mon-Fri', '9am-7pm'], ['Saturday', '8am-6pm'], ['Sunday', '10am-4pm']].map(([d, h]) => (
              <div key={d} className="flex justify-between text-xs py-1 text-gray-300">
                <span>{d}</span><span className="font-semibold text-white">{h}</span>
              </div>
            ))}
          </div>
          {helper.badges.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
              <BadgeList badges={helper.badges} badgeClass="text-red-300 bg-red-950 border border-red-900" />
            </div>
          )}
          {faqs.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
              <span className="text-xs font-bold uppercase tracking-wider block mb-3 text-red-400">FAQ</span>
              <FAQList faqs={faqs} itemClass="bg-gray-900 border border-gray-800"
                questionClass="text-white text-sm" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 26. SPA & SKINCARE ───────────────────────────────────────────────────────
// Luxe minimal. Treatment menu as elegant cards. Soft pearl/cream tones.
// Skin concern selector. Products used section.
export function SpaSkincareTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const treatments = ['Facials', 'Chemical Peels', 'Microdermabrasion', 'LED Therapy', 'Dermaplaning', 'Hydrafacial', 'Microneedling', 'Waxing'];
  const skinConcerns = ['Acne', 'Anti-aging', 'Hyperpigmentation', 'Sensitive Skin', 'Dullness', 'Hydration', 'Rosacea', 'Pore Minimizing'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#faf9f7', color: '#1a1008' }}>
      {/* Luxe minimal header */}
      <div style={{ background: 'linear-gradient(135deg, #d4c5b0 0%, #c4a882 60%, #a08060 100%)' }}>
        <div className="max-w-4xl mx-auto px-8 py-12 text-white text-center">
          <Avatar src={helper.avatar} name={helper.ownerName} size={80}
            className="mx-auto mb-4 border-2" style={{ borderColor: 'rgba(255,255,255,0.5)', background: '#7a5c3a', color: '#fdf6ee' }} />
          <span className="text-xs font-bold uppercase tracking-[0.5em] text-stone-200 block mb-2">
            Luxury Spa & Skincare
          </span>
          <h1 className="text-3xl font-light tracking-wide">{helper.businessName}</h1>
          <p className="text-stone-200 text-sm mt-2 max-w-sm mx-auto italic">{helper.tagline}</p>
          <div className="flex items-center justify-center gap-4 mt-4">
            <StarRating rating={helper.rating} color="#fdf6ee" size={13} />
            <span className="text-stone-200 text-xs">{helper.reviewCount} clients</span>
            <LocationChip city={helper.city} state={helper.state} className="text-stone-200 text-xs" />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        {/* Skin concerns filter */}
        <section className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.4em] mb-4" style={{ color: '#a08060' }}>Skin Concerns I Address</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {skinConcerns.map(c => (
              <span key={c} className="px-3 py-1.5 rounded-full text-xs"
                style={{ background: '#f5f0e8', border: '1px solid #d4c5b0', color: '#7a5c3a' }}>{c}</span>
            ))}
          </div>
        </section>

        {/* Treatment menu */}
        <section>
          <p className="text-xs font-bold uppercase tracking-[0.4em] mb-4 text-center" style={{ color: '#a08060' }}>Treatments</p>
          <div className="flex flex-wrap gap-2 justify-center mb-6">
            {treatments.map(t => (
              <span key={t} className="px-4 py-2 rounded-xl text-xs font-semibold"
                style={{ background: '#fdf6ee', border: '1px solid #d4c5b0', color: '#1a1008' }}>{t}</span>
            ))}
          </div>
        </section>

        {services.length > 0 && (
          <section>
            <p className="text-xs font-bold uppercase tracking-[0.4em] mb-4" style={{ color: '#a08060' }}>Service Menu & Pricing</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {services.map(s => (
                <div key={s.id} className="rounded-2xl p-5" style={{ background: '#fdf6ee', border: '1px solid #d4c5b0' }}>
                  <div className="flex justify-between items-start">
                    <p className="font-semibold" style={{ color: '#1a1008' }}>{s.name}</p>
                    {s.price > 0 && <p className="font-bold text-sm" style={{ color: '#a08060' }}>${s.price.toFixed(0)}</p>}
                  </div>
                  {s.description && <p className="text-xs mt-1 leading-relaxed" style={{ color: '#7a5c3a' }}>{s.description}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {helper.bio && (
          <section className="text-center max-w-2xl mx-auto">
            <p className="text-xs font-bold uppercase tracking-[0.4em] mb-3" style={{ color: '#a08060' }}>About the Esthetician</p>
            <p style={{ color: '#1a1008' }} className="leading-relaxed">{helper.bio}</p>
          </section>
        )}

        {gallery.length > 0 && (
          <section>
            <p className="text-xs font-bold uppercase tracking-[0.4em] mb-4 text-center" style={{ color: '#a08060' }}>Our Space & Results</p>
            <GalleryGrid gallery={gallery} cols={3} rounded="rounded-2xl" />
          </section>
        )}

        {reviews.length > 0 && (
          <section>
            <p className="text-xs font-bold uppercase tracking-[0.4em] mb-5 text-center" style={{ color: '#a08060' }}>Client Experiences</p>
            <div className="space-y-5">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor="#a08060" textClass="text-stone-800 italic" authorClass="text-stone-500" />
              ))}
            </div>
          </section>
        )}

        {helper.badges.length > 0 && (
          <div className="text-center">
            <BadgeList badges={helper.badges} badgeClass="bg-stone-100 text-stone-700 border border-stone-200" />
          </div>
        )}

        <div className="text-center pt-4">
          <ContactRow phone={phone} website={website} linkClass="text-stone-600 hover:text-stone-900" />
        </div>
      </div>
    </div>
  );
}

// ─── 27. TECH & IT ────────────────────────────────────────────────────────────
// Terminal/dark code aesthetic. Skills matrix with proficiency. Dark green on black.
// Issue types handled as a command-line list. Response time SLA.
export function TechITTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const skills = [
    { name: 'Windows', level: 95 }, { name: 'macOS', level: 90 }, { name: 'Linux', level: 80 },
    { name: 'Networking', level: 85 }, { name: 'Security', level: 75 }, { name: 'Cloud (AWS/Azure)', level: 70 },
  ];
  const techStack = ['Windows Server', 'Active Directory', 'Microsoft 365', 'Cisco Networking', 'VMware', 'AWS', 'Azure', 'Bash/PowerShell'];
  return (
    <div className="min-h-screen font-mono" style={{ background: '#0d1117', color: '#58d68d' }}>
      {/* Terminal header */}
      <div style={{ background: '#111', borderBottom: '1px solid #21262d' }}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-start gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={80}
              className="border-2 flex-shrink-0" style={{ borderColor: '#238636', background: '#0a1a0a', color: '#58d68d' }} />
            <div className="flex-1">
              <div className="text-xs text-green-500 mb-1">$ whoami</div>
              <h1 className="text-2xl font-bold text-white">{helper.businessName}</h1>
              <div className="text-xs text-green-400 mt-0.5"># {helper.tagline}</div>
              <div className="flex items-center gap-4 mt-3">
                <StarRating rating={helper.rating} color="#58d68d" size={13} />
                <span className="text-green-600 text-xs font-mono">{helper.reviewCount} clients</span>
                <LocationChip city={helper.city} state={helper.state} className="text-green-700 text-xs font-mono" />
              </div>
            </div>
            <div className="text-right font-mono">
              <div className="text-xs text-green-700">uptime</div>
              <div className="text-2xl font-bold text-green-400">{helper.jobsCompleted}+</div>
              <div className="text-xs text-green-700">tickets resolved</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Skills matrix */}
          <section className="rounded-xl p-5" style={{ background: '#111', border: '1px solid #21262d' }}>
            <div className="text-xs text-green-600 mb-4 font-mono">$ ./skills --list</div>
            <div className="space-y-3">
              {skills.map(s => (
                <div key={s.name} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-green-300 w-24 flex-shrink-0">{s.name}</span>
                  <div className="flex-1 h-1.5 rounded-full" style={{ background: '#21262d' }}>
                    <div className="h-full rounded-full" style={{ width: `${s.level}%`, background: '#238636' }} />
                  </div>
                  <span className="text-xs font-mono text-green-600 w-8 text-right">{s.level}%</span>
                </div>
              ))}
            </div>
          </section>

          {services.length > 0 && (
            <section className="rounded-xl" style={{ background: '#111', border: '1px solid #21262d' }}>
              <div className="px-5 py-3 border-b border-gray-800">
                <div className="text-xs text-green-600 font-mono">$ ./services --available</div>
              </div>
              <div className="divide-y divide-gray-900">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-center px-5 py-3">
                    <div>
                      <p className="font-bold text-sm text-green-300">&gt; {s.name}</p>
                      {s.description && <p className="text-xs text-green-700 mt-0.5 font-mono"># {s.description}</p>}
                    </div>
                    {s.price > 0 && <span className="text-sm font-bold text-green-400 whitespace-nowrap font-mono">${s.price.toFixed(0)}/{s.priceUnit}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tech stack */}
          <section className="rounded-xl p-5" style={{ background: '#111', border: '1px solid #21262d' }}>
            <div className="text-xs text-green-600 mb-3 font-mono">$ ./tools --installed</div>
            <div className="flex flex-wrap gap-2">
              {techStack.map(t => <TechChip key={t} label={t} bgClass="bg-gray-900" textClass="text-green-300" />)}
            </div>
          </section>

          {helper.bio && (
            <section className="rounded-xl p-5" style={{ background: '#111', border: '1px solid #21262d' }}>
              <div className="text-xs text-green-600 mb-3 font-mono">$ cat README.md</div>
              <p className="text-green-200 leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="rounded-xl p-5" style={{ background: '#111', border: '1px solid #21262d' }}>
              <div className="text-xs text-green-600 mb-3 font-mono">$ git log --reviews</div>
              <div className="space-y-3">
                {reviews.slice(0, 3).map(r => (
                  <div key={r.id} className="rounded-lg p-3" style={{ background: '#0a1a0a', border: '1px solid #1a2a1a' }}>
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-mono text-xs text-green-400">{r.authorName}</span>
                      <StarRating rating={r.rating} size={11} color="#58d68d" />
                    </div>
                    <p className="text-xs text-green-300 opacity-80 line-clamp-2">{r.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {/* SLA box */}
          <div className="rounded-xl p-5" style={{ background: '#0a1a0a', border: '1px solid #238636' }}>
            <div className="text-xs text-green-600 font-mono mb-2">response.time</div>
            <div className="text-2xl font-bold text-green-400 font-mono">&lt; 2hrs</div>
            <div className="text-xs text-green-700 font-mono mt-0.5">avg response time</div>
          </div>
          {helper.badges.length > 0 && (
            <div className="rounded-xl p-5" style={{ background: '#111', border: '1px solid #21262d' }}>
              <div className="text-xs text-green-600 font-mono mb-3">$ ./certs --list</div>
              <BadgeList badges={helper.badges} badgeClass="text-green-300 bg-gray-900 border border-green-900 font-mono text-xs" />
            </div>
          )}
          <div className="rounded-xl p-5" style={{ background: '#111', border: '1px solid #21262d' }}>
            <ContactRow phone={phone} website={website} linkClass="text-green-400 hover:text-green-300 text-sm font-mono" />
          </div>
          {faqs.length > 0 && (
            <div className="rounded-xl p-5" style={{ background: '#111', border: '1px solid #21262d' }}>
              <div className="text-xs text-green-600 font-mono mb-3">$ cat FAQ.txt</div>
              <FAQList faqs={faqs} itemClass="bg-gray-900 border border-gray-800"
                questionClass="text-green-300 text-sm font-mono" answerClass="text-green-600 font-mono" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 28. WEB & APP DEV ────────────────────────────────────────────────────────
// Portfolio project cards lead. Dark developer aesthetic.
// Tech stack chips. GitHub / portfolio link prominent.
export function WebAppDevTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const stack = ['React', 'Next.js', 'Node.js', 'TypeScript', 'PostgreSQL', 'MongoDB', 'AWS', 'Docker', 'Figma', 'GraphQL'];
  const devTypes = ['Web Apps', 'Mobile Apps', 'E-commerce', 'SaaS Products', 'Landing Pages', 'API Development', 'UI/UX Design', 'Performance Optimization'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#09090b', color: '#fafaf9' }}>
      {/* Dev header */}
      <div style={{ background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)', borderBottom: '1px solid #3f3f46' }}>
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={80}
              className="border-2 flex-shrink-0" style={{ borderColor: '#6366f1', background: '#1e1b4b', color: '#a5b4fc' }} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Code size={13} style={{ color: '#6366f1' }} />
                <span className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: '#6366f1' }}>Full-Stack Developer</span>
              </div>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p style={{ color: '#a1a1aa' }} className="text-sm mt-0.5">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2">
                <StarRating rating={helper.rating} color="#6366f1" size={13} />
                <span style={{ color: '#71717a' }} className="text-xs">{helper.reviewCount} projects</span>
                <LocationChip city={helper.city} state={helper.state} className="text-zinc-500 text-xs" />
              </div>
            </div>
            <div className="flex gap-3">
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{ background: '#6366f1', color: '#fff' }}>
                  <Globe size={14} />Portfolio
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* What I build */}
          <section className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#6366f1' }}>What I Build</span>
            <div className="flex flex-wrap gap-2">
              {devTypes.map(d => (
                <SpecialtyPill key={d} label={d} pillClass="text-indigo-300 text-xs bg-indigo-950 border border-indigo-900" />
              ))}
            </div>
          </section>

          {/* Gallery as project portfolio */}
          {gallery.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#6366f1' }}>Project Portfolio</span>
              <GalleryGrid gallery={gallery} cols={2} rounded="rounded-xl" />
            </section>
          )}

          {services.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#6366f1' }}>Services</span>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#6366f1"
                    bgClass="" textClass="text-white" priceClass="text-indigo-400"
                    style={{ background: '#27272a' }} />
                ))}
              </div>
            </section>
          )}

          {helper.bio && (
            <section className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#6366f1' }}>About</span>
              <p style={{ color: '#d4d4d8' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#6366f1' }}>Client Reviews</span>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="text-zinc-300 bg-zinc-900 border border-zinc-800" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {/* Tech stack */}
          <div className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#6366f1' }}>Tech Stack</span>
            <div className="flex flex-wrap gap-2">
              {stack.map(t => <TechChip key={t} label={t} bgClass="bg-zinc-800" textClass="text-zinc-300" />)}
            </div>
          </div>
          <div className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { v: helper.jobsCompleted ?? 0, l: 'Projects' },
                { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
                { v: `${helper.reviewCount}+`, l: 'Reviews' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-xl font-black" style={{ color: '#6366f1' }}>{s.v}</div>
                  <div className="text-xs text-zinc-500">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          {helper.badges.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
              <BadgeList badges={helper.badges} badgeClass="text-indigo-300 bg-indigo-950 border border-indigo-900" />
            </div>
          )}
          <div className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
            <ContactRow phone={phone} website={website} linkClass="text-indigo-400 hover:text-indigo-300 text-sm" />
          </div>
          {faqs.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#18181b', border: '1px solid #3f3f46' }}>
              <span className="text-xs font-bold uppercase tracking-wider block mb-3" style={{ color: '#6366f1' }}>FAQ</span>
              <FAQList faqs={faqs} itemClass="bg-zinc-900 border border-zinc-800"
                questionClass="text-white text-sm" answerClass="text-zinc-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 29. CONSULTING & COACHING ────────────────────────────────────────────────
// Authority layout. Credential timeline leads. Navy/gold professional.
// Testimonials with company names. Engagement types.
export function ConsultingCoachingTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const engagements = ['1-on-1 Coaching', 'Group Workshops', 'Strategy Sessions', 'Fractional Executive', 'Speaking Engagements', 'Online Courses'];
  const industries = ['Technology', 'Finance', 'Healthcare', 'Retail', 'Non-profit', 'Startups', 'Manufacturing', 'Real Estate'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f8f9fc', color: '#0f1923' }}>
      {/* Authority header */}
      <div style={{ background: 'linear-gradient(135deg, #0f1923 0%, #1e2d3d 60%, #243447 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left">
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="border-4 flex-shrink-0" style={{ borderColor: '#d4a853', background: '#1a2433', color: '#fcd34d' }} />
            <div className="flex-1">
              <span className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: '#d4a853' }}>Business Consultant & Coach</span>
              <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
              <p style={{ color: '#94a3b8' }} className="text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#d4a853" size={13} />
                <span style={{ color: '#64748b' }} className="text-xs">{helper.reviewCount} clients</span>
                <LocationChip city={helper.city} state={helper.state} className="text-gray-500 text-xs" />
              </div>
            </div>
            <div className="flex flex-col gap-3 flex-shrink-0">
              {[
                { v: helper.jobsCompleted ?? 0, l: 'Engagements' },
                { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
              ].map(s => (
                <div key={s.l} className="rounded-xl p-3 text-center"
                  style={{ background: 'rgba(212,168,83,0.1)', border: '1px solid rgba(212,168,83,0.3)' }}>
                  <div className="text-2xl font-black" style={{ color: '#d4a853' }}>{s.v}</div>
                  <div className="text-xs text-gray-500">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Credentials */}
          {helper.badges.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#d4a853' }}>Credentials & Certifications</span>
              <BadgeList badges={helper.badges} badgeClass="bg-yellow-50 text-yellow-800 border border-yellow-200" />
            </section>
          )}

          {helper.bio && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#d4a853' }}>About</span>
              <p style={{ color: '#0f1923' }} className="leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {/* Industry expertise */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#d4a853' }}>Industry Expertise</span>
            <div className="flex flex-wrap gap-2">
              {industries.map(i => (
                <span key={i} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">{i}</span>
              ))}
            </div>
          </section>

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#d4a853' }}>Services</span>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#d4a853"
                    bgClass="bg-gray-50" textClass="text-gray-900" priceClass="text-yellow-700" />
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-5" style={{ color: '#d4a853' }}>Client Testimonials</span>
              <div className="space-y-5">
                {reviews.slice(0, 3).map(r => (
                  <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                    accentColor="#d4a853" textClass="text-gray-700" authorClass="text-yellow-700" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {/* Engagement types */}
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#d4a853' }}>Engagement Types</p>
            {engagements.map(e => (
              <ChecklistRow key={e} iconColor="#d4a853" textClass="text-gray-800 text-xs">{e}</ChecklistRow>
            ))}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-yellow-700 hover:text-yellow-900" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider block mb-3" style={{ color: '#d4a853' }}>FAQ</span>
              <FAQList faqs={faqs} itemClass="bg-gray-50" questionClass="text-gray-900" answerClass="text-gray-600" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 30. LEGAL & ADMINISTRATIVE ───────────────────────────────────────────────
// Ultra-professional. Practice areas lead. Navy/white. Confidentiality statement.
// Consultation booking process. Attorney-style trust layout.
export function LegalAdminTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const practiceAreas = ['Contract Review', 'Business Formation', 'Employment Law', 'Family Law', 'Real Estate', 'Estate Planning', 'Intellectual Property', 'Dispute Resolution'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f5f7fa', color: '#0a1628' }}>
      {/* Professional navy header */}
      <div style={{ background: '#0a1628', borderBottom: '4px solid #d4a853' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-6 text-center sm:text-left">
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="border-4 flex-shrink-0" style={{ borderColor: '#d4a853', background: '#0f2240', color: '#fcd34d' }} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 justify-center sm:justify-start">
                <Scale size={13} style={{ color: '#d4a853' }} />
                <span className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: '#d4a853' }}>Legal & Administrative Services</span>
              </div>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p style={{ color: '#94a3b8' }} className="text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#d4a853" size={13} />
                <span className="text-gray-400 text-xs">{helper.reviewCount} clients served</span>
                <LocationChip city={helper.city} state={helper.state} className="text-gray-500 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Confidentiality notice */}
          <section className="rounded-xl p-4 flex items-start gap-3"
            style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
            <Shield size={16} className="flex-shrink-0 mt-0.5 text-blue-600" />
            <div>
              <p className="font-semibold text-sm text-blue-900">Attorney-Client Privilege Protected</p>
              <p className="text-xs text-blue-700 mt-0.5">
                All consultations are strictly confidential. Information shared will not be disclosed to third parties without your consent.
              </p>
            </div>
          </section>

          {/* Practice areas */}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#d4a853' }}>Practice Areas</span>
            <div className="grid grid-cols-2 gap-2">
              {practiceAreas.map(p => (
                <div key={p} className="flex items-center gap-2 py-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#d4a853' }} />
                  <span className="text-sm text-gray-800">{p}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Credentials */}
          {helper.badges.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#d4a853' }}>Bar Admissions & Credentials</span>
              <BadgeList badges={helper.badges} badgeClass="bg-yellow-50 text-yellow-800 border border-yellow-200" />
            </section>
          )}

          {helper.bio && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#d4a853' }}>About</span>
              <p className="text-gray-700 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#d4a853' }}>Services</span>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#d4a853"
                    bgClass="bg-gray-50" textClass="text-gray-900" priceClass="text-yellow-700" />
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#d4a853' }}>Client Reviews</span>
              <div className="space-y-4">
                {reviews.slice(0, 3).map(r => (
                  <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                    accentColor="#d4a853" textClass="text-gray-700" authorClass="text-yellow-700" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {/* Consultation CTA */}
          <div className="rounded-2xl p-5 text-white" style={{ background: '#0a1628' }}>
            <p className="font-black text-lg">Schedule a Consultation</p>
            <p className="text-gray-400 text-xs mb-3">Free initial 20-minute call</p>
            <ContactRow phone={phone} website={website} linkClass="text-yellow-400 hover:text-yellow-300 font-semibold" />
          </div>

          {/* How it works */}
          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#d4a853' }}>The Process</p>
            <div className="space-y-3">
              {[
                { n: 1, t: 'Free Consultation', d: 'Discuss your legal matter' },
                { n: 2, t: 'Engagement Letter', d: 'Agree on scope and fees' },
                { n: 3, t: 'Resolution', d: 'Work toward your goals' },
              ].map(s => (
                <ProcessStep key={s.n} number={s.n} title={s.t} description={s.d}
                  numBg="#0a1628" textClass="text-gray-900" />
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider mb-2 text-gray-600">Stats</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { v: helper.jobsCompleted ?? 0, l: 'Cases' },
                { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
                { v: `${helper.reviewCount}+`, l: 'Reviews' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-xl font-black" style={{ color: '#d4a853' }}>{s.v}</div>
                  <div className="text-xs text-gray-500">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <span className="text-xs font-bold uppercase tracking-wider block mb-3" style={{ color: '#d4a853' }}>FAQ</span>
              <FAQList faqs={faqs} itemClass="bg-gray-50" questionClass="text-gray-900" answerClass="text-gray-600" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
