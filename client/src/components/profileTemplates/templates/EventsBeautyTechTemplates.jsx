// EventsBeautyTechTemplates.jsx — Events, Beauty & Tech templates (10 templates)
import {
  StarRating, Avatar, BadgeList, ServiceCard, GalleryGrid,
  ReviewCard, FAQList, LocationChip, StatsRow, ContactRow, SectionHead,
} from '../shared.jsx';
import { Sparkles, Scissors, Monitor, Code } from 'lucide-react';

// ─── 21. EVENTS & ENTERTAINMENT ───────────────────────────────────────────────
export function EventsEntertainmentTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-black text-white">
      {/* Purple/gold spotlight */}
      <div style={{ background: 'linear-gradient(135deg, #4c1d95 0%, #5b21b6 40%, #1c1917 100%)' }}>
        {/* Spotlight rays */}
        <div className="relative overflow-hidden">
          {[30, 50, 70].map((l, i) => (
            <div key={i} className="absolute top-0 rounded-full bg-yellow-400"
              style={{ left: `${l}%`, width: 2, height: '200px', opacity: 0.06, transform: 'rotate(15deg)' }} />
          ))}
          <div className="relative max-w-5xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center gap-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-yellow-400 blur-2xl opacity-20" />
              <Avatar src={helper.avatar} name={helper.ownerName} size={100}
                className="relative border-4 border-yellow-400 bg-purple-800 text-white" />
            </div>
            <div className="flex-1 text-center md:text-left">
              <span className="text-xs font-bold uppercase tracking-widest text-yellow-400">Event Specialist</span>
              <h1 className="text-4xl font-black mt-1"
                style={{ textShadow: '0 0 30px rgba(250,204,21,0.3)' }}>{helper.businessName}</h1>
              <p className="text-purple-200 mt-1">{helper.tagline}</p>
              <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
                <StarRating rating={helper.rating} color="#fde047" />
                <span className="text-purple-300 text-sm">{helper.reviewCount} events</span>
                <LocationChip city={helper.city} state={helper.state} className="text-purple-300" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-yellow-400">About the Performer</SectionHead>
              <p className="text-gray-300 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-yellow-400">Entertainment Packages</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id}
                    className="rounded-xl p-4"
                    style={{ background: s.popular ? 'rgba(250,204,21,0.1)' : '#1c1917', border: `1px solid ${s.popular ? '#fde047' : '#44403c'}` }}>
                    {s.popular && <span className="text-xs text-yellow-400 font-bold">★ Featured</span>}
                    <p className="font-bold">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-yellow-400 font-bold text-sm mt-2">from ${s.price.toFixed(0)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-yellow-400">Event Gallery</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-yellow-400">Client Reviews</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-gray-800 border border-purple-900 text-gray-200" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div style={{ background: 'linear-gradient(135deg, #5b21b6, #4c1d95)' }} className="rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-yellow-400 text-2xl" labelClass="text-purple-300 text-xs" />
          </div>
          <div className="bg-gray-900 border border-purple-900 rounded-2xl p-5 space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-purple-900 text-yellow-300 border border-purple-800" />
            <ContactRow phone={phone} website={website} linkClass="text-yellow-400 hover:text-yellow-300" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-yellow-400 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-gray-800 border border-purple-900"
                questionClass="text-white" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 22. CATERING & FOOD ──────────────────────────────────────────────────────
