import { useState, useEffect } from 'react';
import axios from '../api/axios';
import { useAuth } from '../context/AuthContext';

interface OutstandingConsent {
  consent_type: string;
  required_version: string;
  accepted_version: string | null;
  label: string;
  url: string;
}

interface TermsGateProps {
  children: React.ReactNode;
}

export default function TermsGate({ children }: TermsGateProps) {
  const { user } = useAuth();
  const [outstanding, setOutstanding] = useState<OutstandingConsent[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    checkConsent();
  }, [user]);

  const checkConsent = async () => {
    try {
      const { data } = await axios.get('/api/consent/status');
      setOutstanding(data.outstanding || []);
    } catch {
      setOutstanding([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await axios.post('/api/consent/accept', {
        consent_types: outstanding.map((o) => o.consent_type),
      });
      setOutstanding([]);
    } catch (err) {
      console.error('Failed to accept terms:', err);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) return null;
  if (!user || outstanding.length === 0) return <>{children}</>;

  const allChecked = outstanding.every((o) => checked[o.consent_type]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.85)',
    }}>
      <div style={{
        background: '#1a1a2e', border: '1px solid #333',
        borderRadius: 12, padding: 32, maxWidth: 520, width: '90%',
        color: '#fff',
      }}>
        <h2 style={{ color: '#f97316', marginBottom: 8 }}>Updated Terms</h2>
        <p style={{ color: '#aaa', marginBottom: 24, fontSize: 14 }}>
          We've updated our policies. Please review and accept to continue using OxSteed.
        </p>

        {outstanding.map((item) => (
          <label key={item.consent_type} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 16, cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={!!checked[item.consent_type]}
              onChange={(e) =>
                setChecked((prev) => ({ ...prev, [item.consent_type]: e.target.checked }))
              }
              style={{ width: 18, height: 18, accentColor: '#f97316' }}
            />
            <span style={{ fontSize: 14 }}>
              I have read and agree to the{' '}
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#f97316', textDecoration: 'underline' }}
              >
                {item.label}
              </a>
              {' '}(v{item.required_version})
            </span>
          </label>
        ))}

        <button
          onClick={handleAccept}
          disabled={!allChecked || accepting}
          style={{
            width: '100%', padding: '12px 0', marginTop: 8,
            borderRadius: 8, border: 'none', fontWeight: 600,
            fontSize: 16, cursor: allChecked ? 'pointer' : 'not-allowed',
            backgroundColor: allChecked ? '#f97316' : '#555',
            color: '#fff',
            opacity: accepting ? 0.7 : 1,
          }}
        >
          {accepting ? 'Accepting...' : 'Accept & Continue'}
        </button>
      </div>
    </div>
  );
}
