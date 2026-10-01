// CreativeTemplates.jsx — Creative & Media templates (4 templates)
// Each has a distinct layout that matches creative industry expectations.
import {
  StarRating, Avatar, BadgeList, GalleryGrid, ReviewCard, FAQList,
  LocationChip, ContactRow, SectionHead, MasonryGallery,
  SpecialtyPill, QuoteBlock, TechChip, HorizontalServiceBar,
} from '../shared.jsx';
import { Camera, Music, Pen, Layers, Headphones } from 'lucide-react';

// ─── 9. CREATIVE STUDIO ──────────────────────────────────────────────────────
// Dark portfolio aesthetic. Single editorial column — NO sidebar.
// Masonry gallery leads. Client industry chips. Black/electric-purple.
export function CreativeStudioTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const industries = ['Startups', 'Fashion', 'Tech', 'Non-profit', 'Music', 'Hospitality', 'Real Estate', 'Fitness'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#0a0a0a', color: '#f5f5f5' }}>
      {/* Minimal dark name plate */}
      <div className="max-w-2xl mx-auto px-6 pt-12 pb-0 text-center">
        <Avatar src={helper.avatar} name={helper.ownerName} size={72}
          className="mx-auto mb-4 border-2" style={{ borderColor: '#a855f7', background: '#1a0a2e', color: '#d8b4fe' }} />
        <span className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: '#a855f7' }}>Creative Studio</span>
        <h1 className="text-4xl font-black mt-2">{helper.businessName}</h1>
        <p style={{ color: '#a3a3a3' }} className="text-sm mt-2 max-w-md mx-auto">{helper.tagline}</p>
        <div className="flex items-center justify-center gap-4 mt-3">
          <StarRating rating={helper.rating} color="#a855f7" size={14} />
          <span style={{ color: '#737373' }} className="text-xs">{helper.reviewCount} clients</span>
          <LocationChip city={helper.city} state={helper.state} className="text-gray-500 text-xs" />
        </div>
      </div>

      {/* Full-width masonry gallery */}
      {gallery.length > 0 && (
        <div className="px-4 mt-8 max-w-4xl mx-auto">
          <MasonryGallery gallery={gallery} rounded="rounded-2xl" maxItems={8} />
        </div>
      )}

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-10">
        {helper.bio && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#a855f7' }}>About the Studio</span>
            <p style={{ color: '#d4d4d4' }} className="leading-relaxed">{helper.bio}</p>
          </section>
        )}

        {services.length > 0 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#a855f7' }}>What We Create</span>
            <div className="space-y-2">
              {services.map(s => (
                <HorizontalServiceBar key={s.id} service={s} accentColor="#a855f7"
                  bgClass="" textClass="text-white" priceClass="text-purple-400" />
              ))}
            </div>
          </section>
        )}

        <section>
          <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#a855f7' }}>Industries We Work With</span>
          <div className="flex flex-wrap gap-2">
            {industries.map(i => (
              <SpecialtyPill key={i} label={i} pillClass="text-purple-300" />
            ))}
          </div>
        </section>

        {helper.badges.length > 0 && (
          <BadgeList badges={helper.badges} badgeClass="text-purple-300 border border-purple-900 bg-purple-950" />
        )}

        {reviews.length > 0 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-5" style={{ color: '#a855f7' }}>Client Voices</span>
            <div className="space-y-6">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor="#a855f7" textClass="text-gray-300" authorClass="text-purple-400" />
              ))}
            </div>
          </section>
        )}

        {faqs.length > 0 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#a855f7' }}>FAQ</span>
            <FAQList faqs={faqs} itemClass="bg-gray-900 border border-gray-800"
              questionClass="text-white text-sm" answerClass="text-gray-400" />
          </section>
        )}

        <div className="pt-4 flex gap-4 justify-center">
          <ContactRow phone={phone} website={website} linkClass="text-purple-400 hover:text-purple-300 text-sm" />
        </div>
      </div>
    </div>
  );
}