export function CateringFoodTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#fdf8f0', color: '#2c1a00' }}>
      {/* Warm food photography focus */}
      {gallery.length > 0 && (
        <div className="relative h-64 overflow-hidden">
          <img src={gallery[0].url} alt="featured dish" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }} />
          <div className="absolute bottom-4 left-6 text-white">
            <h1 className="text-4xl font-black drop-shadow">{helper.businessName}</h1>
          </div>
        </div>
      )}
      {!gallery.length && (
        <div style={{ background: 'linear-gradient(135deg, #b45309 0%, #92400e 100%)' }} className="px-6 py-12 text-white">
          <div className="max-w-4xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-widest text-amber-200">Catering & Culinary</span>
            <h1 className="text-4xl font-black mt-1">{helper.businessName}</h1>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Chef profile bar */}
        <div className="flex items-center gap-4 mb-8 bg-white rounded-2xl p-4 shadow-sm border border-amber-100">
          <Avatar src={helper.avatar} name={helper.ownerName} size={70}
            className="border-2 border-amber-300 bg-amber-100 text-amber-800" />
          <div className="flex-1">
            <h2 className="font-bold">{helper.ownerName}</h2>
            <p className="text-sm text-amber-700">{helper.tagline}</p>
            <div className="flex gap-3 mt-1">
              <StarRating rating={helper.rating} color="#b45309" size={13} />
              <span className="text-sm text-amber-700">{helper.reviewCount} events catered</span>
              <LocationChip city={helper.city} state={helper.state} className="text-amber-600" />
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-amber-700">{helper.jobsCompleted}</div>
            <div className="text-xs text-amber-500">Events</div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            {helper.bio && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <SectionHead className="text-amber-800">Our Cuisine</SectionHead>
                <p className="leading-relaxed text-amber-900">{helper.bio}</p>
              </section>
            )}

            {services.length > 0 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <SectionHead className="text-amber-800">Catering Menus</SectionHead>
                <div className="space-y-2">
                  {services.map(s => (
                    <div key={s.id} className="flex justify-between items-center py-3 border-b border-amber-100 last:border-b-0">
                      <div>
                        <p className="font-semibold text-amber-900">{s.name}</p>
                        {s.description && <p className="text-xs text-amber-600">{s.description}</p>}
                      </div>
                      {s.price > 0 && <span className="text-amber-800 font-bold">${s.price.toFixed(0)}/{s.priceUnit}</span>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {gallery.length > 1 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <SectionHead className="text-amber-800">Food Gallery</SectionHead>
                <GalleryGrid gallery={gallery.slice(1)} cols={3} rounded="rounded-xl" />
              </section>
            )}

            {reviews.length > 0 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-amber-100">
                <SectionHead className="text-amber-800">Rave Reviews</SectionHead>
                <div className="space-y-3">
                  {reviews.slice(0, 4).map(r => (
                    <ReviewCard key={r.id} review={r} cardClass="bg-amber-50 text-amber-900" />
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-amber-700 text-white rounded-2xl p-5">
              <BadgeList badges={helper.badges} badgeClass="bg-amber-800 text-amber-100" />
              {!helper.badges.length && <p className="text-sm text-amber-100">Licensed & insured kitchen</p>}
            </div>
            <div className="bg-white rounded-2xl p-5 border border-amber-100 shadow-sm">
              <ContactRow phone={phone} website={website} linkClass="text-amber-700 hover:text-amber-800" />
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
    </div>
  );
}

// ─── 23. WEDDING SERVICES ─────────────────────────────────────────────────────
export function WeddingServicesTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-serif" style={{ background: '#fdf6f6', color: '#3d0a1a' }}>
      {/* Romantic rose/blush */}
      {gallery.length > 0 && (
        <div className="relative h-72 overflow-hidden">
          <img src={gallery[0].url} alt="wedding" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(126,34,48,0.8), transparent)' }} />
          <div className="absolute bottom-6 left-0 right-0 text-center text-white">
            <h1 className="text-5xl font-bold drop-shadow">{helper.businessName}</h1>
            <p className="font-sans text-rose-200 mt-1">{helper.tagline}</p>
          </div>
        </div>
      )}
      {!gallery.length && (
        <div style={{ background: 'linear-gradient(135deg, #be185d 0%, #9d174d 100%)' }} className="py-14 text-white text-center">
          <p className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-rose-200">Weddings & Special Events</p>
          <h1 className="text-5xl font-bold mt-2">{helper.businessName}</h1>
          <p className="font-sans text-rose-200 mt-2">{helper.tagline}</p>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="text-center py-2">
            <Avatar src={helper.avatar} name={helper.ownerName} size={80}
              className="mx-auto border-2 border-rose-300 bg-rose-100 text-rose-700 font-sans" />
            <h2 className="text-xl font-bold mt-3">{helper.ownerName}</h2>
            <div className="flex justify-center gap-3 mt-2 font-sans text-sm">
              <StarRating rating={helper.rating} color="#be185d" size={14} />
              <span style={{ color: '#9d174d' }}>{helper.reviewCount} couples</span>
              <LocationChip city={helper.city} state={helper.state} className="text-rose-700" />
            </div>
          </div>

          {helper.bio && (
            <section>
              <h3 className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-rose-500 mb-3">Our Story</h3>
              <p className="text-lg leading-loose">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section>
              <h3 className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-rose-500 mb-4">Services</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} style={{ background: '#fff1f2', border: '1px solid #fecdd3' }} className="rounded-2xl p-4">
                    <p className="font-bold text-rose-900">{s.name}</p>
                    {s.description && <p className="font-sans text-xs text-rose-600 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="font-sans font-bold text-rose-700 text-sm mt-2">from ${s.price.toFixed(0)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 1 && (
            <section>
              <h3 className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-rose-500 mb-4">Wedding Gallery</h3>
              <GalleryGrid gallery={gallery.slice(1)} cols={3} rounded="rounded-2xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section>
              <h3 className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-rose-500 mb-4">Couples Say</h3>
              <div className="space-y-4">
                {reviews.slice(0, 3).map(r => (
                  <blockquote key={r.id} style={{ borderLeft: '3px solid #fda4af' }} className="pl-5">
                    <p className="italic leading-relaxed">"{r.content}"</p>
                    <footer className="font-sans text-xs text-rose-500 mt-2">&mdash; {r.authorName}</footer>
                  </blockquote>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-5">
          <div style={{ background: 'linear-gradient(135deg, #be185d, #9d174d)' }} className="text-white rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-rose-200 text-2xl font-sans font-black" labelClass="text-rose-300 text-xs font-sans" />
          </div>
          <BadgeList badges={helper.badges} badgeClass="bg-rose-100 text-rose-700 border border-rose-200 font-sans text-xs" />
          <ContactRow phone={phone} website={website} linkClass="text-rose-700 hover:underline font-sans text-sm" />
          {faqs.length > 0 && (
            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3' }} className="rounded-2xl p-5">
              <h4 className="font-sans text-xs font-bold uppercase tracking-[0.3em] text-rose-500 mb-3">FAQ</h4>
              <FAQList faqs={faqs} itemClass="bg-rose-50" questionClass="font-sans text-sm text-rose-900"
                answerClass="font-sans text-xs text-rose-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 24. BEAUTY & STYLE ───────────────────────────────────────────────────────
export function BeautyStyleTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#fff0f5', color: '#3d0a1a' }}>
      {/* Feminine pink/rose salon */}
      <div style={{ background: 'linear-gradient(135deg, #db2777 0%, #be185d 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <div className="relative">
            <Sparkles size={18} className="absolute -top-1 -right-1 bg-pink-300 text-pink-700 rounded-full p-1" />
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="border-4 border-pink-200 bg-pink-700 text-white shadow-lg" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-pink-200">Beauty & Style Artist</span>
            <h1 className="text-3xl font-bold mt-1">{helper.businessName}</h1>
            <p className="text-pink-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#fecdd3" />
              <span className="text-pink-200 text-sm">{helper.reviewCount} clients</span>
              <LocationChip city={helper.city} state={helper.state} className="text-pink-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-pink-100">
              <SectionHead className="text-pink-700">My Style</SectionHead>
              <p className="leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-pink-100">
              <SectionHead className="text-pink-700">Services Menu</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-center py-3 border-b border-pink-100 last:border-b-0">
                    <div>
                      {s.popular && <span className="text-xs text-pink-500 font-bold">✦ Client Favorite</span>}
                      <p className="font-semibold text-pink-900">{s.name}</p>
                      {s.description && <p className="text-xs text-pink-500 mt-0.5">{s.description}</p>}
                    </div>
                    {s.price > 0 && <span className="text-pink-700 font-bold">${s.price.toFixed(0)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-pink-100">
              <SectionHead className="text-pink-700">Portfolio</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-2xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-pink-100">
              <SectionHead className="text-pink-700">Client Love</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-pink-50 text-pink-900" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-pink-600 text-white rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-white text-2xl" labelClass="text-pink-200 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5 border border-pink-100 shadow-sm space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-pink-100 text-pink-700 border border-pink-200" />
            <ContactRow phone={phone} website={website} linkClass="text-pink-600 hover:text-pink-700" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-pink-100 shadow-sm">
              <SectionHead className="text-pink-700 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-pink-50" questionClass="text-pink-900" answerClass="text-pink-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 25. BARBERSHOP ───────────────────────────────────────────────────────────
export function BarbershopTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-black text-white">
      {/* Bold black/gold classic barber */}
      <div style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%)', borderBottom: '3px solid #b8860b' }}>
        <div className="max-w-5xl mx-auto px-6 py-12">
          {/* Barber pole decoration */}
          <div className="flex justify-center mb-6">
            <div className="flex items-center gap-3">
              <div className="w-2 h-16 rounded-full" style={{ background: 'repeating-linear-gradient(45deg, #ef4444 0px, #ef4444 4px, #ffffff 4px, #ffffff 8px, #1d4ed8 8px, #1d4ed8 12px)' }} />
              <Scissors size={24} style={{ color: '#b8860b' }} />
              <div className="w-2 h-16 rounded-full" style={{ background: 'repeating-linear-gradient(45deg, #ef4444 0px, #ef4444 4px, #ffffff 4px, #ffffff 8px, #1d4ed8 8px, #1d4ed8 12px)' }} />
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-6">
            <Avatar src={helper.avatar} name={helper.ownerName} size={100}
              className="border-4 border-amber-500 bg-gray-900 text-amber-500" style={{ borderColor: '#b8860b' }} />
            <div className="flex-1 text-center md:text-left">
              <span style={{ color: '#b8860b', fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase' }}>
                Master Barber
              </span>
              <h1 className="text-4xl font-black mt-1" style={{ fontFamily: 'serif' }}>{helper.businessName}</h1>
              <p className="text-gray-400 mt-1">{helper.tagline}</p>
              <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
                <StarRating rating={helper.rating} color="#b8860b" />
                <span className="text-gray-500 text-sm">{helper.reviewCount} cuts</span>
                <LocationChip city={helper.city} state={helper.state} className="text-gray-500" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-gray-900 border border-gray-800 rounded-xl p-5" style={{ borderLeft: '4px solid #b8860b' }}>
              <SectionHead style={{ color: '#b8860b' }}>The Craft</SectionHead>
              <p className="text-gray-300 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-xl p-5" style={{ borderLeft: '4px solid #b8860b' }}>
              <SectionHead style={{ color: '#b8860b' }}>The Menu</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-center py-3 border-b border-gray-800 last:border-b-0">
                    <div>
                      <p className="font-bold">{s.name}</p>
                      {s.description && <p className="text-xs text-gray-500">{s.description}</p>}
                    </div>
                    {s.price > 0 && <span style={{ color: '#b8860b' }} className="font-black">${s.price.toFixed(0)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-xl p-5" style={{ borderLeft: '4px solid #b8860b' }}>
              <SectionHead style={{ color: '#b8860b' }}>The Work</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-none" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-xl p-5" style={{ borderLeft: '4px solid #b8860b' }}>
              <SectionHead style={{ color: '#b8860b' }}>The Word</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-gray-800 text-gray-200" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl p-5" style={{ background: '#111', border: '2px solid #b8860b' }}>
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-2xl font-black" labelClass="text-gray-600 text-xs" />
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-gray-800 border border-gray-700" style={{ color: '#b8860b' }} />
            <ContactRow phone={phone} website={website} linkClass="hover:text-amber-500" style={{ color: '#b8860b' }} />
          </div>
          {faqs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <SectionHead style={{ color: '#b8860b' }} className="text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-gray-800" questionClass="text-white" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 26. SPA & SKINCARE ───────────────────────────────────────────────────────
export function SpaSkincareTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f4f8f3', color: '#1f2d1a' }}>
      {/* Soft sage/neutral zen */}
      <div style={{ background: 'linear-gradient(135deg, #4d7c5a 0%, #3d6e4a 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={96}
            className="border-4 border-green-200 bg-green-700 text-white shadow-lg" />
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-green-200">Esthetician & Skincare Expert</span>
            <h1 className="text-3xl font-light tracking-wide mt-1">{helper.businessName}</h1>
            <p className="text-green-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#bbf7d0" />
              <span className="text-green-200 text-sm">{helper.reviewCount} clients</span>
              <LocationChip city={helper.city} state={helper.state} className="text-green-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #d1e8d0' }}>
              <SectionHead className="text-green-800">Our Philosophy</SectionHead>
              <p className="leading-loose text-green-900">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #d1e8d0' }}>
              <SectionHead className="text-green-800">Treatments</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-center py-3" style={{ borderBottom: '1px solid #e8f4e7' }}>
                    <div>
                      <p className="font-medium text-green-900">{s.name}</p>
                      {s.description && <p className="text-xs text-green-600 mt-0.5">{s.description}</p>}
                    </div>
                    {s.price > 0 && <span className="text-green-800 font-semibold">${s.price.toFixed(0)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #d1e8d0' }}>
              <SectionHead className="text-green-800">Our Space</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #d1e8d0' }}>
              <SectionHead className="text-green-800">Client Glow-Ups</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <div key={r.id} style={{ background: '#f0f8ef', border: '1px solid #d1e8d0' }} className="rounded-xl p-4">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-sm text-green-900">{r.authorName}</span>
                      <StarRating rating={r.rating} size={12} color="#4d7c5a" />
                    </div>
                    <p className="text-xs text-green-700">{r.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div style={{ background: 'linear-gradient(135deg, #4d7c5a, #3d6e4a)' }} className="text-white rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-green-200 text-2xl" labelClass="text-green-400 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5 space-y-3" style={{ border: '1px solid #d1e8d0' }}>
            <BadgeList badges={helper.badges} badgeClass="bg-green-100 text-green-700 border border-green-200" />
            <ContactRow phone={phone} website={website} linkClass="text-green-700 hover:text-green-800" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid #d1e8d0' }}>
              <SectionHead className="text-green-800 text-sm">Questions</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-green-50" questionClass="text-green-900" answerClass="text-green-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 27. TECH & IT ────────────────────────────────────────────────────────────
export function TechITTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-mono bg-gray-950 text-green-400">
      {/* Terminal/dark tech aesthetic */}
      <div className="border-b border-green-800 bg-black px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="flex gap-1.5">
            {['bg-red-500','bg-yellow-500','bg-green-500'].map((c, i) => (
              <div key={i} className={`w-3 h-3 rounded-full ${c}`} />
            ))}
          </div>
          <span className="text-green-500 text-xs">terminal — bash — 80x24</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Typed header */}
        <div className="mb-8 font-mono">
          <p className="text-green-600 text-sm mb-1">$ whoami</p>
          <div className="bg-gray-900 border border-green-900 rounded-xl p-5">
            <div className="flex flex-col md:flex-row items-start gap-5">
              <Avatar src={helper.avatar} name={helper.ownerName} size={80}
                className="border-2 border-green-700 bg-black text-green-400 font-mono" />
              <div>
                <p className="text-green-300 text-lg font-bold">{helper.businessName}</p>
                <p className="text-gray-500 text-sm"># {helper.tagline}</p>
                <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500">
                  <span>rating: {helper.rating?.toFixed(1)}/5.0</span>
                  <span>reviews: {helper.reviewCount}</span>
                  <span>jobs: {helper.jobsCompleted}</span>
                  {(helper.city || helper.state) && (
                    <span>location: {[helper.city, helper.state].filter(Boolean).join(', ')}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            {helper.bio && (
              <div>
                <p className="text-green-600 text-sm mb-1">$ cat about.txt</p>
                <div className="bg-gray-900 border border-green-900 rounded-xl p-5">
                  <p className="text-gray-300 leading-relaxed">{helper.bio}</p>
                </div>
              </div>
            )}

            {services.length > 0 && (
              <div>
                <p className="text-green-600 text-sm mb-1">$ ls services/</p>
                <div className="bg-gray-900 border border-green-900 rounded-xl p-5">
                  <div className="space-y-2">
                    {services.map(s => (
                      <div key={s.id} className="flex justify-between items-center py-2 border-b border-green-900 last:border-b-0">
                        <div>
                          <span className="text-green-400">./</span>
                          <span className="text-white font-medium">{s.name}</span>
                          {s.description && <p className="text-xs text-gray-500 mt-0.5 ml-4"># {s.description}</p>}
                        </div>
                        {s.price > 0 && <span className="text-green-300">${s.price.toFixed(0)}/{s.priceUnit}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {reviews.length > 0 && (
              <div>
                <p className="text-green-600 text-sm mb-1">$ git log --reviews</p>
                <div className="bg-gray-900 border border-green-900 rounded-xl p-5 space-y-3">
                  {reviews.slice(0, 4).map(r => (
                    <div key={r.id} className="border-b border-green-900 pb-3 last:border-b-0 last:pb-0">
                      <div className="flex justify-between">
                        <span className="text-yellow-400 text-xs">commit &lt;{r.authorName.replace(/\s/g, '_')}&gt;</span>
                        <StarRating rating={r.rating} size={11} color="#86efac" />
                      </div>
                      <p className="text-gray-400 text-xs mt-1">{r.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-green-600 text-sm mb-1">$ systeminfo</p>
              <div className="bg-gray-900 border border-green-900 rounded-xl p-5">
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">rating</span>
                    <span className="text-green-400">{helper.rating?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">reviews</span>
                    <span className="text-green-400">{helper.reviewCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">jobs_done</span>
                    <span className="text-green-400">{helper.jobsCompleted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">status</span>
                    <span className="text-green-400">online</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-gray-900 border border-green-900 rounded-xl p-5 space-y-3">
              <BadgeList badges={helper.badges} badgeClass="bg-green-900 text-green-300 border border-green-800 font-mono" />
              <ContactRow phone={phone} website={website} linkClass="text-green-400 hover:text-green-300 font-mono" />
            </div>
            {faqs.length > 0 && (
              <div>
                <p className="text-green-600 text-sm mb-1">$ faq --list</p>
                <div className="bg-gray-900 border border-green-900 rounded-xl p-5">
                  <FAQList faqs={faqs} itemClass="bg-black/50 border border-green-900"
                    questionClass="text-green-400 font-mono" answerClass="text-gray-400 font-mono text-xs" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 28. WEB & APP DEV ────────────────────────────────────────────────────────
export function WebAppDevTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-gray-950 text-white">
      {/* Code/dev dark with colorful syntax */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}
        className="border-b border-indigo-800">
        <div className="max-w-5xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center gap-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-indigo-500 blur-xl opacity-30" />
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="relative border-2 border-indigo-400 bg-indigo-900 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <Code size={14} className="text-indigo-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">Full-Stack Developer</span>
            </div>
            <h1 className="text-3xl font-black">{helper.businessName}</h1>
            <div className="flex gap-1.5 mt-2">
              {['#61dafb','#f7df1e','#3178c6','#68d391'].map(c => (
                <div key={c} className="w-5 h-2 rounded-full" style={{ background: c }} />
              ))}
            </div>
            <p className="text-indigo-200 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#818cf8" />
              <span className="text-indigo-300 text-sm">{helper.reviewCount} clients</span>
              <LocationChip city={helper.city} state={helper.state} className="text-indigo-300" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-gray-900 border border-indigo-900 rounded-2xl p-5">
              <SectionHead className="text-indigo-400">About the Dev</SectionHead>
              <p className="text-gray-300 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-gray-900 border border-indigo-900 rounded-2xl p-5">
              <SectionHead className="text-indigo-400">Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="bg-indigo-950 border border-indigo-800 rounded-xl p-4">
                    {s.popular && <span className="text-xs text-indigo-300 font-bold">⚡ Popular</span>}
                    <p className="font-semibold mt-0.5">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-indigo-400 font-bold text-sm mt-2">from ${s.price.toFixed(0)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-gray-900 border border-indigo-900 rounded-2xl p-5">
              <SectionHead className="text-indigo-400">Project Showcase</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-gray-900 border border-indigo-900 rounded-2xl p-5">
              <SectionHead className="text-indigo-400">Client Reviews</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-indigo-950 border border-indigo-900 text-gray-200" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div style={{ background: 'linear-gradient(135deg, #4338ca, #3730a3)' }} className="rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-indigo-200 text-2xl" labelClass="text-indigo-400 text-xs" />
          </div>
          <div className="bg-gray-900 border border-indigo-900 rounded-2xl p-5 space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-indigo-900 text-indigo-200 border border-indigo-800" />
            <ContactRow phone={phone} website={website} linkClass="text-indigo-400 hover:text-indigo-300" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-gray-900 border border-indigo-900 rounded-2xl p-5">
              <SectionHead className="text-indigo-400 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-indigo-950 border border-indigo-900"
                questionClass="text-white" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 29. CONSULTING & COACHING ────────────────────────────────────────────────
export function ConsultingCoachingTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f8f9fa', color: '#1a1f2e' }}>
      {/* Professional navy/gold */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #162d47 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center gap-8 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={100}
            className="border-4 border-amber-400 bg-blue-800 text-white shadow-xl" style={{ borderColor: '#d4af37' }} />
          <div className="flex-1 text-center md:text-left">
            <span style={{ color: '#d4af37', fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase' }}>
              Senior Consultant & Coach
            </span>
            <h1 className="text-3xl font-bold mt-2">{helper.businessName}</h1>
            <p className="text-blue-200 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-4 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#d4af37" />
              <span className="text-blue-300 text-sm">{helper.reviewCount} clients</span>
              <LocationChip city={helper.city} state={helper.state} className="text-blue-300" />
            </div>
          </div>
          <div className="flex gap-6">
            {[{ v: helper.rating?.toFixed(1), l: 'Rating' }, { v: helper.jobsCompleted, l: 'Engagements' }].map(s => (
              <div key={s.l} className="text-center">
                <div className="text-3xl font-black" style={{ color: '#d4af37' }}>{s.v}</div>
                <div className="text-xs text-blue-400">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {helper.bio && (
            <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-bold text-lg mb-3" style={{ color: '#1e3a5f' }}>Executive Summary</h3>
              <p className="leading-relaxed text-gray-700">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-bold text-lg mb-4" style={{ color: '#1e3a5f' }}>Practice Areas</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="rounded-xl p-4 border-l-4"
                    style={{ background: '#f8f9fa', borderLeftColor: '#d4af37', border: '1px solid #e8e8e8', borderLeft: '4px solid #d4af37' }}>
                    <p className="font-bold" style={{ color: '#1e3a5f' }}>{s.name}</p>
                    {s.description && <p className="text-xs text-gray-500 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="font-bold text-sm mt-2" style={{ color: '#d4af37' }}>from ${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-bold text-lg mb-4" style={{ color: '#1e3a5f' }}>Client Testimonials</h3>
              <div className="space-y-4">
                {reviews.slice(0, 3).map(r => (
                  <div key={r.id} className="rounded-xl p-4 bg-gray-50 border border-gray-100">
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-sm" style={{ color: '#1e3a5f' }}>{r.authorName}</span>
                      <StarRating rating={r.rating} size={12} color="#d4af37" />
                    </div>
                    <p className="text-sm text-gray-600">{r.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {faqs.length > 0 && (
            <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-bold text-lg mb-4" style={{ color: '#1e3a5f' }}>FAQ</h3>
              <FAQList faqs={faqs} itemClass="bg-gray-50 border border-gray-100"
                questionClass="font-semibold" answerClass="text-gray-600" />
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #1e3a5f, #162d47)' }}>
            <BadgeList badges={helper.badges} badgeClass="bg-blue-800 text-white border border-blue-700" />
            {!helper.badges.length && <p className="text-sm text-blue-200">Certified consultant</p>}
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <ContactRow phone={phone} website={website} linkClass="hover:underline font-semibold" style={{ color: '#1e3a5f' }} />
          </div>
          {gallery.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h4 className="font-bold text-sm mb-3" style={{ color: '#1e3a5f' }}>Media</h4>
              <GalleryGrid gallery={gallery} cols={2} rounded="rounded-lg" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 30. LEGAL & ADMINISTRATIVE ───────────────────────────────────────────────
export function LegalAdminTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f4f5f7', color: '#1a1f2e' }}>
      {/* Formal dark navy serious */}
      <div style={{ background: '#0f1b2d', borderBottom: '4px solid #c9a227' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={96}
            className="border-4 border-yellow-600 bg-blue-950 text-yellow-500" style={{ borderColor: '#c9a227' }} />
          <div className="flex-1 text-center md:text-left">
            <span style={{ color: '#c9a227', fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase' }}>
              Legal & Administrative Services
            </span>
            <h1 className="text-3xl font-bold mt-1">{helper.businessName}</h1>
            <p className="text-blue-300 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#c9a227" />
              <span className="text-blue-400 text-sm">{helper.reviewCount} clients served</span>
              <LocationChip city={helper.city} state={helper.state} className="text-blue-400" />
            </div>
          </div>
          <div className="flex gap-5">
            {[{ v: helper.rating?.toFixed(1), l: 'Rating' }, { v: helper.jobsCompleted, l: 'Cases' }].map(s => (
              <div key={s.l} className="text-center">
                <div className="text-2xl font-black" style={{ color: '#c9a227' }}>{s.v}</div>
                <div className="text-xs text-blue-400">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <h3 className="font-bold text-lg mb-3 pb-2" style={{ color: '#0f1b2d', borderBottom: '2px solid #c9a227' }}>Profile</h3>
              <p className="leading-relaxed text-gray-700">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <h3 className="font-bold text-lg mb-4 pb-2" style={{ color: '#0f1b2d', borderBottom: '2px solid #c9a227' }}>Practice Areas</h3>
              <div className="space-y-2">
                {services.map(s => (
                  <div key={s.id} className="flex justify-between items-start py-3 border-b border-gray-100 last:border-b-0">
                    <div>
                      <p className="font-semibold" style={{ color: '#0f1b2d' }}>{s.name}</p>
                      {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                    </div>
                    {s.price > 0 && <span className="font-bold text-sm" style={{ color: '#c9a227' }}>from ${s.price.toFixed(0)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <h3 className="font-bold text-lg mb-4 pb-2" style={{ color: '#0f1b2d', borderBottom: '2px solid #c9a227' }}>Client Testimonials</h3>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <div key={r.id} className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                    <div className="flex justify-between mb-1">
                      <span className="font-semibold text-sm" style={{ color: '#0f1b2d' }}>{r.authorName}</span>
                      <StarRating rating={r.rating} size={12} color="#c9a227" />
                    </div>
                    <p className="text-xs text-gray-600">{r.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {faqs.length > 0 && (
            <section className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <h3 className="font-bold text-lg mb-4 pb-2" style={{ color: '#0f1b2d', borderBottom: '2px solid #c9a227' }}>FAQ</h3>
              <FAQList faqs={faqs} itemClass="bg-gray-50 border border-gray-100"
                questionClass="font-semibold text-gray-900" answerClass="text-gray-600" />
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl p-5 text-white" style={{ background: '#0f1b2d' }}>
            <BadgeList badges={helper.badges} badgeClass="bg-blue-950 text-yellow-400 border border-yellow-800" />
            {!helper.badges.length && <p className="text-sm text-blue-300">Licensed professional</p>}
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
            <ContactRow phone={phone} website={website} linkClass="font-semibold hover:underline" style={{ color: '#0f1b2d' }} />
          </div>
          {gallery.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200">
              <h4 className="font-bold text-sm mb-3" style={{ color: '#0f1b2d' }}>Office</h4>
              <GalleryGrid gallery={gallery} cols={2} rounded="rounded-lg" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
