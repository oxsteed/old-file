// client/src/pages/BusinessProfilePage.jsx
// Public-facing profile page for an individual business listed on OxSteed.
// URL: /business/:id  — no auth required to view.
// Chat / "Hire" CTAs redirect to login if the visitor is not authenticated.

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../context/AuthContext';
import { getBusinessPublicProfile } from '../api/businesses';
import '../styles/BusinessProfilePage.css';

// ── helpers ───────────────────────────────────────────────────────────────────
function StarRating({ value }) {
  const stars = Math.round(parseFloat(value || 0));
  return (
    <span className="bp-stars" aria-label={`${stars} out of 5 stars`}>
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i <= stars ? '#f59e0b' : '#4b5563' }}>★</span>
      ))}
    </span>
  );
}

function Avatar({ src, name, size = 40 }) {
  if (src) return <img src={src} alt={name} className="bp-avatar" style={{ width: size, height: size }} />;
  return (
    <div className="bp-avatar bp-avatar-init" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  );
}

function Badge({ children, icon }) {
  return (
    <span className="bp-badge">
      {icon && <span className="bp-badge-icon">{icon}</span>}
      {children}
    </span>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function BusinessProfilePage() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const { user }     = useAuth();

  const [profile, setProfile]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getBusinessPublicProfile(id);
      setProfile(data);
    } catch (e) {
      setError(e?.response?.status === 404 ? 'Business not found.' : 'Failed to load this business profile.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function handleContact() {
    if (!user) {
      navigate('/login', { state: { from: `/business/${id}` } });
      return;
    }
    // Open a conversation with the business owner
    navigate(`/messages?helperId=${profile.business.owner_id}&helperName=${encodeURIComponent(profile.business.business_name)}`);
  }

  function handleHire() {
    if (!user) {
      navigate('/login', { state: { from: `/business/${id}` } });
      return;
    }
    navigate(`/post-job?helperId=${profile.business.owner_id}&helperName=${encodeURIComponent(profile.business.business_name)}`);
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bp-shell">
        <Navbar />
        <div className="bp-loading-wrap">
          <div className="bp-spinner" />
          <p>Loading business profile…</p>
        </div>
        <Footer />
      </div>
    );
  }

  // ── error ─────────────────────────────────────────────────────────────────
  if (error || !profile) {
    return (
      <div className="bp-shell">
        <Navbar />
        <div className="bp-error-wrap">
          <p className="bp-error-msg">{error || 'Something went wrong.'}</p>
          <Link to="/helpers" className="bp-btn-outline">Browse helpers</Link>
        </div>
        <Footer />
      </div>
    );
  }

  const { business, services, reviews, gallery, faqs, policies, team } = profile;
  const avgRating    = parseFloat(business.avg_rating || 0);
  const totalReviews = parseInt(business.total_reviews || 0);
  const location     = [business.address_city, business.address_state].filter(Boolean).join(', ');

  return (
    <div className="bp-shell">
      <PageMeta
        title={`${business.business_name} — OxSteed`}
        description={business.description || business.bio_short || `Hire ${business.business_name} on OxSteed`}
      />
      <Navbar />

      {/* ── Cover + header ───────────────────────────────────────────────── */}
      <div className="bp-cover" style={business.cover_photo_url ? { backgroundImage: `url(${business.cover_photo_url})` } : {}}>
        <div className="bp-cover-overlay" />
      </div>

      <div className="bp-page">
        <div className="bp-layout">

          {/* ── Left column ─────────────────────────────────────────────── */}
          <div className="bp-main">

            {/* Identity card */}
            <div className="bp-identity">
              <div className="bp-identity-top">
                <Avatar src={business.logo_url || business.owner_photo} name={business.business_name} size={72} />
                <div className="bp-identity-info">
                  <h1 className="bp-name">{business.business_name}</h1>
                  {business.profile_headline && (
                    <p className="bp-headline">{business.profile_headline}</p>
                  )}
                  {location && <p className="bp-location">📍 {location}</p>}
                  {totalReviews > 0 && (
                    <div className="bp-rating-row">
                      <StarRating value={avgRating} />
                      <span className="bp-rating-count">{avgRating.toFixed(1)} ({totalReviews} review{totalReviews !== 1 ? 's' : ''})</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Trust badges */}
              <div className="bp-badges">
                {business.is_identity_verified  && <Badge icon="✓">ID Verified</Badge>}
                {business.is_background_checked && <Badge icon="✓">Background Check</Badge>}
                {business.is_insured            && <Badge icon="✓">Insured</Badge>}
                {business.is_licensed           && <Badge icon="✓">Licensed</Badge>}
                {business.completed_jobs_count > 0 && (
                  <Badge>{business.completed_jobs_count} jobs completed</Badge>
                )}
              </div>

              {/* About */}
              {(business.description || business.bio_short) && (
                <p className="bp-about">{business.description || business.bio_short}</p>
              )}

              {/* Contact links */}
              <div className="bp-contact-links">
                {business.phone && (
                  <a href={`tel:${business.phone}`} className="bp-contact-link">📞 {business.phone}</a>
                )}
                {business.website && (
                  <a href={business.website} target="_blank" rel="noopener noreferrer" className="bp-contact-link">
                    🌐 {business.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            </div>

            {/* Services */}
            {services.length > 0 && (
              <section className="bp-section" id="services">
                <h2 className="bp-section-title">Services</h2>
                <div className="bp-services">
                  {services.map(s => (
                    <div key={s.id} className="bp-service-card">
                      <div className="bp-service-name">
                        {s.name}
                        {s.popular && <span className="bp-popular">Popular</span>}
                      </div>
                      {s.description && <p className="bp-service-desc">{s.description}</p>}
                      {s.price && (
                        <p className="bp-service-price">
                          ${parseFloat(s.price).toFixed(2)}
                          {s.price_unit && <span> / {s.price_unit}</span>}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Gallery */}
            {gallery.length > 0 && (
              <section className="bp-section" id="gallery">
                <h2 className="bp-section-title">Photos</h2>
                <div className="bp-gallery">
                  {gallery.map(g => (
                    <div key={g.id} className="bp-gallery-item">
                      <img src={g.url} alt={g.caption || ''} loading="lazy" />
                      {g.caption && <p className="bp-gallery-caption">{g.caption}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Team */}
            {team.length > 0 && (
              <section className="bp-section" id="team">
                <h2 className="bp-section-title">Our Team</h2>
                <div className="bp-team">
                  {team.map((m, i) => (
                    <div key={i} className="bp-team-card">
                      <Avatar src={m.profile_photo_url} name={`${m.first_name} ${m.last_name}`} size={48} />
                      <div>
                        <p className="bp-team-name">{m.first_name} {m.last_name}</p>
                        <p className="bp-team-role">{m.role === 'manager' ? 'Manager' : 'Representative'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Reviews */}
            {reviews.length > 0 && (
              <section className="bp-section" id="reviews">
                <h2 className="bp-section-title">Reviews</h2>
                <div className="bp-reviews">
                  {reviews.map(r => (
                    <div key={r.id} className="bp-review">
                      <div className="bp-review-header">
                        <Avatar src={null} name={`${r.first_name} ${r.last_name}`} size={36} />
                        <div>
                          <p className="bp-review-name">{r.first_name} {r.last_name}</p>
                          <StarRating value={r.rating} />
                        </div>
                        <span className="bp-review-date">
                          {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      {r.comment && <p className="bp-review-text">{r.comment}</p>}
                      {r.response && (
                        <div className="bp-review-response">
                          <strong>Response:</strong> {r.response}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* FAQs */}
            {faqs.length > 0 && (
              <section className="bp-section" id="faqs">
                <h2 className="bp-section-title">FAQs</h2>
                <div className="bp-faqs">
                  {faqs.map(f => (
                    <details key={f.id} className="bp-faq">
                      <summary className="bp-faq-q">{f.question}</summary>
                      <p className="bp-faq-a">{f.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {/* Policies */}
            {policies.length > 0 && (
              <section className="bp-section" id="policies">
                <h2 className="bp-section-title">Policies</h2>
                <div className="bp-policies">
                  {policies.map(p => (
                    <div key={p.id} className="bp-policy">
                      <p className="bp-policy-title">{p.icon} {p.title}</p>
                      <p className="bp-policy-content">{p.content}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ── Right sidebar / CTA ──────────────────────────────────────── */}
          <aside className="bp-sidebar">
            <div className="bp-cta-card">
              <h3 className="bp-cta-title">{business.business_name}</h3>
              {totalReviews > 0 && (
                <div className="bp-rating-row" style={{ justifyContent: 'center', marginBottom: '0.75rem' }}>
                  <StarRating value={avgRating} />
                  <span className="bp-rating-count">{avgRating.toFixed(1)}</span>
                </div>
              )}
              {location && <p className="bp-cta-location">📍 {location}</p>}
              <button className="bp-btn-primary" onClick={handleHire}>Post a Job</button>
              <button className="bp-btn-secondary" onClick={handleContact}>Message</button>
              {business.phone && (
                <a href={`tel:${business.phone}`} className="bp-btn-outline">Call</a>
              )}
            </div>
          </aside>

        </div>
      </div>

      <Footer />
    </div>
  );
}
