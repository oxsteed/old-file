import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';
import toast from 'react-hot-toast';
import PageMeta from '../components/PageMeta';

export default function ConsultingFeedbackPage() {
  const { t } = useTranslation();
  const { sessionId, token } = useParams();
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    if (rating === 0) {
      toast.error('Please select a rating');
      return;
    }

    try {
      setLoading(true);
      await axios.post(`/consulting/feedback/${sessionId}/${token}`, {
        rating,
        feedbackText: feedback,
        name,
        email,
      });
      setSubmitted(true);
      toast.success('Thank you for your feedback!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit feedback');
    } finally {
      setLoading(false);
    }
  }

  const containerStyle = {
    maxWidth: '600px',
    margin: '4rem auto',
    padding: '2rem',
    background: 'var(--color-surface)',
    borderRadius: '12px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  };

  const formGroupStyle = {
    marginBottom: '1.5rem',
  };

  const labelStyle = {
    display: 'block',
    fontWeight: '600',
    marginBottom: '0.5rem',
    color: 'var(--color-text)',
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '1rem',
    fontFamily: 'inherit',
  };

  const ratingContainerStyle = {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'center',
    marginTop: '0.5rem',
  };

  const starStyle = (index) => ({
    fontSize: '3rem',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    transform: index < rating ? 'scale(1.1)' : 'scale(1)',
    opacity: index < rating ? 1 : 0.4,
  });

  const buttonStyle = {
    padding: '0.75rem 1.5rem',
    borderRadius: '6px',
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '1rem',
    width: '100%',
    opacity: loading ? 0.6 : 1,
  };

  if (submitted) {
    return (
      <>
        <PageMeta title="Feedback Submitted - OxSteed Consulting" />
        <div style={containerStyle}>
          <h1 style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--color-text)' }}>
            Thank You! ✓
          </h1>
          <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
            We appreciate your feedback. Your response helps us improve our consulting services.
          </p>
          <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            Our team will review your feedback and use it to enhance future consulting sessions.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Session Feedback - OxSteed Consulting" />
      <div style={containerStyle}>
        <h1 style={{ textAlign: 'center', marginBottom: '0.5rem', color: 'var(--color-text)' }}>
          How was your consulting session?
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
          Your feedback helps us deliver better consulting services
        </p>

        <form onSubmit={handleSubmit}>
          {/* Rating */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Rate Your Session</label>
            <div style={ratingContainerStyle}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  style={starStyle(star)}
                  onClick={() => setRating(star)}
                  title={`${star} star${star > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
            </div>
            {rating > 0 && (
              <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
              </p>
            )}
          </div>

          {/* Feedback Text */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Additional Comments (Optional)</label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Tell us what you thought about the session..."
              style={{
                ...inputStyle,
                minHeight: '120px',
                fontFamily: 'inherit',
              }}
              maxLength={1000}
            />
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              {feedback.length}/1000
            </p>
          </div>

          {/* Name */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Your Name (Optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              style={inputStyle}
            />
          </div>

          {/* Email */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Your Email (Optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              style={inputStyle}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            style={buttonStyle}
            disabled={loading || rating === 0}
          >
            {loading ? 'Submitting...' : 'Submit Feedback'}
          </button>

          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '1rem' }}>
            Your feedback is anonymous unless you provide your name and email.
          </p>
        </form>
      </div>
    </>
  );
}
