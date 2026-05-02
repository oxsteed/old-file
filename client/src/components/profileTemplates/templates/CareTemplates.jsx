// CareTemplates.jsx — Care & Education templates (4 templates)
import {
  StarRating, Avatar, BadgeList, ServiceCard, GalleryGrid,
  ReviewCard, FAQList, LocationChip, StatsRow, ContactRow, SectionHead,
} from '../shared.jsx';
import { Shield, PawPrint, BookOpen, Star } from 'lucide-react';

// ─── 17. CARE & TRUST ────────────────────────────────────────────────────────
export function CareTrustTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#fff7f5', color: '#3b1a10' }}>
      {/* Soft pink/warm white safety emphasis */}
      <div style={{ background: 'linear-gradient(135deg, #e11d48 0%, #be185d 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <div className="relative">
            <Shield size={22} className="absolute -top-2 -right-2 bg-white text-rose-600 rounded-full p-1.5 shadow" />
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="border-4 border-rose-200 bg-rose-800 text-white shadow-lg" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-rose-200">Trusted & Background-Checked Caregiver</span>
            <h1 className="text-3xl font-bold mt-1">{helper.businessName}</h1>
            <p className="text-rose-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#fda4af" />
              <span className="text-rose-200 text-sm">{helper.reviewCount} families</span>
              <LocationChip city={helper.city} state={helper.state} className="text-rose-200" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-rose-100">
              <SectionHead className="text-rose-700">About Me</SectionHead>
              <p className="leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-rose-100">
              <SectionHead className="text-rose-700">Care Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="bg-rose-50 border border-rose-100 rounded-xl p-4">
                    <p className="font-semibold text-rose-900">{s.name}</p>
                    {s.description && <p className="text-xs text-rose-600 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-rose-700 font-bold text-sm mt-2">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-rose-100">
              <SectionHead className="text-rose-700">Photos</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-rose-100">
              <SectionHead className="text-rose-700">Family Reviews</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-rose-50 text-rose-900" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-rose-600 text-white rounded-2xl p-5">
            <p className="text-sm font-bold text-rose-200 mb-3">Safety First</p>
            <BadgeList badges={helper.badges} badgeClass="bg-rose-700 text-white" />
            {!helper.badges.length && <p className="text-sm text-rose-100">Background-checked & CPR certified</p>}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-rose-100 shadow-sm">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-rose-600 text-2xl" labelClass="text-gray-500 text-xs" />
          </div>
          <div className="bg-white rounded-2xl p-5 border border-rose-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-rose-600 hover:text-rose-700" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-rose-100 shadow-sm">
              <SectionHead className="text-rose-700 text-sm">Questions</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-rose-50" questionClass="text-rose-900" answerClass="text-rose-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 18. PET SERVICES ─────────────────────────────────────────────────────────
export function PetServicesTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans" style={{ background: '#fffbf0', color: '#3d2a00' }}>
      {/* Playful warm orange/tan */}
      <div style={{ background: 'linear-gradient(135deg, #ea580c 0%, #dc2626 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <div className="relative">
            <PawPrint size={20} className="absolute -top-1 -right-1 bg-orange-300 text-orange-800 rounded-full p-1.5" />
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="border-4 border-orange-200 bg-orange-700 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-200">Loving Pet Care Provider</span>
            <h1 className="text-3xl font-bold mt-1">{helper.businessName}</h1>
            <p className="text-orange-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#fed7aa" />
              <span className="text-orange-200 text-sm">{helper.reviewCount} pet parents</span>
              <LocationChip city={helper.city} state={helper.state} className="text-orange-200" />
            </div>
          </div>
          <div className="text-center">
            <div className="text-4xl">🐾</div>
            <div className="text-xl font-black">{helper.jobsCompleted}</div>
            <div className="text-xs text-orange-200">Pets Cared For</div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <SectionHead className="text-orange-700">About the Caregiver</SectionHead>
              <p className="leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <SectionHead className="text-orange-700">Pet Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="bg-orange-50 border border-orange-100 rounded-xl p-4">
                    <p className="font-semibold text-orange-900">{s.name}</p>
                    {s.description && <p className="text-xs text-orange-600 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-orange-700 font-bold text-sm mt-2">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <SectionHead className="text-orange-700">Our Happy Clients</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-2xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <SectionHead className="text-orange-700">What Pet Parents Say</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-orange-50 text-orange-900" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-orange-600 text-white rounded-2xl p-5">
            <BadgeList badges={helper.badges} badgeClass="bg-orange-700 text-white" />
            {!helper.badges.length && <p className="text-sm text-orange-100">Insured & background-checked</p>}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-orange-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-orange-600 hover:text-orange-700" />
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

// ─── 19. TUTORING & EDUCATION ─────────────────────────────────────────────────
export function TutoringEducationTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-slate-50 text-slate-800">
      {/* Clean academic blue */}
      <div style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={96}
            className="border-4 border-blue-200 bg-blue-700 text-white shadow-lg" />
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <BookOpen size={14} className="text-blue-200" />
              <span className="text-xs font-bold uppercase tracking-widest text-blue-200">Certified Educator & Tutor</span>
            </div>
            <h1 className="text-3xl font-bold">{helper.businessName}</h1>
            <p className="text-blue-100 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#bfdbfe" />
              <span className="text-blue-200 text-sm">{helper.reviewCount} students</span>
              <LocationChip city={helper.city} state={helper.state} className="text-blue-200" />
            </div>
          </div>
          <div className="flex gap-5">
            {[{ v: helper.rating?.toFixed(1), l: 'Rating' }, { v: helper.jobsCompleted, l: 'Sessions' }].map(s => (
              <div key={s.l} className="text-center">
                <div className="text-3xl font-black text-blue-200">{s.v}</div>
                <div className="text-xs text-blue-300">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-700">Teaching Philosophy</SectionHead>
              <p className="leading-relaxed text-slate-700">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-700">Subjects & Programs</SectionHead>
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
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-700">Student Feedback</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-blue-50 text-blue-900" />
                ))}
              </div>
            </section>
          )}

          {faqs.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-blue-700">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-blue-50 border border-blue-100"
                questionClass="text-blue-900 font-semibold" answerClass="text-blue-700" />
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-blue-700 text-white rounded-2xl p-5">
            <p className="text-xs font-bold text-blue-200 uppercase mb-3">Credentials</p>
            <BadgeList badges={helper.badges} badgeClass="bg-blue-600 text-white" />
            {!helper.badges.length && <p className="text-sm text-blue-100">Certified educator</p>}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-blue-600 hover:text-blue-700" />
          </div>
          {gallery.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-blue-100 shadow-sm">
              <SectionHead className="text-blue-700 text-sm">Gallery</SectionHead>
              <GalleryGrid gallery={gallery} cols={2} rounded="rounded-lg" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 20. CHILD DEVELOPMENT ────────────────────────────────────────────────────
export function ChildDevelopmentTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const colors = ['#f97316','#10b981','#8b5cf6','#ef4444','#3b82f6','#f59e0b'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f0f9ff', color: '#1e3a5f' }}>
      {/* Colorful playful rounded shapes */}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #3b82f6 50%, #10b981 100%)' }}>
        {/* Floating circles decoration */}
        {[{ s: 120, t: -20, r: -20, o: 0.2 },{ s: 80, b: -10, l: 40, o: 0.15 }].map((c, i) => (
          <div key={i} className="absolute rounded-full bg-white"
            style={{ width: c.s, height: c.s, top: c.t, right: c.r, bottom: c.b, left: c.l, opacity: c.o }} />
        ))}
        <div className="relative max-w-4xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center gap-6 text-white">
          <Avatar src={helper.avatar} name={helper.ownerName} size={96}
            className="border-4 border-white bg-purple-500 text-white shadow-xl" />
          <div className="flex-1 text-center md:text-left">
            <span className="text-xs font-bold uppercase tracking-widest text-white/80">Child Development Specialist</span>
            <h1 className="text-3xl font-black mt-1">{helper.businessName}</h1>
            <p className="text-white/80 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#fde68a" />
              <span className="text-white/80 text-sm">{helper.reviewCount} families</span>
              <LocationChip city={helper.city} state={helper.state} className="text-white/80" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-purple-700">Our Approach</SectionHead>
              <p className="leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-purple-700">Programs</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map((s, i) => (
                  <div key={s.id} className="rounded-2xl p-4"
                    style={{ background: `${colors[i % colors.length]}15`, border: `2px solid ${colors[i % colors.length]}30` }}>
                    <p className="font-bold" style={{ color: colors[i % colors.length] }}>{s.name}</p>
                    {s.description && <p className="text-xs text-gray-600 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="font-bold text-sm mt-2" style={{ color: colors[i % colors.length] }}>${s.price.toFixed(0)}/{s.priceUnit}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-purple-700">Activities</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-2xl" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-blue-100">
              <SectionHead className="text-purple-700">Parent Reviews</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-blue-50 text-blue-900 rounded-2xl" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl p-5 text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #3b82f6)' }}>
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-white text-2xl" labelClass="text-white/70 text-xs" />
          </div>
          <div className="bg-white rounded-3xl p-5 border border-blue-100 shadow-sm space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-blue-100 text-blue-700 border border-blue-200" />
            <ContactRow phone={phone} website={website} linkClass="text-purple-600 hover:text-purple-700" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-3xl p-5 border border-blue-100 shadow-sm">
              <SectionHead className="text-purple-700 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-blue-50 rounded-xl" questionClass="text-blue-900" answerClass="text-blue-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
