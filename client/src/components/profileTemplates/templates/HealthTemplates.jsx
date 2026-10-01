// HealthTemplates.jsx — Health & Wellness templates (4 templates)
// Each designed for its specific wellness industry with distinct visual identity.
import {
  StarRating, Avatar, BadgeList, GalleryGrid, ReviewCard, FAQList,
  LocationChip, ContactRow, SectionHead, ChecklistRow,
  HorizontalServiceBar, SpecialtyPill, QuoteBlock, ProcessStep, PackageCard,
} from '../shared.jsx';
import { Dumbbell, Heart, Leaf, Brain, Shield, CheckCircle, Clock, Calendar } from 'lucide-react';

// ─── 13. FITNESS PRO ──────────────────────────────────────────────────────────
// High-energy gym aesthetic. Dark/bold. Transformation counter.
// Full-width sections, no sidebar. Training specialties as chips.
export function FitnessProTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const specialties = ['Weight Loss', 'Muscle Building', 'HIIT', 'Strength Training', 'Cardio', 'Flexibility', 'Sports Conditioning', 'Rehabilitation'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#0a0a0a', color: '#ffffff' }}>
      {/* Power hero */}
      <div className="relative overflow-hidden" style={{ minHeight: 280 }}>
        {helper.coverImage
          ? <img src={helper.coverImage} alt="training" className="w-full h-72 object-cover opacity-60" />
          : <div className="h-72" style={{ background: 'linear-gradient(135deg, #1a0a0a 0%, #3d0000 50%, #7f1d1d 100%)' }} />}
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(10,10,10,0.95) 90%)' }} />
        <div className="absolute bottom-0 start-0 end-0 px-6 pb-6">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end gap-5">
              <Avatar src={helper.avatar} name={helper.ownerName} size={88}
                className="border-4 flex-shrink-0" style={{ borderColor: '#ef4444', background: '#1a0000', color: '#fca5a5' }} />
              <div className="pb-1">
                <div className="flex items-center gap-2 mb-1">
                  <Dumbbell size={14} style={{ color: '#ef4444' }} />
                  <span className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: '#ef4444' }}>Certified Personal Trainer</span>
                </div>
                <h1 className="text-3xl font-black">{helper.businessName}</h1>
                <p style={{ color: '#d4d4d4' }} className="text-sm mt-0.5">{helper.tagline}</p>
                <div className="flex items-center gap-3 mt-2">
                  <StarRating rating={helper.rating} color="#ef4444" size={13} />
                  <span style={{ color: '#a3a3a3' }} className="text-xs">{helper.reviewCount} clients</span>
                  <LocationChip city={helper.city} state={helper.state} className="text-gray-500 text-xs" />
                </div>
              </div>
            </div>
            {/* Stats strip */}
            <div className="grid grid-cols-3 gap-3 mt-6">
              {[
                { v: helper.jobsCompleted ?? 0, l: 'Clients Trained' },
                { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
                { v: `${helper.reviewCount}+`, l: 'Success Stories' },
              ].map(s => (
                <div key={s.l} className="rounded-xl p-3 text-center"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <div className="text-xl font-black" style={{ color: '#ef4444' }}>{s.v}</div>
                  <div className="text-xs text-gray-500">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Training specialties */}
        <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1a1a1a' }}>
          <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#ef4444' }}>
            Training Specialties
          </span>
          <div className="flex flex-wrap gap-2">
            {specialties.map(s => (
              <SpecialtyPill key={s} label={s}
                pillClass="text-red-300 font-semibold text-xs bg-red-950 border border-red-900" />
            ))}
          </div>
        </section>

        {helper.bio && (
          <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1a1a1a' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#ef4444' }}>My Philosophy</span>
            <p style={{ color: '#d4d4d4' }} className="leading-relaxed">{helper.bio}</p>
          </section>
        )}

        {services.length > 0 && (
          <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1a1a1a' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#ef4444' }}>Training Programs</span>
            <div className="grid sm:grid-cols-2 gap-3">
              {services.map(s => (
                <div key={s.id} className="rounded-xl p-4"
                  style={{ background: '#1a1a1a', border: '1px solid #222' }}>
                  {s.popular && <span className="text-xs font-bold text-red-400 uppercase block mb-1">Most Popular</span>}
                  <p className="font-bold">{s.name}</p>
                  {s.description && <p className="text-xs text-gray-500 mt-1">{s.description}</p>}
                  {s.price > 0 && <p className="text-sm font-black mt-2" style={{ color: '#ef4444' }}>${s.price.toFixed(0)}/{s.priceUnit}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {gallery.length > 0 && (
          <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1a1a1a' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#ef4444' }}>Results & Gallery</span>
            <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
          </section>
        )}

        {reviews.length > 0 && (
          <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #1a1a1a' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#ef4444' }}>Client Results</span>
            <div className="grid sm:grid-cols-2 gap-3">
              {reviews.slice(0, 4).map(r => (
                <div key={r.id} className="rounded-xl p-4" style={{ background: '#1a1a1a' }}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-sm">{r.authorName}</span>
                    <StarRating rating={r.rating} size={11} color="#ef4444" />
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-3">{r.content}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {helper.badges.length > 0 && (
          <BadgeList badges={helper.badges} badgeClass="bg-red-950 text-red-300 border border-red-900" />
        )}

        <div className="rounded-2xl p-5 flex flex-wrap gap-4 items-center justify-between"
          style={{ background: '#ef4444' }}>
          <div>
            <p className="font-black text-lg">Ready to Transform?</p>
            <p className="text-red-100 text-sm">Book your first session today</p>
          </div>
          <ContactRow phone={phone} website={website} linkClass="text-white font-semibold hover:text-red-100" />
        </div>
      </div>
    </div>
  );
}

// ─── 14. WELLNESS & THERAPY ───────────────────────────────────────────────────
// Calm, spacious, single-column. Soft sage green palette.
// Modalities listed with descriptions. Intake process steps. No sidebar.
export function WellnessTherapyTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const modalities = ['Yoga', 'Reiki', 'Sound Healing', 'Meditation', 'Breathwork', 'Somatic Therapy', 'Acupressure', 'Crystal Healing'];
  const processSteps = [
    { n: 1, t: 'Intake Conversation', d: 'We discuss your goals and wellbeing needs' },
    { n: 2, t: 'Personalized Plan', d: 'A tailored approach designed for you' },
    { n: 3, t: 'Session', d: 'A safe, supportive healing experience' },
    { n: 4, t: 'Integration', d: 'Guidance for continuing your journey' },
  ];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f6f9f6', color: '#1a2e1a' }}>
      {/* Soft sage hero */}
      <div style={{ background: 'linear-gradient(135deg, #4a7c59 0%, #2d5a40 100%)' }}>
        <div className="max-w-3xl mx-auto px-6 py-12 text-white text-center">
          <Avatar src={helper.avatar} name={helper.ownerName} size={88}
            className="mx-auto mb-4 border-4" style={{ borderColor: 'rgba(255,255,255,0.4)', background: '#1e4433', color: '#a7f3d0' }} />
          <span className="text-xs font-bold uppercase tracking-[0.4em] text-green-200 block mb-2">Wellness & Holistic Therapy</span>
          <h1 className="text-3xl font-bold">{helper.businessName}</h1>
          <p className="text-green-100 mt-2 text-sm max-w-md mx-auto">{helper.tagline}</p>
          <div className="flex items-center justify-center gap-4 mt-4">
            <StarRating rating={helper.rating} color="#a7f3d0" size={14} />
            <span className="text-green-200 text-xs">{helper.reviewCount} clients</span>
            <LocationChip city={helper.city} state={helper.state} className="text-green-200 text-xs" />
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        {/* Modalities */}
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
          <SectionHead className="text-green-700">Modalities & Approaches</SectionHead>
          <div className="flex flex-wrap gap-2">
            {modalities.map(m => (
              <span key={m} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46' }}>
                <Leaf size={10} />{m}
              </span>
            ))}
          </div>
        </section>

        {helper.bio && (
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <SectionHead className="text-green-700">About My Practice</SectionHead>
            <p style={{ color: '#2d5a40' }} className="leading-relaxed">{helper.bio}</p>
          </section>
        )}

        {/* Session types */}
        {services.length > 0 && (
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <SectionHead className="text-green-700">Session Types</SectionHead>
            <div className="space-y-3">
              {services.map(s => (
                <div key={s.id} className="flex justify-between items-start p-4 rounded-xl"
                  style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                  <div className="flex gap-3 items-start">
                    <Heart size={16} className="mt-0.5 flex-shrink-0" style={{ color: '#4a7c59' }} />
                    <div>
                      <p className="font-semibold text-sm" style={{ color: '#1a2e1a' }}>{s.name}</p>
                      {s.description && <p className="text-xs mt-0.5" style={{ color: '#4a7c59' }}>{s.description}</p>}
                    </div>
                  </div>
                  {s.price > 0 && <p className="text-sm font-bold ms-4" style={{ color: '#2d5a40' }}>${s.price.toFixed(0)}/{s.priceUnit}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* How it works */}
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
          <SectionHead className="text-green-700">The Process</SectionHead>
          <div className="space-y-4">
            {processSteps.map(s => (
              <ProcessStep key={s.n} number={s.n} title={s.t} description={s.d}
                numBg="#4a7c59" textClass="text-green-900" />
            ))}
          </div>
        </section>

        {reviews.length > 0 && (
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <SectionHead className="text-green-700">Client Experiences</SectionHead>
            <div className="space-y-4">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor="#4a7c59" textClass="text-green-900" authorClass="text-green-600" />
              ))}
            </div>
          </section>
        )}

        {helper.badges.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
            <BadgeList badges={helper.badges} badgeClass="bg-green-50 text-green-700 border border-green-200" />
          </div>
        )}

        {/* Booking note */}
        <div className="rounded-2xl p-5 text-center" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
          <p className="font-semibold text-green-800">Ready to Begin Your Journey?</p>
          <p className="text-green-600 text-sm mt-1 mb-3">All sessions are confidential and held in a safe, nurturing space.</p>
          <ContactRow phone={phone} website={website} linkClass="text-green-700 font-semibold hover:text-green-900" />
        </div>

        {faqs.length > 0 && (
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <SectionHead className="text-green-700">FAQ</SectionHead>
            <FAQList faqs={faqs} itemClass="bg-green-50" questionClass="text-green-900" answerClass="text-green-700" />
          </section>
        )}
      </div>
    </div>
  );
}

// ─── 15. NUTRITION & DIET ────────────────────────────────────────────────────
// Food-forward. Dietary specialty chips lead. Warm orange/citrus palette.
// Meal plan preview snippet. 2-column services as plan cards.
export function NutritionDietTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const dietaryTypes = ['Vegan', 'Vegetarian', 'Keto', 'Paleo', 'Gluten-Free', 'Dairy-Free', 'Whole30', 'Mediterranean', 'Allergy-Friendly', 'Sports Nutrition'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#fff7ed', color: '#431407' }}>
      {/* Warm citrus hero */}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)' }}>
        {helper.coverImage && (
          <img src={helper.coverImage} alt="food" className="absolute inset-0 w-full h-full object-cover opacity-25" />
        )}
        <div className="relative max-w-4xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="border-4 flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.4)', background: '#9a3412', color: '#fed7aa' }} />
            <div className="text-center sm:text-start">
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-orange-200 block mb-1">
                Registered Nutritionist & Diet Coach
              </span>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p className="text-orange-100 text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#fed7aa" size={13} />
                <span className="text-orange-200 text-xs">{helper.reviewCount} clients</span>
                <LocationChip city={helper.city} state={helper.state} className="text-orange-200 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Dietary specialties */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
            <SectionHead className="text-orange-700">Dietary Specialties</SectionHead>
            <div className="flex flex-wrap gap-2">
              {dietaryTypes.map(d => (
                <span key={d} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#c2410c' }}>{d}</span>
              ))}
            </div>
          </section>

          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <SectionHead className="text-orange-700">My Approach</SectionHead>
              <p style={{ color: '#431407' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <SectionHead className="text-orange-700">Programs & Consultations</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="rounded-xl p-4"
                    style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                    {s.popular && <span className="text-xs font-bold text-orange-500 uppercase block mb-1">Most Popular</span>}
                    <p className="font-bold text-sm text-orange-900">{s.name}</p>
                    {s.description && <p className="text-xs mt-1 text-orange-700">{s.description}</p>}
                    {s.price > 0 && <p className="text-sm font-black mt-2 text-orange-600">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <SectionHead className="text-orange-700">Meal Inspiration</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <SectionHead className="text-orange-700">Client Transformations</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 3).map(r => (
                  <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                    accentColor="#ea580c" textClass="text-orange-900" authorClass="text-orange-600" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: '#ea580c' }}>
            <div className="grid grid-cols-3 gap-3 text-center text-white">
              {[
                { v: helper.jobsCompleted ?? 0, l: 'Clients' },
                { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
                { v: `${helper.reviewCount}+`, l: 'Reviews' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-xl font-black">{s.v}</div>
                  <div className="text-xs text-orange-200">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
          {helper.badges.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-orange-100 shadow-sm">
              <BadgeList badges={helper.badges} badgeClass="bg-orange-50 text-orange-700 border border-orange-200" />
            </div>
          )}
          <div className="bg-white rounded-2xl p-5 border border-orange-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-orange-600 hover:text-orange-800" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-orange-100 shadow-sm">
              <SectionHead className="text-orange-700 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-orange-50" questionClass="text-orange-900" answerClass="text-orange-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 16. MENTAL HEALTH ────────────────────────────────────────────────────────
// Warm, safe-space design. Approach/modality FIRST. Confidentiality note.
// Extremely calming warm teal palette. Single warm column, no aggressive layouts.
export function MentalHealthTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const approaches = ['Cognitive Behavioral Therapy (CBT)', 'Dialectical Behavior Therapy (DBT)', 'Mindfulness-Based', 'Trauma-Informed', 'Solution-Focused', 'Person-Centered', 'Psychodynamic', 'EMDR'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f5f9f8', color: '#1a2e2b' }}>
      {/* Soft, non-clinical header */}
      <div style={{ background: 'linear-gradient(135deg, #0f766e 0%, #115e59 100%)' }}>
        <div className="max-w-3xl mx-auto px-6 py-10 text-white text-center">
          <Avatar src={helper.avatar} name={helper.ownerName} size={88}
            className="mx-auto mb-4 border-4" style={{ borderColor: 'rgba(255,255,255,0.3)', background: '#134e4a', color: '#99f6e4' }} />
          <span className="text-xs font-bold uppercase tracking-[0.3em] text-teal-200 block mb-2">
            Licensed Mental Health Professional
          </span>
          <h1 className="text-2xl font-bold">{helper.businessName}</h1>
          <p className="text-teal-100 text-sm mt-2 max-w-md mx-auto">{helper.tagline}</p>
          <div className="flex items-center justify-center gap-4 mt-3">
            <StarRating rating={helper.rating} color="#99f6e4" size={13} />
            <span className="text-teal-200 text-xs">{helper.reviewCount} clients</span>
            <LocationChip city={helper.city} state={helper.state} className="text-teal-200 text-xs" />
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        {/* Confidentiality notice — most important for mental health */}
        <div className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
          <Shield size={18} className="flex-shrink-0 mt-0.5 text-teal-600" />
          <div>
            <p className="font-semibold text-sm text-teal-800">Your Privacy is Protected</p>
            <p className="text-xs text-teal-600 mt-0.5">
              All sessions are strictly confidential. What you share stays between us, in accordance with professional ethical guidelines.
            </p>
          </div>
        </div>

        {/* Therapeutic approaches */}
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-teal-100">
          <SectionHead className="text-teal-700">Therapeutic Approaches</SectionHead>
          <div className="space-y-2">
            {approaches.map(a => (
              <div key={a} className="flex items-center gap-2 py-1">
                <CheckCircle size={14} className="flex-shrink-0 text-teal-500" />
                <span className="text-sm text-teal-900">{a}</span>
              </div>
            ))}
          </div>
        </section>

        {helper.bio && (
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-teal-100">
            <SectionHead className="text-teal-700">About My Practice</SectionHead>
            <p style={{ color: '#1a2e2b' }} className="leading-relaxed">{helper.bio}</p>
          </section>
        )}

        {services.length > 0 && (
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-teal-100">
            <SectionHead className="text-teal-700">Session Types</SectionHead>
            <div className="space-y-3">
              {services.map(s => (
                <div key={s.id} className="flex justify-between items-start p-4 rounded-xl"
                  style={{ background: '#f0fdfa', border: '1px solid #ccfbf1' }}>
                  <div>
                    <p className="font-semibold text-sm text-teal-900">{s.name}</p>
                    {s.description && <p className="text-xs text-teal-600 mt-0.5">{s.description}</p>}
                  </div>
                  {s.price > 0 && <p className="text-sm font-bold text-teal-700 ms-4 whitespace-nowrap">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {helper.badges.length > 0 && (
          <div className="bg-white rounded-2xl p-5 border border-teal-100 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-teal-600 mb-3">Credentials & Licenses</p>
            <BadgeList badges={helper.badges} badgeClass="bg-teal-50 text-teal-700 border border-teal-200" />
          </div>
        )}

        {reviews.length > 0 && (
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-teal-100">
            <SectionHead className="text-teal-700">Client Experiences</SectionHead>
            <p className="text-xs text-teal-500 mb-4 italic">Reviews shared with client permission. Names may be changed for privacy.</p>
            <div className="space-y-4">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor="#0f766e" textClass="text-teal-900" authorClass="text-teal-600" />
              ))}
            </div>
          </section>
        )}

        {/* First session info */}
        <section className="rounded-2xl p-5" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
          <p className="font-semibold text-teal-800 mb-2">Your First Session</p>
          <p className="text-teal-700 text-sm leading-relaxed">
            The first session is a 50-minute intake where we get to know each other, discuss your goals, and determine if we're a good fit. There's no pressure or commitment beyond that conversation.
          </p>
          <div className="mt-4">
            <ContactRow phone={phone} website={website} linkClass="text-teal-700 font-semibold hover:text-teal-900" />
          </div>
        </section>

        {faqs.length > 0 && (
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-teal-100">
            <SectionHead className="text-teal-700">FAQ</SectionHead>
            <FAQList faqs={faqs} itemClass="bg-teal-50" questionClass="text-teal-900" answerClass="text-teal-700" />
          </section>
        )}
      </div>
    </div>
  );
}
