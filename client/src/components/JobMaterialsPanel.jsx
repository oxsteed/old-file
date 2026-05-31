import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listCampaigns } from '../api/logistics';

/**
 * JobMaterialsPanel
 * Appears in the job detail sidebar when the viewer is a helper.
 * Shows active logistics campaigns that match the job's category,
 * and a CTA to create a sourcing request pre-filled with that category.
 *
 * Props:
 *   category  – job.category_name (e.g. "Home Repair", "Automotive")
 *   jobId     – used to pre-populate the sourcing request link
 */
export default function JobMaterialsPanel({ category, jobId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!category) { setLoading(false); return; }
    listCampaigns({ category, status: 'open', limit: 3 })
      .then(res => setCampaigns(res.data || res.campaigns || []))
      .catch(() => setCampaigns([]))
      .finally(() => setLoading(false));
  }, [category]);

  // Don't render until we know whether there's anything useful to show
  if (loading) return null;

  const newRequestUrl = category
    ? `/logistics/requests/new?category=${encodeURIComponent(category)}&job_id=${jobId}`
    : '/logistics/requests/new';

  return (
    <div
      className="jdp-card jdp-sidebar-card"
      style={{ borderColor: 'rgba(249,115,22,.25)', background: 'rgba(249,115,22,.03)' }}
    >
      {/* Header */}
      <h3
        className="jdp-sidebar-title"
        style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5">
          <rect x="1" y="3" width="15" height="13" rx="2"/>
          <path d="M16 8h5l2 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="1.5"/>
          <circle cx="18.5" cy="18.5" r="1.5"/>
        </svg>
        Source materials
      </h3>

      {/* Body */}
      <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.875rem', lineHeight: 1.5 }}>
        Need supplies for this {category ? `${category} ` : ''}job?
        OxSteed Logistics can source them at volume pricing.
      </p>

      {/* Matching campaigns */}
      {campaigns.length > 0 && (
        <div style={{ marginBottom: '0.875rem' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Open campaigns · {category}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {campaigns.map(c => (
              <Link
                key={c.id}
                to={`/logistics/campaigns/${c.id}`}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.5rem 0.625rem', borderRadius: '0.5rem',
                  background: 'rgba(249,115,22,.07)', border: '1px solid rgba(249,115,22,.18)',
                  textDecoration: 'none', color: 'inherit',
                }}
              >
                <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#e2e8f0' }}>
                  {c.title || c.name}
                </span>
                <span style={{ fontSize: '0.72rem', color: '#f97316', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: '0.5rem' }}>
                  Join →
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <Link
        to={newRequestUrl}
        style={{
          display: 'block', width: '100%', textAlign: 'center',
          padding: '0.5625rem 1rem', borderRadius: '0.5rem',
          border: '1px solid rgba(249,115,22,.4)', color: '#f97316',
          fontWeight: 600, fontSize: '0.8125rem', textDecoration: 'none',
          transition: 'background 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        Open sourcing request
      </Link>
    </div>
  );
}
