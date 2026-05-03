// CareTemplates.jsx — Care & Education templates (4 templates)
// Each designed with trust signals, age-appropriate feel, and industry-specific sections.
import {
  StarRating, Avatar, BadgeList, GalleryGrid, ReviewCard, FAQList,
  LocationChip, ContactRow, SectionHead, ChecklistRow,
  HorizontalServiceBar, SpecialtyPill, QuoteBlock, CredentialItem, ProcessStep,
} from '../shared.jsx';
import { Heart, Shield, Users, BookOpen, Star, CheckCircle, Clock, Baby } from 'lucide-react';

// ─── 17. CARE & TRUST ────────────────────────────────────────────────────────
// Caregiver profile. Certifications FIRST — this is a trust-critical role.
// Warm lavender palette. Availability schedule. Background check badge prominent.
export function CareTrustTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const careTypes = ['Elder Care', 'Disability Support', 'Post-Surgery Recovery', 'Companionship', 'Medication Reminders', 'Meal Preparation', 'Light Housekeeping', 'Transportation'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#faf5ff', color: '#1e1030' }}>
      {/* Trustworthy lavender header */}
      <div style={{ background: 'linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="border-4 flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.4)', background: '#3b0764', color: '#ddd6fe' }} />
            <div className="text-center sm:text-left flex-1">
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-purple-200 block mb-1">
                Trusted Caregiver
              </span>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p className="text-purple-100 text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#ddd6fe" size={13} />
                <span className="text-purple-200 text-xs">{helper.reviewCount} families served</span>
                <LocationChip city={helper.city} state={helper.state} className="text-purple-200 text-xs" />
              </div>
            </div>
            {/* Trust badges strip */}
            <div className="flex flex-col gap-2">
              {['Background Checked', 'CPR Certified', 'First Aid'].map(b => (
                <div key={b} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)' }}>
                  <Shield size={11} className="text-purple-200" />{b}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Certifications — leads above bio for trust */}
          {helper.badges.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-purple-100">
              <p className="text-xs font-bold uppercase tracking-wider text-purple-600 mb-3">Licenses & Certifications</p>
              <BadgeList badges={helper.badges} badgeClass="bg-purple-50 text-purple-700 border border-purple-200" />
            </section>
          )}

          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-purple-100">
              <SectionHead className="text-purple-700">About Me</SectionHead>
              <p style={{ color: '#1e1030' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {/* Care specialties */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-purple-100">
            <SectionHead className="text-purple-700">Care Specialties</SectionHead>
            <div className="grid grid-cols-2 gap-2">
              {careTypes.map(c => (
                <div key={c} className="flex items-center gap-2 py-1">
                  <Heart size={13} className="flex-shrink-0 text-purple-400" />
                  <span className="text-sm text-purple-900">{c}</span>
                </div>
              ))}
            </div>
          </section>

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-purple-100">
              <SectionHead className="text-purple-700">Services & Rates</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#6d28d9"
                    bgClass="bg-purple-50" textClass="text-purple-900" priceClass="text-purple-700" />
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-purple-100">
              <SectionHead className="text-purple-700">Family Reviews</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-purple-50 text-purple-900 border border-purple-100" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: '#6d28d9' }}>
            <div className="grid grid-cols-3 gap-3 text-center text-white">
              {[
                { v: helper.jobsCompleted ?? 0, l: 'Clients' },
                { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
                { v: `${helper.reviewCount}+`, l: 'Reviews' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-xl font-black">{s.v}</div>
                  <div className="text-xs text-purple-200">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Availability */}
          <div className="bg-white rounded-2xl p-5 border border-purple-100 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-purple-600 mb-3">
              <Clock size={11} className="inline mr-1" />Availability
            </p>
            {['Mornings (7am-12pm)', 'Afternoons (12pm-6pm)', 'Evenings (6pm-10pm)', 'Weekends'].map(a => (
              <ChecklistRow key={a} iconColor="#6d28d9" textClass="text-purple-900 text-xs">{a}</ChecklistRow>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-5 border border-purple-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-purple-600 hover:text-purple-800" />
          </div>

          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-purple-100 shadow-sm">
              <SectionHead className="text-purple-700 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-purple-50" questionClass="text-purple-900" answerClass="text-purple-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 18. PET SERVICES ────────────────────────────────────────────────────────
// Playful, outdoor-nature feel. Pet type/size chips lead. Bright green/yellow.
// Service cards per service type (walking, sitting, grooming). Photo-heavy.
export function PetServicesTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const petTypes = ['Small Dogs', 'Medium Dogs', 'Large Dogs', 'Cats', 'Puppies', 'Senior Pets', 'Multiple Pets', 'Exotic Pets'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f7fff7', color: '#0a2714' }}>
      {/* Playful nature hero */}
      <div style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 60%, #14532d 100%)' }}>
        <div className="max-w-4xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
            <div className="relative">
              <Avatar src={helper.avatar} name={helper.ownerName} size={88}
                className="border-4 flex-shrink-0" style={{ borderColor: '#86efac', background: '#14532d', color: '#bbf7d0' }} />
            </div>
            <div className="flex-1">
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-green-200 block mb-1">
                Professional Pet Care
              </span>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p className="text-green-100 text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#86efac" size={13} />
                <span className="text-green-200 text-xs">{helper.reviewCount} happy pet parents</span>
                <LocationChip city={helper.city} state={helper.state} className="text-green-200 text-xs" />
              </div>
            </div>
            <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)' }}>
              <div className="text-3xl font-black">{helper.jobsCompleted}</div>
              <div className="text-xs text-green-200">Happy Pets Cared For</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Pet type chips */}
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
          <SectionHead className="text-green-700">Pets I Work With</SectionHead>
          <div className="flex flex-wrap gap-2">
            {petTypes.map(p => (
              <span key={p} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#15803d' }}>{p}</span>
            ))}
          </div>
        </section>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            {services.length > 0 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
                <SectionHead className="text-green-700">Services</SectionHead>
                <div className="grid sm:grid-cols-2 gap-3">
                  {services.map(s => (
                    <div key={s.id} className="rounded-xl p-4"
                      style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                      <p className="font-bold text-sm text-green-900">{s.name}</p>
                      {s.description && <p className="text-xs text-green-700 mt-1">{s.description}</p>}
                      {s.price > 0 && <p className="text-sm font-black mt-2 text-green-600">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {helper.bio && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
                <SectionHead className="text-green-700">About Me & My Love for Animals</SectionHead>
                <p style={{ color: '#0a2714' }} className="leading-relaxed text-sm">{helper.bio}</p>
              </section>
            )}

            {gallery.length > 0 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
                <SectionHead className="text-green-700">My Furry Friends</SectionHead>
                <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
              </section>
            )}

            {reviews.length > 0 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-green-100">
                <SectionHead className="text-green-700">Happy Pet Parents Say</SectionHead>
                <div className="grid sm:grid-cols-2 gap-3">
                  {reviews.slice(0, 4).map(r => (
                    <ReviewCard key={r.id} review={r} cardClass="bg-green-50 text-green-900 border border-green-100" />
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-4">
            {helper.badges.length > 0 && (
              <div className="bg-white rounded-2xl p-5 border border-green-100 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-green-600 mb-3">Certifications</p>
                <BadgeList badges={helper.badges} badgeClass="bg-green-50 text-green-700 border border-green-200" />
              </div>
            )}
            <div className="rounded-2xl p-5" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <p className="text-xs font-bold uppercase tracking-wider text-green-600 mb-3">Requirements</p>
              {['Up-to-date vaccinations', 'Flea treatment required', 'Well-behaved pets welcome'].map(r => (
                <ChecklistRow key={r} iconColor="#16a34a" textClass="text-green-800 text-xs">{r}</ChecklistRow>
              ))}
            </div>
            <div className="bg-white rounded-2xl p-5 border border-green-100 shadow-sm">
              <ContactRow phone={phone} website={website} linkClass="text-green-700 hover:text-green-900" />
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
    </div>
  );
}

// ─── 19. TUTORING & EDUCATION ────────────────────────────────────────────────
// Academic structured feel. Qualification timeline. Subject grid. Clean indigo/white.
// Grade levels as prominent chips. Online/in-person options displayed.
export function TutoringEducationTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const subjects = ['Math', 'Algebra', 'Calculus', 'Physics', 'Chemistry', 'Biology', 'English', 'Essay Writing', 'History', 'Spanish', 'French', 'SAT Prep', 'ACT Prep', 'AP Courses'];
  const gradeLevels = ['Elementary (K-5)', 'Middle School (6-8)', 'High School (9-12)', 'College Level', 'Adult Learners'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#f8f9ff', color: '#1e1b4b' }}>
      {/* Academic clean header */}
      <div style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="border-4 flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.4)', background: '#312e81', color: '#c7d2fe' }} />
            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center gap-2 mb-1 justify-center sm:justify-start">
                <BookOpen size={13} className="text-indigo-200" />
                <span className="text-xs font-bold uppercase tracking-[0.3em] text-indigo-200">Academic Tutor & Educator</span>
              </div>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p className="text-indigo-100 text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#c7d2fe" size={13} />
                <span className="text-indigo-200 text-xs">{helper.reviewCount} students</span>
                <LocationChip city={helper.city} state={helper.state} className="text-indigo-200 text-xs" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center flex-shrink-0">
              {[
                { v: helper.jobsCompleted ?? 0, l: 'Students' },
                { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
                { v: `${helper.reviewCount}+`, l: 'Reviews' },
              ].map(s => (
                <div key={s.l}>
                  <div className="text-2xl font-black">{s.v}</div>
                  <div className="text-xs text-indigo-300">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Grade levels */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-indigo-100">
            <SectionHead className="text-indigo-700">Grade Levels I Teach</SectionHead>
            <div className="flex flex-wrap gap-2">
              {gradeLevels.map(g => (
                <span key={g} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>{g}</span>
              ))}
            </div>
          </section>

          {/* Subject grid */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-indigo-100">
            <SectionHead className="text-indigo-700">Subjects</SectionHead>
            <div className="flex flex-wrap gap-2">
              {subjects.map(s => (
                <SpecialtyPill key={s} label={s} pillClass="bg-indigo-50 text-indigo-700 border border-indigo-200" />
              ))}
            </div>
          </section>

          {helper.bio && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-indigo-100">
              <SectionHead className="text-indigo-700">About Me</SectionHead>
              <p style={{ color: '#1e1b4b' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-indigo-100">
              <SectionHead className="text-indigo-700">Session Types & Rates</SectionHead>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#4f46e5"
                    bgClass="bg-indigo-50" textClass="text-indigo-900" priceClass="text-indigo-600" />
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-indigo-100">
              <SectionHead className="text-indigo-700">Student Reviews</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-indigo-50 text-indigo-900 border border-indigo-100" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {/* Credentials timeline */}
          {helper.badges.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-indigo-100 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-3">Qualifications</p>
              <BadgeList badges={helper.badges} badgeClass="bg-indigo-50 text-indigo-700 border border-indigo-200" />
            </div>
          )}
          {/* Session format */}
          <div className="bg-white rounded-2xl p-5 border border-indigo-100 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 mb-3">Session Formats</p>
            {['In-person (your location)', 'Online via Zoom', 'At local library', 'Hybrid options'].map(f => (
              <ChecklistRow key={f} iconColor="#4f46e5" textClass="text-indigo-900 text-xs">{f}</ChecklistRow>
            ))}
          </div>
          <div className="bg-white rounded-2xl p-5 border border-indigo-100 shadow-sm">
            <ContactRow phone={phone} website={website} linkClass="text-indigo-600 hover:text-indigo-800" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-indigo-100 shadow-sm">
              <SectionHead className="text-indigo-700 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-indigo-50" questionClass="text-indigo-900" answerClass="text-indigo-700" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 20. CHILD DEVELOPMENT ───────────────────────────────────────────────────
// Bright, safe, primary colors. Age group cards prominent.
// Activities/focus areas. Safety certifications lead the trust section.
export function ChildDevelopmentTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const ageGroups = [
    { label: 'Infants', range: '0-12 mo', color: '#fbbf24', bg: '#fffbeb' },
    { label: 'Toddlers', range: '1-3 yrs', color: '#34d399', bg: '#ecfdf5' },
    { label: 'Preschool', range: '3-5 yrs', color: '#60a5fa', bg: '#eff6ff' },
    { label: 'School Age', range: '6-12 yrs', color: '#f87171', bg: '#fef2f2' },
  ];
  const activities = ['Sensory Play', 'Creative Arts', 'Storytelling', 'Music & Movement', 'Outdoor Exploration', 'Learning Through Play', 'Social Skills', 'Fine Motor Development'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#fffef5', color: '#1a1500' }}>
      {/* Warm, friendly hero */}
      <div style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
        <div className="max-w-5xl mx-auto px-6 py-10 text-white">
          <div className="flex flex-col sm:flex-row items-center gap-5 text-center sm:text-left">
            <Avatar src={helper.avatar} name={helper.ownerName} size={88}
              className="border-4 flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.5)', background: '#92400e', color: '#fef3c7' }} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 justify-center sm:justify-start">
                <Baby size={13} className="text-yellow-200" />
                <span className="text-xs font-bold uppercase tracking-[0.3em] text-yellow-200">Child Development Specialist</span>
              </div>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p className="text-yellow-100 text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2 justify-center sm:justify-start">
                <StarRating rating={helper.rating} color="#fef3c7" size={13} />
                <span className="text-yellow-200 text-xs">{helper.reviewCount} families</span>
                <LocationChip city={helper.city} state={helper.state} className="text-yellow-200 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Age group cards — prominent */}
        <section>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-700 mb-3">Age Groups I Work With</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {ageGroups.map(ag => (
              <div key={ag.label} className="rounded-2xl p-4 text-center border-2"
                style={{ background: ag.bg, borderColor: ag.color }}>
                <div className="text-2xl font-black" style={{ color: ag.color }}>{ag.label}</div>
                <div className="text-xs mt-1 font-semibold" style={{ color: ag.color }}>{ag.range}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            {/* Activities */}
            <section className="bg-white rounded-2xl p-5 shadow-sm border border-yellow-100">
              <SectionHead className="text-amber-700">Activities & Focus Areas</SectionHead>
              <div className="grid grid-cols-2 gap-2">
                {activities.map(a => (
                  <div key={a} className="flex items-center gap-2 py-1">
                    <Star size={12} className="flex-shrink-0 text-amber-400" fill="#fbbf24" />
                    <span className="text-sm text-amber-900">{a}</span>
                  </div>
                ))}
              </div>
            </section>

            {helper.bio && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-yellow-100">
                <SectionHead className="text-amber-700">About Me</SectionHead>
                <p className="text-amber-900 leading-relaxed text-sm">{helper.bio}</p>
              </section>
            )}

            {services.length > 0 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-yellow-100">
                <SectionHead className="text-amber-700">Programs & Sessions</SectionHead>
                <div className="grid sm:grid-cols-2 gap-3">
                  {services.map(s => (
                    <div key={s.id} className="rounded-xl p-4"
                      style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
                      <p className="font-bold text-sm text-amber-900">{s.name}</p>
                      {s.description && <p className="text-xs text-amber-700 mt-1">{s.description}</p>}
                      {s.price > 0 && <p className="text-sm font-black mt-2 text-amber-600">${s.price.toFixed(0)}/{s.priceUnit}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {gallery.length > 0 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-yellow-100">
                <SectionHead className="text-amber-700">Learning in Action</SectionHead>
                <GalleryGrid gallery={gallery} cols={3} rounded="rounded-xl" />
              </section>
            )}

            {reviews.length > 0 && (
              <section className="bg-white rounded-2xl p-5 shadow-sm border border-yellow-100">
                <SectionHead className="text-amber-700">What Parents Say</SectionHead>
                <div className="space-y-3">
                  {reviews.slice(0, 4).map(r => (
                    <ReviewCard key={r.id} review={r} cardClass="bg-yellow-50 text-amber-900 border border-yellow-100" />
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-4">
            {/* Safety credentials */}
            <div className="rounded-2xl p-5" style={{ background: '#f59e0b' }}>
              <p className="text-xs font-bold text-white uppercase tracking-wider mb-3">Safety Certifications</p>
              {helper.badges.length > 0
                ? <BadgeList badges={helper.badges} badgeClass="bg-amber-600 text-white border-0" />
                : <div className="space-y-1">
                    {['CPR Certified', 'First Aid', 'Background Checked', 'Mandated Reporter'].map(b => (
                      <div key={b} className="flex items-center gap-2 text-xs text-white/90">
                        <Shield size={10} />{b}
                      </div>
                    ))}
                  </div>}
            </div>
            <div className="bg-white rounded-2xl p-5 border border-yellow-100 shadow-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { v: helper.jobsCompleted ?? 0, l: 'Kids' },
                  { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Rating' },
                  { v: `${helper.reviewCount}+`, l: 'Reviews' },
                ].map(s => (
                  <div key={s.l}>
                    <div className="text-xl font-black text-amber-600">{s.v}</div>
                    <div className="text-xs text-amber-700">{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-5 border border-yellow-100 shadow-sm">
              <ContactRow phone={phone} website={website} linkClass="text-amber-700 hover:text-amber-900" />
            </div>
            {faqs.length > 0 && (
              <div className="bg-white rounded-2xl p-5 border border-yellow-100 shadow-sm">
                <SectionHead className="text-amber-700 text-sm">FAQ</SectionHead>
                <FAQList faqs={faqs} itemClass="bg-yellow-50" questionClass="text-amber-900" answerClass="text-amber-700" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
