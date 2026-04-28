import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getFinancialAdvice } from '../api/chat';

/**
 * FinancialAdvisor - AI-powered personalized financial advice
 * Shows user's financial data and allows them to ask questions
 */
export default function FinancialAdvisor({ isOpen, onClose }) {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [window, setWindow] = useState('1m');
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;

    try {
      setError(null);
      const userMessage = { role: 'user', content: input };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput('');
      setLoading(true);

      const response = await getFinancialAdvice(updatedMessages, window, i18n.language);

      if (response.reply) {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: response.reply },
        ]);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to get advice. Please try again.');
      setMessages(prev => prev.slice(0, -1)); // Remove the user message if request fails
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([]);
    setInput('');
    setError(null);
  };

  if (!isOpen) return null;

  const suggestedQuestions = [
    'Can I afford a vacation this year?',
    'What should I prioritize - car repair or home improvement?',
    'How can I improve my financial health score?',
    'Am I on track to meet my goals?',
    'What would happen if I increased my rates by 10%?',
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-app-bg)',
          borderRadius: 'var(--radius-lg)',
          width: '90%',
          maxWidth: '600px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: 'var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600 }}>
              💰 Financial Advisor
            </h2>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-muted-text)' }}>
              Ask questions about your finances
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: 'var(--color-muted-text)',
            }}
          >
            ✕
          </button>
        </div>

        {/* Window selector */}
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
          }}
        >
          <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>
            Analyze:
          </label>
          {['1m', '3m', '6m', '1y'].map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              style={{
                padding: '0.375rem 0.75rem',
                background: window === w ? 'var(--color-primary)' : 'transparent',
                color: window === w ? '#fff' : 'var(--color-text)',
                border: window === w ? 'none' : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                transition: 'all var(--transition-fast)',
              }}
            >
              {w}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {messages.length === 0 && !error && (
            <div style={{ textAlign: 'center', color: 'var(--color-muted-text)' }}>
              <p style={{ marginBottom: 'var(--space-3)' }}>
                Ask me anything about your finances based on your real data
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
                  Suggested questions:
                </p>
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(q);
                      // Auto-send after a slight delay for better UX
                      setTimeout(
                        () => handleSendMessage(),
                        100
                      );
                    }}
                    style={{
                      padding: 'var(--space-2)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      textAlign: 'left',
                      transition: 'all var(--transition-fast)',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--color-surface-3)';
                      e.currentTarget.style.borderColor = 'var(--color-primary)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'var(--color-surface-2)';
                      e.currentTarget.style.borderColor = 'var(--color-border)';
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '85%',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  background:
                    msg.role === 'user'
                      ? 'var(--color-primary)'
                      : 'var(--color-surface-2)',
                  color:
                    msg.role === 'user'
                      ? '#fff'
                      : 'var(--color-text)',
                  wordWrap: 'break-word',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              <div style={{ color: 'var(--color-muted-text)' }}>
                <span style={{ display: 'inline-block', animation: 'bounce 1.4s infinite' }}>●</span>
                <span style={{ display: 'inline-block', animation: 'bounce 1.4s infinite 0.2s', marginLeft: '0.25rem' }}>
                  ●
                </span>
                <span style={{ display: 'inline-block', animation: 'bounce 1.4s infinite 0.4s', marginLeft: '0.25rem' }}>
                  ●
                </span>
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: 'var(--space-3)',
                background: 'var(--color-error-bg)',
                color: 'var(--color-error)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          style={{
            padding: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            gap: 'var(--space-2)',
          }}
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyPress={e => {
              if (e.key === 'Enter' && !loading) {
                handleSendMessage();
              }
            }}
            placeholder="Ask about your finances..."
            disabled={loading}
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-app-bg)',
              color: 'var(--color-text)',
              fontSize: 'var(--text-sm)',
              outline: 'none',
              transition: 'border var(--transition-fast)',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'var(--color-primary)';
            }}
            onBlur={e => {
              e.target.style.borderColor = 'var(--color-border)';
            }}
          />
          <button
            onClick={handleSendMessage}
            disabled={!input.trim() || loading}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              opacity: loading ? 0.6 : 1,
              transition: 'opacity var(--transition-fast)',
            }}
          >
            Send
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleReset}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                background: 'transparent',
                color: 'var(--color-muted-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% {
            opacity: 0.5;
            transform: translateY(0);
          }
          40% {
            opacity: 1;
            transform: translateY(-4px);
          }
        }
      `}</style>
    </div>
  );
}