// ─── 10. GRAPHIC DESIGN ───────────────────────────────────────────────────────
// Split-screen: portfolio panel left, scrolling info right.
// Design software chips. Bold white/black with vivid red accent.
export function GraphicDesignTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const tools = ['Figma', 'Illustrator', 'Photoshop', 'InDesign', 'Canva Pro', 'After Effects', 'Sketch', 'Procreate'];
  const specialties = ['Brand Identity', 'Logo Design', 'Print', 'Digital Ads', 'Packaging', 'UI/UX', 'Illustrations', 'Social Media'];
  return (
    <div className="min-h-screen font-sans bg-white">
      <div className="grid lg:grid-cols-2 min-h-screen">
        {/* Left: portfolio sticky panel */}
        <div className="relative lg:sticky lg:top-0 lg:h-screen overflow-hidden" style={{ background: '#111' }}>
          {gallery.length > 0
            ? <img src={gallery[0].url} alt="portfolio" className="w-full h-full object-cover opacity-80" />
            : <div className="w-full h-full flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #111 0%, #1a1a2e 100%)' }}>
                <Layers size={64} style={{ color: '#e11d48', opacity: 0.4 }} />
              </div>}
          <div className="absolute inset-0"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 60%)' }} />
          <div className="absolute bottom-0 start-0 end-0 p-8">
            <span className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: '#e11d48' }}>Graphic Design</span>
            <h1 className="text-3xl font-black text-white mt-1">{helper.businessName}</h1>
            <p className="text-gray-300 text-sm mt-1">{helper.tagline}</p>
            <div className="flex items-center gap-3 mt-3">
              <StarRating rating={helper.rating} color="#e11d48" size={13} />
              <span className="text-gray-400 text-xs">{helper.reviewCount} clients</span>
            </div>
            <div className="mt-4">
              <ContactRow phone={phone} website={website} linkClass="text-red-400 hover:text-red-300 text-sm" />
            </div>
          </div>
          {gallery.length > 1 && (
            <div className="absolute top-4 end-4 flex flex-col gap-2">
              {gallery.slice(1, 4).map(img => (
                <div key={img.id} className="w-16 h-16 rounded-lg overflow-hidden border border-white/20">
                  <img src={img.url} alt={img.alt} className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: info column */}
        <div className="px-8 py-12 space-y-8 overflow-y-auto" style={{ color: '#0a0a0a' }}>
          <div>
            <Avatar src={helper.avatar} name={helper.ownerName} size={56}
              className="border-2 bg-red-100 text-red-700 mb-4" style={{ borderColor: '#e11d48' }} />
            <LocationChip city={helper.city} state={helper.state} className="text-gray-500 text-sm" />
          </div>

          {helper.bio && (
            <section>
              <span className="text-xs font-bold uppercase tracking-widest text-red-600 block mb-2">About</span>
              <p className="text-gray-700 leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          <section>
            <span className="text-xs font-bold uppercase tracking-widest text-red-600 block mb-3">Specialties</span>
            <div className="flex flex-wrap gap-2">
              {specialties.map(s => (
                <SpecialtyPill key={s} label={s} pillClass="text-red-700 font-semibold text-xs bg-red-50 border border-red-200" />
              ))}
            </div>
          </section>

          {services.length > 0 && (
            <section>
              <span className="text-xs font-bold uppercase tracking-widest text-red-600 block mb-3">Services</span>
              <div className="space-y-2">
                {services.map(s => (
                  <HorizontalServiceBar key={s.id} service={s} accentColor="#e11d48"
                    bgClass="bg-gray-50" textClass="text-gray-900" priceClass="text-red-600" />
                ))}
              </div>
            </section>
          )}

          <section>
            <span className="text-xs font-bold uppercase tracking-widest text-red-600 block mb-3">Tools & Software</span>
            <div className="flex flex-wrap gap-2">
              {tools.map(t => <TechChip key={t} label={t} bgClass="bg-gray-100" textClass="text-gray-700" />)}
            </div>
          </section>

          {reviews.length > 0 && (
            <section>
              <span className="text-xs font-bold uppercase tracking-widest text-red-600 block mb-4">Client Reviews</span>
              <div className="space-y-4">
                {reviews.slice(0, 3).map(r => (
                  <div key={r.id} className="rounded-xl p-4 bg-red-50 border border-red-100">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-sm text-gray-900">{r.authorName}</span>
                      <StarRating rating={r.rating} size={11} color="#e11d48" />
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-3">{r.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {helper.badges.length > 0 && (
            <BadgeList badges={helper.badges} badgeClass="bg-red-50 text-red-700 border border-red-200" />
          )}

          {faqs.length > 0 && (
            <section>
              <span className="text-xs font-bold uppercase tracking-widest text-red-600 block mb-3">FAQ</span>
              <FAQList faqs={faqs} itemClass="bg-gray-50" questionClass="text-gray-900" answerClass="text-gray-600" />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 11. MUSIC & AUDIO ────────────────────────────────────────────────────────
// Dark club/venue aesthetic. Services displayed as a numbered "setlist".
// Genre chips. Dark purple/black with neon fuchsia accent.
export function MusicAudioTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const genres = ['Jazz', 'R&B', 'Pop', 'Rock', 'Electronic', 'Classical', 'Hip-Hop', 'Soul', 'Latin'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#080808', color: '#f5f5f5' }}>
      <div className="relative overflow-hidden" style={{ minHeight: 260 }}>
        {helper.coverImage
          ? <img src={helper.coverImage} alt="venue" className="w-full h-64 object-cover opacity-50" />
          : <div className="h-64" style={{ background: 'linear-gradient(135deg, #0d001a 0%, #1a0030 50%, #2d0050 100%)' }} />}
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(8,8,8,0.95) 85%)' }} />
        <div className="absolute bottom-0 start-0 end-0 px-6 pb-6">
          <div className="max-w-4xl mx-auto flex items-end gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={80}
              className="border-4 flex-shrink-0"
              style={{ borderColor: '#e879f9', background: '#1a003a', color: '#e879f9' }} />
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: '#e879f9' }}>
                Music & Audio
              </span>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p style={{ color: '#a3a3a3' }} className="text-sm mt-0.5">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2">
                <StarRating rating={helper.rating} color="#e879f9" size={13} />
                <span style={{ color: '#737373' }} className="text-xs">{helper.reviewCount} bookings</span>
                <LocationChip city={helper.city} state={helper.state} className="text-gray-500 text-xs" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #222' }}>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#e879f9' }}>
              Genres & Styles
            </span>
            <div className="flex flex-wrap gap-2">
              {genres.map(g => (
                <SpecialtyPill key={g} label={g} pillClass="text-fuchsia-300 text-xs font-semibold bg-purple-950 border border-purple-800" />
              ))}
            </div>
          </section>

          {services.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #222' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#e879f9' }}>
                What I Offer
              </span>
              <div className="divide-y divide-gray-800">
                {services.map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono w-5 text-center" style={{ color: '#e879f9' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <p className="font-semibold text-sm">{s.name}</p>
                        {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                      </div>
                    </div>
                    {s.price > 0 && (
                      <span className="text-sm font-bold whitespace-nowrap ms-4" style={{ color: '#e879f9' }}>
                        ${s.price.toFixed(0)}/{s.priceUnit}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {helper.bio && (
            <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #222' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#e879f9' }}>About</span>
              <p style={{ color: '#d4d4d4' }} className="leading-relaxed text-sm">{helper.bio}</p>
            </section>
          )}

          {gallery.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #222' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#e879f9' }}>Gallery</span>
              <GalleryGrid gallery={gallery} cols={3} rounded="rounded-lg" />
            </section>
          )}

          {reviews.length > 0 && (
            <section className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #222' }}>
              <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#e879f9' }}>Reviews</span>
              <div className="space-y-4">
                {reviews.slice(0, 3).map(r => (
                  <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                    accentColor="#e879f9" textClass="text-gray-300" authorClass="text-fuchsia-400" />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          {helper.badges.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#1a0030', border: '1px solid #4c1d95' }}>
              <BadgeList badges={helper.badges} badgeClass="text-fuchsia-300 bg-purple-950 border border-purple-800" />
            </div>
          )}
          <div className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #222' }}>
            <ContactRow phone={phone} website={website} linkClass="text-fuchsia-400 hover:text-fuchsia-300 text-sm" />
          </div>
          {faqs.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#111', border: '1px solid #222' }}>
              <span className="text-xs font-bold uppercase tracking-wider block mb-3" style={{ color: '#e879f9' }}>FAQ</span>
              <FAQList faqs={faqs} itemClass="bg-gray-900 border border-gray-800"
                questionClass="text-white text-sm" answerClass="text-gray-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 12. WRITING & COPY ───────────────────────────────────────────────────────
// Literary editorial feel. Warm cream/sepia. Pull quotes for testimonials.
// Writing specialties as genre tags. Dark header, warm body.
export function WritingCopyTemplate({ profileData }) {
  const { helper, services, gallery, reviews, faqs, phone, website } = profileData;
  const genres = ['Blog Posts', 'Copywriting', 'UX Writing', 'Email Campaigns', 'White Papers',
    'Press Releases', 'Social Content', 'Technical Writing', 'Grant Writing', 'Scriptwriting'];
  return (
    <div className="min-h-screen font-sans" style={{ background: '#fefce8', color: '#1c1003' }}>
      {/* Dark editorial header */}
      <div style={{ background: '#1c1003' }} className="px-6 py-10">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-5">
            <Avatar src={helper.avatar} name={helper.ownerName} size={72}
              className="border-2 flex-shrink-0"
              style={{ borderColor: '#ca8a04', background: '#3a2600', color: '#fcd34d' }} />
            <div className="text-white">
              <div className="flex items-center gap-2 mb-1">
                <Pen size={12} style={{ color: '#ca8a04' }} />
                <span className="text-xs font-bold uppercase tracking-[0.4em]" style={{ color: '#ca8a04' }}>
                  Freelance Writer & Copywriter
                </span>
              </div>
              <h1 className="text-3xl font-black">{helper.businessName}</h1>
              <p style={{ color: '#a3a3a3' }} className="text-sm mt-1">{helper.tagline}</p>
              <div className="flex items-center gap-3 mt-2">
                <StarRating rating={helper.rating} color="#ca8a04" size={13} />
                <span className="text-gray-400 text-xs">{helper.reviewCount} clients</span>
                <LocationChip city={helper.city} state={helper.state} className="text-gray-500 text-xs" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-8 pt-6 border-t border-white/10">
            {[
              { v: helper.jobsCompleted ?? 0, l: 'Projects Delivered' },
              { v: helper.rating?.toFixed(1) ?? '5.0', l: 'Avg Rating' },
              { v: `${helper.reviewCount}+`, l: 'Happy Clients' },
            ].map(s => (
              <div key={s.l} className="text-center">
                <div className="text-2xl font-black" style={{ color: '#ca8a04' }}>{s.v}</div>
                <div className="text-xs text-gray-400">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <section>
          <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#ca8a04' }}>Writing Specialties</span>
          <div className="flex flex-wrap gap-2">
            {genres.map(g => (
              <span key={g} className="px-3 py-1 rounded-full text-xs font-semibold"
                style={{ background: '#fef9c3', border: '1px solid #fde68a', color: '#92400e' }}>{g}</span>
            ))}
          </div>
        </section>

        {helper.bio && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-3" style={{ color: '#ca8a04' }}>About Me</span>
            <p style={{ color: '#3a2600' }} className="leading-relaxed">{helper.bio}</p>
          </section>
        )}

        {services.length > 0 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#ca8a04' }}>Services</span>
            <div className="divide-y divide-yellow-200">
              {services.map(s => (
                <div key={s.id} className="py-4 flex justify-between items-start gap-4">
                  <div>
                    <p className="font-semibold" style={{ color: '#1c1003' }}>{s.name}</p>
                    {s.description && <p className="text-sm mt-1" style={{ color: '#78601a' }}>{s.description}</p>}
                  </div>
                  {s.price > 0 && (
                    <span className="font-bold whitespace-nowrap text-sm" style={{ color: '#ca8a04' }}>
                      ${s.price.toFixed(0)}/{s.priceUnit}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {reviews.length > 0 && (
          <section className="py-6 border-t border-b border-yellow-200">
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-6" style={{ color: '#ca8a04' }}>
              Client Testimonials
            </span>
            <div className="space-y-6">
              {reviews.slice(0, 3).map(r => (
                <QuoteBlock key={r.id} text={r.content} author={r.authorName}
                  accentColor="#ca8a04" textClass="text-lg text-amber-900" authorClass="text-amber-700" />
              ))}
            </div>
          </section>
        )}

        {helper.badges.length > 0 && (
          <BadgeList badges={helper.badges} badgeClass="bg-yellow-100 text-yellow-800 border border-yellow-200" />
        )}

        {faqs.length > 0 && (
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.3em] block mb-4" style={{ color: '#ca8a04' }}>FAQ</span>
            <FAQList faqs={faqs} itemClass="bg-yellow-50 border border-yellow-100"
              questionClass="text-amber-900" answerClass="text-amber-700" />
          </section>
        )}

        <div className="pt-2">
          <ContactRow phone={phone} website={website} linkClass="text-amber-700 hover:text-amber-900" />
        </div>
      </div>
    </div>
  );
}
