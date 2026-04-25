import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';

const STATUS_COLORS = {
  pending: '#FFA500',
  contacted: '#4F46E5',
  kickoff_scheduled: '#8B5CF6',
  in_progress: '#0EA5E9',
  completed: '#10B981',
  cancelled: '#EF4444',
};

const STATUS_DESCRIPTIONS = {
  pending: 'Your intake form has been received. Our team is reviewing it.',
  contacted: 'We have reviewed your submission and will be reaching out soon.',
  kickoff_scheduled: 'Your kickoff call is scheduled. Check your email for details.',
  in_progress: 'Your business setup is underway. We are implementing your services.',
  completed: 'Your Business Launch Program is complete! Welcome to your new business.',
  cancelled: 'This request has been cancelled.',
};

export default function BusinessLaunchStatusPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [email, setEmail] = useState('');
  const [searchStatus, setSearchStatus] = useState('pending');

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email);
    }
  }, [user]);

  async function searchRequests() {
    if (!email) {
      toast.error(t('businessLaunchStatus.enterEmail'));
      return;
    }

    try {
      setLoading(true);
      // For authenticated users, fetch their own requests
      // For unauthenticated users, they need to search by email
      if (user?.email === email || user?.id) {
        const res = await api.get('/api/consulting/business-launch/my-requests');
        setRequests(res.data || []);
      } else {
        // Public search by email (if backend supports it)
        const res = await api.get(`/api/consulting/business-launch/search?email=${encodeURIComponent(email)}`);
        setRequests(res.data || []);
      }

      if (requests.length === 0) {
        toast.info(t('businessLaunchStatus.noRequests'));
      }
    } catch (err) {
      console.error('Error searching requests', err);
      toast.error(t('businessLaunchStatus.searchError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.email) {
      searchRequests();
    } else {
      setLoading(false);
    }
  }, [user]);

  const containerStyle = {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '2rem',
  };

  const headerStyle = {
    marginBottom: '3rem',
    textAlign: 'center',
  };

  const titleStyle = {
    fontSize: '2.5rem',
    fontWeight: 700,
    marginBottom: '0.5rem',
  };

  const subtitleStyle = {
    fontSize: '1.1rem',
    color: 'var(--color-text-muted)',
  };

  const searchBoxStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '1rem',
    marginBottom: '2rem',
  };

  const inputStyle = {
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '1rem',
  };

  const buttonStyle = {
    padding: '0.75rem 1.5rem',
    borderRadius: '6px',
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '1rem',
  };

  const cardStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  };

  const requestListStyle = {
    display: 'grid',
    gap: '1rem',
  };

  const statusBadgeStyle = (color) => ({
    display: 'inline-block',
    background: color || 'var(--color-bg)',
    color: 'white',
    padding: '0.5rem 1rem',
    borderRadius: '20px',
    fontSize: '0.9rem',
    fontWeight: 600,
  });

  const progressBarStyle = {
    width: '100%',
    height: '8px',
    background: 'var(--color-bg)',
    borderRadius: '4px',
    marginTop: '1rem',
    overflow: 'hidden',
  };

  const progressFillStyle = (status) => {
    const statusOrder = {
      pending: 15,
      contacted: 30,
      kickoff_scheduled: 50,
      in_progress: 75,
      completed: 100,
      cancelled: 0,
    };

    return {
      height: '100%',
      background: STATUS_COLORS[status] || '#6B7280',
      width: `${statusOrder[status] || 0}%`,
      transition: 'width 0.3s ease',
    };
  };

  const modalStyle = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem',
  };

  const modalContentStyle = {
    background: 'var(--color-surface)',
    borderRadius: '8px',
    padding: '2rem',
    maxWidth: '600px',
    width: '100%',
    maxHeight: '85vh',
    overflowY: 'auto',
  };

  const sectionStyle = {
    marginBottom: '1.5rem',
  };

  const sectionTitleStyle = {
    fontSize: '1.1rem',
    fontWeight: 600,
    marginBottom: '0.75rem',
  };

  if (loading && user?.email) {
    return (
      <PageShell>
        <PageMeta title="Business Launch Status" url="/business-launch-status" />
        <div style={containerStyle}>
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              margin: '0 auto 1rem',
              border: '4px solid var(--color-primary)',
              borderTop: '4px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
            {t('common.loading')}
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta
        title="Business Launch Program - Track Your Status"
        url="/business-launch-status"
        description="Check the status of your OxSteed Business Launch Program intake form submission and upcoming milestones."
      />
      <div style={containerStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h1 style={titleStyle}>Track Your Business Launch</h1>
          <p style={subtitleStyle}>
            Check the status of your intake form and upcoming milestones
          </p>
        </div>

        {/* Search Box */}
        {!user?.email && (
          <div style={searchBoxStyle}>
            <input
              type="email"
              placeholder="Enter your email to search..."
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={inputStyle}
              onKeyPress={e => e.key === 'Enter' && searchRequests()}
            />
            <button style={buttonStyle} onClick={searchRequests}>
              Search
            </button>
          </div>
        )}

        {/* Request List */}
        {requests.length === 0 ? (
          <div style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            padding: '2rem',
            textAlign: 'center',
          }}>
            <p style={{ color: 'var(--color-text-muted)' }}>
              {user?.email
                ? 'No intake forms found. Submit a form to get started.'
                : 'Enter your email to search for your submissions.'}
            </p>
            {!user?.email && (
              <a href="/consulting-intake" style={{
                display: 'inline-block',
                marginTop: '1rem',
                color: 'var(--color-primary)',
                textDecoration: 'none',
                fontWeight: 600,
              }}>
                Start Your Business Launch →
              </a>
            )}
          </div>
        ) : (
          <div style={requestListStyle}>
            {requests.map(request => (
              <div
                key={request.id}
                style={cardStyle}
                onClick={() => setSelectedRequest(request)}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '1rem',
                  alignItems: 'start',
                  marginBottom: '1rem',
                }}>
                  <div>
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem', fontWeight: 600 }}>
                      {request.business_name || `${request.first_name} ${request.last_name}`}
                    </h3>
                    <p style={{ margin: '0.25rem 0', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                      {request.package_selected} Package • ${request.package_price}
                    </p>
                    <p style={{ margin: '0.25rem 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                      Submitted: {new Date(request.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={statusBadgeStyle(STATUS_COLORS[request.status])}>
                    {request.status.replace('_', ' ')}
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={progressBarStyle}>
                  <div style={progressFillStyle(request.status)} />
                </div>

                {/* Status Description */}
                <p style={{
                  margin: '1rem 0 0',
                  color: 'var(--color-text-muted)',
                  fontSize: '0.95rem',
                }}>
                  {STATUS_DESCRIPTIONS[request.status] || 'Status unknown'}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Detail Modal */}
        {selectedRequest && (
          <div style={modalStyle} onClick={() => setSelectedRequest(null)}>
            <div style={modalContentStyle} onClick={e => e.stopPropagation()}>
              <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
                {selectedRequest.business_name || `${selectedRequest.first_name} ${selectedRequest.last_name}`}
              </h2>

              {/* Current Status */}
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>Current Status</div>
                <div style={{ marginBottom: '1rem' }}>
                  <div style={statusBadgeStyle(STATUS_COLORS[selectedRequest.status])}>
                    {selectedRequest.status.replace('_', ' ')}
                  </div>
                </div>
                <p style={{ color: 'var(--color-text-muted)' }}>
                  {STATUS_DESCRIPTIONS[selectedRequest.status]}
                </p>
                <div style={progressBarStyle}>
                  <div style={progressFillStyle(selectedRequest.status)} />
                </div>
              </div>

              {/* Package & Pricing */}
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>Selected Package</div>
                <p><strong>{selectedRequest.package_selected}</strong> - ${selectedRequest.package_price}</p>
              </div>

              {/* Business Information */}
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>Business Information</div>
                <p><strong>Skill:</strong> {selectedRequest.skill_description}</p>
                <p><strong>Target Market:</strong> {selectedRequest.target_market}</p>
                {selectedRequest.business_name && (
                  <p><strong>Business Name:</strong> {selectedRequest.business_name}</p>
                )}
                <p><strong>Current Phase:</strong> {selectedRequest.current_phase || 'Not specified'} / 25</p>
              </div>

              {/* Setup Items */}
              {selectedRequest.setup_items_selected && selectedRequest.setup_items_selected.length > 0 && (
                <div style={sectionStyle}>
                  <div style={sectionTitleStyle}>Selected Setup Items</div>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}>
                    {selectedRequest.setup_items_selected.map((item, idx) => (
                      <span
                        key={idx}
                        style={{
                          display: 'inline-block',
                          background: 'var(--color-primary)',
                          color: 'white',
                          padding: '0.35rem 0.75rem',
                          borderRadius: '12px',
                          fontSize: '0.85rem',
                        }}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div style={sectionStyle}>
                <div style={sectionTitleStyle}>Timeline</div>
                <p><strong>Submitted:</strong> {new Date(selectedRequest.created_at).toLocaleString()}</p>
                {selectedRequest.updated_at && (
                  <p><strong>Last Updated:</strong> {new Date(selectedRequest.updated_at).toLocaleString()}</p>
                )}
              </div>

              {/* Next Steps */}
              <div style={{
                background: 'var(--color-bg)',
                padding: '1rem',
                borderRadius: '6px',
                marginBottom: '1.5rem',
              }}>
                <div style={sectionTitleStyle}>What's Next?</div>
                <ol style={{ margin: 0, paddingLeft: '1.5rem', color: 'var(--color-text-muted)' }}>
                  <li>Our team will review your submission</li>
                  <li>You'll receive an email confirming the next steps</li>
                  <li>We'll schedule your kickoff call</li>
                  <li>Your business setup begins!</li>
                </ol>
              </div>

              {/* Contact Info */}
              <div style={{
                fontSize: '0.9rem',
                color: 'var(--color-text-muted)',
                textAlign: 'center',
                paddingTop: '1rem',
                borderTop: '1px solid var(--color-border)',
              }}>
                <p>Have questions? Contact us at <strong>support@oxsteed.com</strong></p>
              </div>

              {/* Close Button */}
              <button
                style={{
                  ...buttonStyle,
                  width: '100%',
                  marginTop: '1rem',
                }}
                onClick={() => setSelectedRequest(null)}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* CSS Animation */}
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </PageShell>
  );
}
