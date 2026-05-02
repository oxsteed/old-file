// HealthTemplates.jsx — Health & Wellness templates (4 templates)
import {
  StarRating, Avatar, BadgeList, ServiceCard, GalleryGrid,
  ReviewCard, FAQList, LocationChip, StatsRow, ContactRow, SectionHead,
} from '../shared.jsx';
import { Activity, Heart, Apple, Brain } from 'lucide-react';

// ─── 13. FITNESS PRO ─────────────────────────────────────────────────────────
export function FitnessProTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-gray-950 text-white">
      {/* High energy red/black */}
      <div style={{ background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 50%, #111 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center gap-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-red-500 blur-2xl opacity-30" />
            <Avatar src={helper.avatar} name={helper.ownerName} size={100}
              className="relative border-4 border-red-400 bg-red-900 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <Activity size={14} className="text-red-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-red-400">Certified Fitness Professional</span>
            </div>
            <h1 className="text-4xl font-black">{helper.businessName}</h1>
            <p className="text-gray-300 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-4 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#f87171" />
              <span className="text-gray-400 text-sm">{helper.reviewCount} reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-gray-400" />
            </div>
          </div>
          {/* Stats bar */}
          <div className="flex gap-6">
            {[
              { v: helper.rating?.toFixed(1), l: 'Rating' },
              { v: helper.jobsCompleted, l: 'Sessions' },
            ].map(s => (
              <div key={s.l} className="text-center">
                <div className="text-3xl font-black text-red-400">{s.v}</div>
                <div className="text-xs text-gray-500">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-red-400 uppercase tracking-wide text-base">Training Philosophy</SectionHead>
              <p className="text-gray-300 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-red-400 uppercase tracking-wide text-base">Training Programs</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id}
                    className="bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-red-500 transition-colors"
                    style={s.popular ? { borderColor: '#dc2626', boxShadow: '0 0 8px rgba(220,38,38,0.2)' } : {}}>
                    {s.popular && <span className="text-xs text-red-400 font-bold uppercase">Most Popular</span>}
                    <p className="font-bold mt-0.5">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-red-400 font-bold mt-2">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-red-400 uppercase tracking-wide text-base">Transformations</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-red-400 uppercase tracking-wide text-base">Client Results</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-gray-800 text-gray-200" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-red-900 border border-red-700 rounded-2xl p-5">
            <BadgeList badges={helper.badges} badgeClass="bg-red-800 text-white border border-red-700" />
            {!helper.badges.length && <p className="text-sm text-red-200">Certified Personal Trainer</p>}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <ContactRow phone={phone} website={website} linkClass="text-red-400 hover:text-red-300" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-red-400 text-sm uppercase tracking-wide">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-gray-800" questionClass="text-white" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 14. WELLNESS & THERAPY ───────────────────────────────────────────────────
export function WellnessTherapyTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f5f0ff', color: '#2e1065' }}>
      {/* Soft lavender/sage */}
      <div style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4c1d95 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center gap-6 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={100}
            className="border-4 border-purple-200 bg-purple-800 text-white shadow-lg" />
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <Heart size={14} className="text-purple-200" />
              <span className="text-xs font-bold uppercase tracking-widest text-purple-200">Holistic Wellness</span>
            </div>
            <h1 className="text-3xl font-bold">{helper.businessName}</h1>
            <p className="text-purple-200 mt-1 text-sm">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#e9d5ff" />
              <span className="text-purple-200 text-sm">{helper.reviewCount} clients</span>
              <LocationChip city={helper.city} state={helper.state} className="text-purple-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #e9d5ff' }}>
              <SectionHead className="text-violet-700">Approach & Philosophy</SectionHead>
              <p style={{ color: '#3b1f6e', lineHeight: '1.8' }}>{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #e9d5ff' }}>
              <SectionHead className="text-violet-700">Sessions & Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} style={{ background: '#faf5ff', border: '1px solid #ddd6fe' }} className="rounded-xl p-4">
                    <p className="font-semibold text-violet-900">{s.name}</p>
                    {s.description && <p className="text-xs mt-1 text-violet-600">{s.description}</p>}
                    {s.price > 0 && <p className="text-violet-700 font-bold text-sm mt-2">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #e9d5ff' }}>
              <SectionHead className="text-violet-700">Space & Setting</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: '1px solid #e9d5ff' }}>
              <SectionHead className="text-violet-700">Client Experiences</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <div key={r.id} style={{ background: '#faf5ff', border: '1px solid #ddd6fe' }} className="rounded-xl p-4">
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-sm text-violet-900">{r.authorName}</span>
                      <StarRating rating={r.rating} size={12} color="#7c3aed" />
                    </div>
                    <p className="text-xs text-violet-700">{r.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }} className="text-white rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-purple-200 text-2xl" labelClass="text-purple-400 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid #e9d5ff' }}>
            <BadgeList badges={helper.badges} badgeClass="bg-violet-100 text-violet-700 border border-violet-200" />
            <div className="mt-3">
              <ContactRow phone={phone} website={website} linkClass="text-violet-600 hover:text-violet-700" />
            </div>
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid #e9d5ff' }}>
              <SectionHead className="text-violet-700 text-sm">Common Questions</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-violet-50 border border-violet-100"
                questionClass="text-violet-900" answerClass="text-violet-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 15. NUTRITION & DIET ────────────────────────────────────────────────────
export function NutritionDietTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f0faf0', color: '#1a3a1a' }}>
      {/* Fresh green/white health aesthetic */}
      <div style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <div className="relative">
            <Apple size={24} className="absolute -top-2 -right-2 bg-green-300 text-green-800 rounded-full p-1" />
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="border-4 border-green-200 bg-green-700 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-green-200">Registered Nutrition Expert</span>
            <h1 className="text-3xl font-bold mt-1">{helper.businessName}</h1>
            <p className="text-green-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#bbf7d0" />
              <span className="text-green-200 text-sm">{helper.reviewCount} reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-green-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">My Approach</SectionHead>
              <p className="text-green-900 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Programs & Plans</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="bg-green-50 border border-green-200 rounded-xl p-4">
                    <p className="font-semibold text-green-900">{s.name}</p>
                    {s.description && <p className="text-xs text-green-700 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-green-700 font-bold text-sm mt-2">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Meals & Results</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
              <SectionHead className="text-green-700">Success Stories</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-green-50 text-green-900" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-green-600 text-white rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-white text-2xl" labelClass="text-green-200 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5 border border-green-100 shadow-sm space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-green-100 text-green-700 border border-green-200" />
            <ContactRow phone={phone} website={website} linkClass="text-green-700 hover:text-green-800" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-green-100 shadow-sm">
              <SectionHead className="text-green-700 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-green-50 border border-green-100"
                questionClass="text-green-900" answerClass="text-green-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 16. MENTAL HEALTH ────────────────────────────────────────────────────────
export function MentalHealthTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#eff6ff', color: '#1e3a5f' }}>
      {/* Soft blue/white warm welcoming */}
      <div style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center gap-6 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={100}
            className="border-4 border-blue-200 bg-blue-700 text-white shadow-lg" />
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <Brain size={14} className="text-blue-200" />
              <span className="text-xs font-bold uppercase tracking-widest text-blue-200">Licensed Mental Health Professional</span>
            </div>
            <h1 className="text-3xl font-bold">{helper.businessName}</h1>
            <p className="text-blue-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#bfdbfe" />
              <span className="text-blue-200 text-sm">{helper.reviewCount} clients</span>
              <LocationChip city={helper.city} state={helper.state} className="text-blue-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-700">About My Practice</SectionHead>
              <p className="text-blue-900 leading-loose">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-700">Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <p className="font-semibold text-blue-900">{s.name}</p>
                    {s.description && <p className="text-xs text-blue-600 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-blue-700 font-bold text-sm mt-2">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-700">Client Voices</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <div key={r.id} className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <div className="flex justify-between mb-1">
                      <span className="font-semibold text-sm text-blue-900">{r.authorName}</span>
                      <StarRating rating={r.rating} size={12} color="#3b82f6" />
                    </div>
                    <p className="text-xs text-blue-700">{r.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {faqs.length > 0 && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-700">Common Questions</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-blue-50 border border-blue-100"
                questionClass="text-blue-900 font-semibold" answerClass="text-blue-700" />
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }} className="text-white rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-blue-200 text-2xl" labelClass="text-blue-300 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-blue-100 text-blue-700 border border-blue-200" />
            <ContactRow phone={phone} website={website} linkClass="text-blue-600 hover:text-blue-700" />
          </div>
          {gallery.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm">
              <SectionHead className="text-blue-700 text-sm">Space</SectionHead>
              <GalleryGrid gallery={gallery} cols={2} rounded="rounded-xl" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
