// HomeTemplates.jsx — Default + Home & Property templates (8 templates)
import {
  StarRating, Avatar, BadgeList, ServiceCard, GalleryGrid,
  ReviewCard, FAQList, LocationChip, StatsRow, ContactRow, SectionHead,
} from '../shared.jsx';
import { CheckCircle, Wrench, Home, Leaf, Sparkles, Bug, Truck, Palette } from 'lucide-react';

// ─── 1. DEFAULT ───────────────────────────────────────────────────────────────
export function DefaultTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, bizId, phone, website } = profileData;
  return (
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      {/* Hero */}
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
        {/* Main */}
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

        {/* Sidebar */}
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
export function TradesProTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans">
      {/* Industrial hero bar */}
      <div className="bg-gradient-to-r from-blue-900 via-slate-800 to-slate-900 border-b-4 border-blue-500">
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6">
          <div className="relative">
            <Avatar src={helper.avatar} name={helper.ownerName} size={100}
              className="border-4 border-blue-500 bg-slate-700 text-white" />
            <Wrench size={20} className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full p-1 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <Wrench size={16} className="text-blue-400" />
              <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">Licensed Trade Professional</span>
            </div>
            <h1 className="text-3xl font-black leading-tight">{helper.businessName}</h1>
            <p className="text-slate-300 mt-1">{helper.tagline}</p>
            <div className="flex items-center gap-4 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#60a5fa" />
              <span className="text-slate-400 text-sm">{helper.reviewCount} verified reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-slate-400" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-blue-400 text-2xl" labelClass="text-slate-500 text-xs" />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {helper.bio && (
            <section className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <SectionHead className="text-blue-400 uppercase tracking-wide text-base">About the Contractor</SectionHead>
              <p className="text-slate-300 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <SectionHead className="text-blue-400 uppercase tracking-wide text-base">Services & Rates</SectionHead>
              <div className="space-y-3">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-center bg-slate-700 rounded-xl px-4 py-3 border-l-4 border-blue-500">
                    <div>
                      <p className="font-semibold">{s.name}</p>
                      {s.description && <p className="text-xs text-slate-400 mt-0.5">{s.description}</p>}
                    </div>
                    {s.price > 0 && (
                      <span className="text-blue-300 font-bold whitespace-nowrap ml-4">
                        ${s.price.toFixed(0)}/{s.priceUnit}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <SectionHead className="text-blue-400 uppercase tracking-wide text-base">Project Gallery</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
              <SectionHead className="text-blue-400 uppercase tracking-wide text-base">Client Reviews</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-slate-700 text-slate-200" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-blue-600 rounded-2xl p-5">
            <p className="text-sm font-bold text-blue-100 mb-3">Credentials</p>
            <BadgeList badges={helper.badges} badgeClass="bg-blue-700 text-white" />
            {!helper.badges.length && <p className="text-blue-200 text-sm">Contact to verify credentials.</p>}
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
            <ContactRow phone={phone} website={website} linkClass="text-blue-400 hover:text-blue-300" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
              <SectionHead className="text-blue-400 uppercase tracking-wide text-base text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-slate-700" questionClass="text-white" answerClass="text-slate-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 3. HANDYMAN ─────────────────────────────────────────────────────────────
export function HandymanTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#faf5eb', color: '#2d1a00' }}>
      {/* Warm amber header */}
      <div style={{ background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)' }}
        className="px-6 py-10">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-6 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={96}
            className="border-4 border-white/40 bg-amber-700 text-white shadow-xl" />
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest opacity-75">Your Trusted Handyman</span>
            <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
            <p className="opacity-90 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#fff" />
              <span className="text-white/80 text-sm">{helper.reviewCount} happy clients</span>
              <LocationChip city={helper.city} state={helper.state} className="text-white/80" />
            </div>
          </div>
          <div className="bg-white/10 rounded-2xl p-4 text-center">
            <div className="text-3xl font-black">{helper.jobsCompleted}</div>
            <div className="text-xs opacity-75">Jobs Done</div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
              <SectionHead className="text-amber-700">About Me</SectionHead>
              <p style={{ color: '#78350f' }} className="leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
              <SectionHead className="text-amber-700">What I Can Fix</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <ServiceCard key={s.id} service={s}
                    cardClass="bg-amber-50 border border-amber-200 rounded-xl"
                    priceClass="text-amber-700" />
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
              <SectionHead className="text-amber-700">My Work</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
              <SectionHead className="text-amber-700">What Customers Say</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-amber-50 text-amber-900" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-amber-600 text-white rounded-2xl p-5">
            <div className="text-sm font-bold mb-3">Verified & Trusted</div>
            <BadgeList badges={helper.badges} badgeClass="bg-amber-700 text-white" />
            {!helper.badges.length && <p className="text-sm opacity-80">Available 7 days a week!</p>}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-amber-600 hover:text-amber-700" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
              <SectionHead className="text-amber-700 text-sm">Common Questions</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-amber-50"
                questionClass="text-amber-900" answerClass="text-amber-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 4. HOME & GARDEN ────────────────────────────────────────────────────────
export function HomeGardenTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f0fdf4', color: '#14532d' }}>
      {/* Nature hero */}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #15803d 0%, #166534 60%, #052e16 100%)' }}>
        {helper.coverImage && (
          <img src={helper.coverImage} alt="cover" className="absolute inset-0 w-full h-full object-cover opacity-20" />
        )}
        <div className="relative max-w-5xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center gap-6 text-white">
          <div className="relative">
            <Avatar src={helper.avatar} name={helper.ownerName} size={100}
              className="border-4 border-green-300 bg-green-800 text-white shadow-xl" />
            <Leaf size={18} className="absolute -bottom-1 -right-1 bg-green-400 rounded-full p-1 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-green-300">Landscaping & Garden Care</span>
            <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
            <p className="text-green-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#86efac" />
              <span className="text-green-200 text-sm">{helper.reviewCount} reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-green-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Our Story</SectionHead>
              <p className="text-green-900 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Garden Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <ServiceCard key={s.id} service={s}
                    cardClass="bg-green-50 border border-green-200"
                    priceClass="text-green-700" />
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
        </div>

        <div className="space-y-4">
          <div style={{ background: 'linear-gradient(135deg, #15803d, #166534)' }} className="text-white rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-green-200 text-2xl" labelClass="text-green-400 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5 border border-green-100 shadow-sm">
            <BadgeList badges={helper.badges} badgeClass="bg-green-100 text-green-700 border border-green-200" />
            <ContactRow phone={phone} website={website} linkClass="text-green-700 hover:text-green-800 mt-3 block" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-green-100 shadow-sm">
              <SectionHead className="text-green-700 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-green-50" questionClass="text-green-900" answerClass="text-green-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 5. CLEANING SERVICE ─────────────────────────────────────────────────────
export function CleaningServiceTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-cyan-50 text-slate-800">
      {/* Fresh teal hero */}
      <div style={{ background: 'linear-gradient(135deg, #0e7490 0%, #0891b2 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={96}
            className="border-4 border-white/40 bg-cyan-700 text-white shadow-lg" />
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <Sparkles size={14} className="text-cyan-200" />
              <span className="text-xs font-bold uppercase tracking-widest text-cyan-200">Professional Cleaning</span>
            </div>
            <h1 className="text-3xl font-black">{helper.businessName}</h1>
            <p className="text-cyan-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#a5f3fc" />
              <span className="text-cyan-200 text-sm">{helper.reviewCount} reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-cyan-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-cyan-100">
              <SectionHead className="text-cyan-700">About Our Service</SectionHead>
              <p className="leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-cyan-100">
              <SectionHead className="text-cyan-700">Cleaning Packages</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <ServiceCard key={s.id} service={s}
                    cardClass="bg-cyan-50 border border-cyan-100"
                    priceClass="text-cyan-600" />
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-cyan-100">
              <SectionHead className="text-cyan-700">Our Work</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-cyan-100">
              <SectionHead className="text-cyan-700">Client Satisfaction</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-cyan-50 text-slate-700" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-cyan-600 text-white rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-white text-2xl" labelClass="text-cyan-200 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5 border border-cyan-100 shadow-sm space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-cyan-100 text-cyan-700" />
            <ContactRow phone={phone} website={website} linkClass="text-cyan-600 hover:text-cyan-700" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-cyan-100 shadow-sm">
              <SectionHead className="text-cyan-700 text-sm">Questions?</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-cyan-50" questionClass="text-slate-800" answerClass="text-slate-600" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 6. PEST CONTROL ─────────────────────────────────────────────────────────
export function PestControlTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-zinc-900 text-white">
      {/* Bold red/dark hero */}
      <div style={{ background: 'linear-gradient(135deg, #991b1b 0%, #7f1d1d 60%, #1c1917 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6">
          <div className="relative">
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="border-4 border-red-400 bg-red-900 text-white" />
            <Bug size={18} className="absolute -bottom-1 -right-1 bg-red-500 rounded-full p-1 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-red-300">Certified Pest Specialists</span>
            <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
            <p className="text-red-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#fca5a5" />
              <span className="text-red-200 text-sm">{helper.reviewCount} reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-red-200" />
            </div>
          </div>
          <div className="bg-red-900/50 border border-red-700 rounded-2xl p-4 text-center">
            <div className="text-3xl font-black text-red-300">{helper.jobsCompleted}+</div>
            <div className="text-xs text-red-400">Homes Protected</div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-zinc-800 border border-zinc-700 rounded-2xl p-5">
              <SectionHead className="text-red-400">About Our Experts</SectionHead>
              <p className="text-zinc-300 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-zinc-800 border border-zinc-700 rounded-2xl p-5">
              <SectionHead className="text-red-400">Treatment Services</SectionHead>
              <div className="space-y-3">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-center bg-zinc-700 border-l-4 border-red-500 rounded-xl px-4 py-3">
                    <div>
                      <p className="font-semibold">{s.name}</p>
                      {s.description && <p className="text-xs text-zinc-400">{s.description}</p>}
                    </div>
                    {s.price > 0 && <span className="text-red-300 font-bold">${s.price.toFixed(0)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-zinc-800 border border-zinc-700 rounded-2xl p-5">
              <SectionHead className="text-red-400">Client Results</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-zinc-700 text-zinc-200" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-red-800 rounded-2xl p-5">
            <p className="text-sm font-bold text-red-200 mb-3">Certifications</p>
            <BadgeList badges={helper.badges} badgeClass="bg-red-700 text-white" />
            {!helper.badges.length && <p className="text-sm text-red-200">Licensed & insured professionals</p>}
          </div>
          <div className="bg-zinc-800 border border-zinc-700 rounded-2xl p-5">
            <ContactRow phone={phone} website={website} linkClass="text-red-400 hover:text-red-300" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-zinc-800 border border-zinc-700 rounded-2xl p-5">
              <SectionHead className="text-red-400 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-zinc-700" questionClass="text-white" answerClass="text-zinc-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 7. MOVING & HAULING ──────────────────────────────────────────────────────
export function MovingHaulingTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-yellow-50 text-gray-900">
      {/* Navy/yellow heavy-duty hero */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <div className="relative">
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="border-4 border-yellow-400 bg-blue-800 text-white shadow-xl" />
            <Truck size={18} className="absolute -bottom-1 -right-1 bg-yellow-400 rounded-full p-1 text-blue-900" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-yellow-300">Moving & Hauling Services</span>
            <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
            <p className="text-blue-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#fde047" />
              <span className="text-blue-200 text-sm">{helper.reviewCount} reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-blue-200" />
            </div>
          </div>
          <div className="bg-yellow-400 text-blue-900 rounded-2xl p-4 text-center font-black">
            <div className="text-3xl">{helper.jobsCompleted}</div>
            <div className="text-xs font-bold">Moves Done</div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-yellow-100">
              <SectionHead className="text-blue-800">About Us</SectionHead>
              <p className="leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-yellow-100">
              <SectionHead className="text-blue-800">Moving Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{s.name}</p>
                      {s.description && <p className="text-xs text-gray-500">{s.description}</p>}
                    </div>
                    {s.price > 0 && <span className="text-blue-700 font-bold">${s.price.toFixed(0)}/{s.priceUnit}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-yellow-100">
              <SectionHead className="text-blue-800">Happy Movers</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-yellow-50 text-gray-800" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-blue-800 text-white rounded-2xl p-5">
            <BadgeList badges={helper.badges} badgeClass="bg-blue-700 text-yellow-300" />
            {!helper.badges.length && <p className="text-sm text-blue-200">Fully insured & bonded</p>}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-yellow-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-blue-700 hover:text-blue-800" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-yellow-100 shadow-sm">
              <SectionHead className="text-blue-800 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-yellow-50" questionClass="text-gray-800" answerClass="text-gray-600" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 8. INTERIOR DESIGN ───────────────────────────────────────────────────────
export function InteriorDesignTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-serif" style={{ background: '#faf8f3', color: '#2c2410' }}>
      {/* Editorial magazine header */}
      {gallery.length > 0 && (
        <div className="relative h-72 overflow-hidden">
          <img src={gallery[0].url} alt="featured" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <div className="absolute bottom-6 left-6 text-white">
            <span className="text-xs font-sans font-bold uppercase tracking-[0.3em] text-amber-300">Interior Design</span>
            <h1 className="text-4xl font-serif font-bold mt-1 drop-shadow">{helper.businessName}</h1>
          </div>
        </div>
      )}

      {!gallery.length && (
        <div style={{ background: 'linear-gradient(135deg, #d4af6a 0%, #b8860b 100%)' }}
          className="px-8 py-14 text-white text-center">
          <span className="text-xs font-sans font-bold uppercase tracking-[0.3em] text-amber-100">Interior Design Studio</span>
          <h1 className="text-4xl font-serif font-bold mt-2">{helper.businessName}</h1>
          <p className="text-amber-100 mt-2 font-sans text-sm">{helper.tagline}</p>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Profile bar */}
        <div className="flex items-center gap-5 mb-10 border-b border-amber-200 pb-8">
          <Avatar src={helper.avatar} name={helper.ownerName} size={80}
            className="border-2 border-amber-300 bg-amber-100 text-amber-800 font-sans" />
          <div>
            <h2 className="text-xl font-serif font-bold" style={{ color: '#2c2410' }}>{helper.ownerName}</h2>
            <p style={{ color: '#78601a' }} className="text-sm font-sans">{helper.tagline}</p>
            <div className="flex items-center gap-3 mt-2">
              <StarRating rating={helper.rating} color="#b8860b" size={14} />
              <span className="text-sm font-sans" style={{ color: '#78601a' }}>{helper.reviewCount} clients</span>
              <LocationChip city={helper.city} state={helper.state} className="font-sans text-amber-700" />
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            {helper.bio && (
              <section>
                <h3 className="text-xs font-sans font-bold uppercase tracking-[0.3em] text-amber-600 mb-3">Philosophy</h3>
                <p className="leading-relaxed text-base" style={{ color: '#3d2b00' }}>{helper.bio}</p>
              </section>
            )}

            {services.length > 0 && (
              <section>
                <h3 className="text-xs font-sans font-bold uppercase tracking-[0.3em] text-amber-600 mb-4">Services</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {services.map(s => (
                    <div key={s.id} style={{ background: '#fdf6e3', border: '1px solid #e8d5a3' }}
                      className="rounded-xl p-4">
                      <p className="font-serif font-semibold">{s.name}</p>
                      {s.description && <p className="text-xs font-sans mt-1" style={{ color: '#78601a' }}>{s.description}</p>}
                      {s.price > 0 && <p className="text-sm font-sans font-bold text-amber-700 mt-2">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {gallery.length > 1 && (
              <section>
                <h3 className="text-xs font-sans font-bold uppercase tracking-[0.3em] text-amber-600 mb-4">Portfolio</h3>
                <GalleryGrid gallery={gallery.slice(1)} cols={3} rounded="rounded-lg" />
              </section>
            )}

            {reviews.length > 0 && (
              <section>
                <h3 className="text-xs font-sans font-bold uppercase tracking-[0.3em] text-amber-600 mb-4">Client Words</h3>
                <div className="space-y-4">
                  {reviews.slice(0, 3).map(r => (
                    <div key={r.id} style={{ borderLeft: '3px solid #d4af6a' }} className="pl-4">
                      <p className="italic font-serif text-sm" style={{ color: '#3d2b00' }}>"{r.content}"</p>
                      <p className="text-xs font-sans mt-1 text-amber-700">&mdash; {r.authorName}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-5">
            <div style={{ background: '#fdf6e3', border: '1px solid #e8d5a3' }} className="rounded-2xl p-5">
              <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
                statClass="text-amber-700 text-2xl font-sans font-black" labelClass="text-amber-500 text-xs font-sans" />
            </div>
            <BadgeList badges={helper.badges} badgeClass="bg-amber-100 text-amber-800 border border-amber-200 font-sans text-xs" />
            <ContactRow phone={phone} website={website} linkClass="text-amber-700 hover:text-amber-800 font-sans text-sm" />
            {faqs.length > 0 && (
              <div style={{ background: '#fdf6e3', border: '1px solid #e8d5a3' }} className="rounded-2xl p-5">
                <h4 className="text-xs font-sans font-bold uppercase tracking-[0.3em] text-amber-600 mb-3">FAQ</h4>
                <FAQList faqs={faqs} itemClass="bg-amber-50" questionClass="font-sans text-sm text-amber-900" answerClass="font-sans text-xs text-amber-700" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
