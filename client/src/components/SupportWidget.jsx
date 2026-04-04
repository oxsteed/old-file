import { useState, useEffect } from 'react';
import api from '../api/axios';

const CATEGORIES = [
  'General Question',
  'Account / Login',
  'Name Change Request',
  'Billing & Subscription',
  'Job or Bid Issue',
  'Technical Problem',
  'Report a User',
  'Other',
];

export default function SupportWidget() {
  const [open, setOpen]         = useState(false);
  const [form, setForm]         = useState({ name: '', email: '', category: '', subject: '', message: '' });
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState('');

  // Allow other components to open the widget via custom event
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('oxsteed:open-support', handler);
    return () => window.removeEventListener('oxsteed:open-support', handler);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      await api.post('/support/request', form);
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send. Please email support@oxsteed.com directly.');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    // Reset after close animation
    setTimeout(() => { setSent(false); setError(''); setForm({ name: '', email: '', category: '', subject: '', message: '' }); }, 300);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open support chat"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-lg shadow-orange-500/30 font-semibold text-sm transition-all hover:scale-105 active:scale-95"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        Support
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-end p-6 sm:items-center sm:justify-center"
          onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/>
                <span className="font-semibold text-white">OxSteed Support</span>
              </div>
              <button onClick={handleClose} className="text-gray-500 hover:text-white transition p-1 rounded" aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {sent ? (
                /* Success state */
                <div className="flex flex-col items-center justify-center px-6 py-12 text-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <h3 className="text-lg font-semibold text-white">Message sent!</h3>
                  <p className="text-sm text-gray-400">We'll get back to you at <span className="text-white">{form.email}</span> as soon as possible. Check your inbox for a confirmation email.</p>
                  <button onClick={handleClose} className="mt-2 px-5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium text-sm transition">
                    Close
                  </button>
                </div>
              ) : (
                /* Form */
                <form onSubmit={handleSubmit} className="px-5 py-5 flex flex-col gap-4">
                  <p className="text-sm text-gray-400">
                    Have a question or need help? Fill out the form below or email us directly at{' '}
                    <a href="mailto:support@oxsteed.com" className="text-orange-400 hover:text-orange-300">support@oxsteed.com</a>.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Your Name *</label>
                      <input
                        required
                        value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="Jane Smith"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Email Address *</label>
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="you@example.com"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Category</label>
                    <select
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                    >
                      <option value="">Select a topic…</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Subject</label>
                    <input
                      value={form.subject}
                      onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                      placeholder="Brief description"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Message *</label>
                    <textarea
                      required
                      value={form.message}
                      onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                      placeholder="Describe your issue or question…"
                      rows={4}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 resize-none"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={sending}
                    className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-semibold text-sm transition disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : 'Send Message'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
