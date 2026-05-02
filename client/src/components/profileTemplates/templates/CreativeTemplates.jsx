// CreativeTemplates.jsx — Creative & Media templates (4 templates)
import {
  StarRating, Avatar, BadgeList, ServiceCard, GalleryGrid,
  ReviewCard, FAQList, LocationChip, StatsRow, ContactRow, SectionHead,
} from '../shared.jsx';
import { Camera, Palette, Music, BookOpen } from 'lucide-react';

// ─── 9. CREATIVE STUDIO ───────────────────────────────────────────────────────
export function CreativeStudioTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen bg-black text-white font-sans">
      {/* Full gallery hero */}
      {gallery.length > 0 ? (
        <div className="relative h-80">
          <img src={gallery[0].url} alt="featured" className="w-full h-full object-cover opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute bottom-6 left-6 right-6">
            <div className="max-w-4xl mx-auto flex items-end gap-5">
              <Avatar src={helper.avatar} name={helper.ownerName} size={80}
                className="border-2 border-orange-400 bg-gray-800 text-white" />
              <div>
                <span className="text-xs font-bold text-orange-400 uppercase tracking-widest">Creative Studio</span>
                <h1 className="text-3xl font-black">{helper.businessName}</h1>
                <div className="flex gap-3 mt-1">
                  <StarRating rating={helper.rating} color="#fb923c" />
                  <LocationChip city={helper.city} state={helper.state} className="text-gray-300" />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-r from-orange-600 to-rose-600 px-6 py-14">
          <div className="max-w-4xl mx-auto flex items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={80}
              className="border-2 border-white/50 bg-orange-700 text-white" />
            <div>
              <Camera size={16} className="text-orange-200 mb-1" />
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p className="text-orange-100 mt-1">{helper.tagline}</p>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
              <SectionHead className="text-orange-400">About the Studio</SectionHead>
              <p className="text-gray-300 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
              <SectionHead className="text-orange-400">Services & Packages</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 hover:border-orange-500 transition-colors">
                    {s.popular && <span className="text-xs text-orange-400 font-bold uppercase">Popular</span>}
                    <p className="font-semibold mt-0.5">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-orange-400 font-bold text-sm mt-2">${s.price.toFixed(0)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 1 && (
            <section className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
              <SectionHead className="text-orange-400">Portfolio</SectionHead>
              <GalleryGrid gallery={gallery.slice(1)} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
              <SectionHead className="text-orange-400">Client Reviews</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-gray-800 text-gray-200" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-gradient-to-br from-orange-600 to-rose-600 rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-white text-2xl" labelClass="text-orange-200 text-xs" />
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-gray-800 text-orange-300 border border-gray-700" />
            <ContactRow phone={phone} website={website} linkClass="text-orange-400 hover:text-orange-300" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <SectionHead className="text-orange-400 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-gray-800" questionClass="text-white" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 10. GRAPHIC DESIGN ───────────────────────────────────────────────────────
export function GraphicDesignTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-white text-gray-900">
      {/* Minimal white with bold typography */}
      <div className="border-b-4 border-gray-900 px-8 py-12">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center gap-8">
          <Avatar src={helper.avatar} name={helper.ownerName} size={96}
            className="border-2 border-gray-900 bg-gray-100 text-gray-600" />
          <div className="flex-1 text-center md:text-left">
            <h1 className="text-5xl font-black leading-none tracking-tight">{helper.businessName}</h1>
            <div className="flex items-center gap-1 my-2">
              <div className="h-1 w-12 bg-gray-900 rounded" />
              <div className="h-1 w-4 bg-gray-400 rounded" />
            </div>
            <p className="text-gray-500 text-lg">{helper.tagline}</p>
            <div className="flex flex-wrap gap-4 mt-3 justify-center md:justify-start text-sm text-gray-500">
              <StarRating rating={helper.rating} color="#111827" size={14} />
              <span>{helper.reviewCount} reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-gray-500" />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {helper.bio && (
            <section>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-4 w-1 bg-gray-900 rounded" />
                <h3 className="font-black text-lg uppercase tracking-wide">About</h3>
              </div>
              <p className="text-gray-600 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-4 w-1 bg-gray-900 rounded" />
                <h3 className="font-black text-lg uppercase tracking-wide">Services</h3>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id} className="border-2 border-gray-900 rounded-xl p-4 hover:bg-gray-50 transition-colors">
                    <p className="font-black">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-500 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="font-black text-sm mt-2">from ${s.price.toFixed(0)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-4 w-1 bg-gray-900 rounded" />
                <h3 className="font-black text-lg uppercase tracking-wide">Work</h3>
              </div>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-none" />
            </section>
          )}

          {reviews.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-4 w-1 bg-gray-900 rounded" />
                <h3 className="font-black text-lg uppercase tracking-wide">Reviews</h3>
              </div>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <div key={r.id} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex justify-between">
                      <span className="font-bold text-sm">{r.authorName}</span>
                      <StarRating rating={r.rating} color="#111" size={12} />
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{r.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <div className="border-2 border-gray-900 rounded-xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-gray-900 text-2xl font-black" labelClass="text-gray-400 text-xs uppercase tracking-wide" />
          </div>
          <BadgeList badges={helper.badges} badgeClass="bg-gray-100 text-gray-800 border border-gray-300" />
          <ContactRow phone={phone} website={website} linkClass="text-gray-900 hover:underline font-semibold" />
          {faqs.length > 0 && (
            <div className="border border-gray-200 rounded-xl p-5">
              <h4 className="font-black text-sm uppercase tracking-wide mb-3">FAQ</h4>
              <FAQList faqs={faqs} itemClass="border-b border-gray-100"
                questionClass="text-gray-900 font-bold" answerClass="text-gray-600" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 11. MUSIC & AUDIO ────────────────────────────────────────────────────────
export function MusicAudioTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-sans bg-gray-950 text-white">
      {/* Dark neon purple aesthetic */}
      <div style={{ background: 'linear-gradient(135deg, #1e0a3c 0%, #2d1465 50%, #1a0536 100%)' }}
        className="border-b border-purple-800">
        <div className="max-w-4xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center gap-6">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-purple-500 blur-xl opacity-40" />
            <Avatar src={helper.avatar} name={helper.ownerName} size={96}
              className="relative border-2 border-purple-400 bg-purple-900 text-white" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex items-center gap-2 justify-center md:justify-start mb-1">
              <Music size={14} className="text-purple-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-purple-400">Music & Audio Professional</span>
            </div>
            <h1 className="text-3xl font-black" style={{ textShadow: '0 0 30px rgba(168,85,247,0.5)' }}>{helper.businessName}</h1>
            <p className="text-purple-300 mt-1">{helper.tagline}</p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              <StarRating rating={helper.rating} color="#c084fc" />
              <span className="text-purple-300 text-sm">{helper.reviewCount} reviews</span>
              <LocationChip city={helper.city} state={helper.state} className="text-purple-300" />
            </div>
          </div>
        </div>
      </div>

      {/* Waveform decoration */}
      <div className="bg-purple-900/20 border-b border-purple-800/30 py-3 flex justify-center gap-1 overflow-hidden px-4">
        {Array.from({ length: 48 }).map((_, i) => (
          <div key={i} className="w-1 rounded-full bg-purple-500"
            style={{ height: `${8 + Math.sin(i * 0.8) * 16 + 8}px`, opacity: 0.6 }} />
        ))}
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {helper.bio && (
            <section className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-purple-400">Artist Bio</SectionHead>
              <p className="text-gray-300 leading-relaxed">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-purple-400">Audio Services</SectionHead>
              <div className="grid sm:grid-cols-2 gap-3">
                {services.map(s => (
                  <div key={s.id}
                    className="bg-purple-950 border border-purple-800 rounded-xl p-4"
                    style={{ boxShadow: s.popular ? '0 0 12px rgba(168,85,247,0.3)' : 'none' }}>
                    {s.popular && <span className="text-xs text-purple-300 font-bold">★ Popular</span>}
                    <p className="font-semibold">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                    {s.price > 0 && <p className="text-purple-400 font-bold text-sm mt-2">${s.price.toFixed(0)}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-purple-400">Media</SectionHead>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-purple-400">Reviews</SectionHead>
              <div className="space-y-3">
                {reviews.slice(0, 4).map(r => (
                  <ReviewCard key={r.id} review={r} cardClass="bg-purple-950 text-gray-200 border border-purple-900" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <div style={{ background: 'linear-gradient(135deg, #7c3aed, #9333ea)' }} className="rounded-2xl p-5">
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-white text-2xl" labelClass="text-purple-200 text-xs" />
          </div>
          <div className="bg-gray-900 border border-purple-900 rounded-2xl p-5 space-y-3">
            <BadgeList badges={helper.badges} badgeClass="bg-purple-900 text-purple-200 border border-purple-700" />
            <ContactRow phone={phone} website={website} linkClass="text-purple-400 hover:text-purple-300" />
          </div>
          {faqs.length > 0 && (
            <div className="bg-gray-900 border border-purple-900 rounded-2xl p-5">
              <SectionHead className="text-purple-400 text-sm">FAQ</SectionHead>
              <FAQList faqs={faqs} itemClass="bg-purple-950 border border-purple-900" questionClass="text-white" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 12. WRITING & COPY ───────────────────────────────────────────────────────
export function WritingCopyTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  return (
    <div className="min-h-screen font-serif" style={{ background: '#f8f4ec', color: '#1a1207' }}>
      {/* Literary editorial style */}
      <div style={{ borderBottom: '3px double #2c1810', background: '#fdf8f0' }} className="px-8 py-10">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-6">
            <BookOpen size={24} className="mx-auto text-amber-800 mb-2" />
            <span style={{ color: '#7c5227', letterSpacing: '0.3em', fontSize: '11px', fontFamily: 'sans-serif', fontWeight: 700, textTransform: 'uppercase' }}>
              Words. Stories. Impact.
            </span>
            <h1 className="text-5xl font-bold mt-2" style={{ color: '#1a1207' }}>{helper.businessName}</h1>
            <div style={{ width: 60, height: 2, background: '#7c5227', margin: '12px auto' }} />
            <p style={{ color: '#7c5227', fontFamily: 'sans-serif' }} className="text-sm">{helper.tagline}</p>
          </div>
          <div className="flex justify-center gap-6" style={{ fontFamily: 'sans-serif', fontSize: 13 }}>
            <StarRating rating={helper.rating} color="#7c5227" size={14} />
            <span style={{ color: '#7c5227' }}>{helper.reviewCount} clients</span>
            <LocationChip city={helper.city} state={helper.state} className="text-amber-800" />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {helper.bio && (
            <section>
              <h3 style={{ color: '#7c5227', fontFamily: 'sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase' }} className="mb-3">
                About the Writer
              </h3>
              <p className="text-lg leading-loose">{helper.bio}</p>
            </section>
          )}

          {services.length > 0 && (
            <section>
              <h3 style={{ color: '#7c5227', fontFamily: 'sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase' }} className="mb-4">
                Services
              </h3>
              <div className="space-y-3">
                {services.map(s => (
                  <div key={s.id} style={{ borderBottom: '1px solid #d4b896' }} className="pb-3 flex justify-between items-start">
                    <div>
                      <p className="font-bold">{s.name}</p>
                      {s.description && <p style={{ fontFamily: 'sans-serif', color: '#7c5227', fontSize: 12 }} className="mt-0.5">{s.description}</p>}
                    </div>
                    {s.price > 0 && <span style={{ fontFamily: 'sans-serif', fontWeight: 700, color: '#7c5227', fontSize: 13 }}>from ${s.price.toFixed(0)}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {reviews.length > 0 && (
            <section>
              <h3 style={{ color: '#7c5227', fontFamily: 'sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase' }} className="mb-4">
                Testimonials
              </h3>
              <div className="space-y-5">
                {reviews.slice(0, 3).map(r => (
                  <blockquote key={r.id} style={{ borderLeft: '3px solid #d4b896' }} className="pl-5">
                    <p className="text-base italic leading-relaxed">"{r.content}"</p>
                    <footer style={{ fontFamily: 'sans-serif', color: '#7c5227', fontSize: 12 }} className="mt-2">
                      &mdash; {r.authorName}
                    </footer>
                  </blockquote>
                ))}
              </div>
            </section>
          )}

          {faqs.length > 0 && (
            <section>
              <h3 style={{ color: '#7c5227', fontFamily: 'sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase' }} className="mb-4">
                Questions
              </h3>
              <FAQList faqs={faqs} itemClass="border-b border-amber-200"
                questionClass="text-amber-900 font-bold font-serif" answerClass="text-amber-800 font-sans text-sm" />
            </section>
          )}
        </div>

        <div className="space-y-5">
          <div style={{ background: '#fdf0d8', border: '1px solid #d4b896' }} className="rounded-2xl p-5 text-center">
            <Avatar src={helper.avatar} name={helper.ownerName} size={70}
              className="mx-auto mb-3 border-2 border-amber-300 bg-amber-100 text-amber-800 font-sans" />
            <StatsRow rating={helper.rating} reviewCount={helper.reviewCount} jobsCompleted={helper.jobsCompleted}
              statClass="text-amber-800 text-xl font-serif font-bold" labelClass="text-amber-600 text-xs font-sans" />
          </div>
          <BadgeList badges={helper.badges} badgeClass="bg-amber-100 text-amber-800 border border-amber-200 font-sans text-xs" />
          <ContactRow phone={phone} website={website} linkClass="text-amber-800 hover:underline font-sans text-sm" />
        </div>
      </div>
    </div>
  );
}
