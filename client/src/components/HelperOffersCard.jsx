import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';

/**
 * Task 3: "Offers for Me" card for the Helper Dashboard.
 * Shows pending preferred-helper requests with countdown + accept/decline.
 * Import into HelperDashboard.jsx and render:
 *   <HelperOffersCard />
 */
export default function HelperOffersCard() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchOffers = async () => {
    try {
      const { data } = await api.get('/api/planned-needs/helper/offers');
      setOffers(data.offers || []);
    } catch (err) {
      console.error('Failed to fetch helper offers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOffers(); }, []);

  const handleAccept = async (id) => {
    try {
      await api.post(`/api/planned-needs/${id}/helper/accept`);
      fetchOffers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to accept');
    }
  };

  const handleDecline = async (id) => {
    if (!window.confirm('Decline this offer? The job will be opened to all helpers.')) return;
    try {
      await api.post(`/api/planned-needs/${id}/helper/decline`);
      fetchOffers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to decline');
    }
  };

  if (loading) return null;
  if (!offers.length) return null;

  return (
    <div style={{
      background: '#eff6ff',
      border: '1px solid #bfdbfe',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '20px',
    }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#1e40af' }}>
        Job Offers for You ({offers.length})
      </h3>
      {offers.map(offer => (
        <div key={offer.id} style={{
          background: 'white',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '8px',
          border: '1px solid #e5e7eb',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div>
              <strong>{offer.title}</strong>
              <p style={{ margin: '4px 0', color: '#6b7280', fontSize: '13px' }}>
                From {offer.customer_first_name} {offer.customer_last_initial}
                {offer.estimated_cost && <> &middot; Est. ${parseFloat(offer.estimated_cost).toFixed(2)}</>}
              </p>
              <p style={{ margin: '2px 0', color: '#9ca3af', fontSize: '12px' }}>
                {offer.hours_remaining > 0
                  ? `${Math.round(offer.hours_remaining)}h remaining`
                  : 'Expiring soon'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button
                onClick={() => handleAccept(offer.id)}
                style={{
                  background: '#16a34a', color: 'white', border: 'none',
                  borderRadius: '6px', padding: '6px 14px', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600,
                }}
              >Accept</button>
              <button
                onClick={() => handleDecline(offer.id)}
                style={{
                  background: 'white', color: '#dc2626', border: '1px solid #fca5a5',
                  borderRadius: '6px', padding: '6px 14px', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600,
                }}
              >Decline</button>
            </div>
          </div>
          {offer.published_job_id && (
            <Link to={`/jobs/${offer.published_job_id}`} style={{
              color: '#2563eb', fontSize: '13px', textDecoration: 'none',
            }}>View Job Details &rarr;</Link>
          )}
        </div>
      ))}
    </div>
  );
}
