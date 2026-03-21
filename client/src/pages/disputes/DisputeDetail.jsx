import { useEffect, useState, useRef } from 'react';
import { useParams }                   from 'react-router-dom';
import { Send, Upload, AlertTriangle } from 'lucide-react';
import { useAuth }                     from '../../hooks/useAuth';
import { useSocket }                   from '../../hooks/useSocket';
import api                             from '../../lib/api';

export default function DisputeDetail() {
  const { disputeId }            = useParams();
  const { user }                 = useAuth();
  const { socket }               = useSocket();
  const [dispute,   setDispute]  = useState(null);
  const [evidence,  setEvidence] = useState([]);
  const [messages,  setMessages] = useState([]);
  const [message,   setMessage]  = useState('');
  const [evText,    setEvText]   = useState('');
  const [evFiles,   setEvFiles]  = useState([]);
  const [sending,   setSending]  = useState(false);
  const [submitting,setSubmitting] = useState(false);
  const [loading,   setLoading]  = useState(true);
  const [error,     setError]    = useState(null);
  const messagesEndRef           = useRef(null);

  const fetchDispute = async () => {
    try {
      const { data } = await api.get(`/disputes/${disputeId}`);
      setDispute(data.dispute);
      setEvidence(data.evidence);
      setMessages(data.messages);
    } catch (err) {
      setError('Dispute not found or access denied.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDispute(); }, [disputeId]);

  // Real-time messages
  useEffect(() => {
    if (!socket) return;
    socket.on('dispute:message', ({ disputeId: dId, message: msg }) => {
      if (dId === disputeId) {
        setMessages(prev => [...prev, msg]);
      }
    });
    return () => socket.off('dispute:message');
  }, [socket, disputeId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    try {
      await api.post(`/disputes/${disputeId}/messages`, {
        message: message.trim()
      });
      setMessage('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmitEvidence = async (e) => {
    e.preventDefault();
    if (!evText.trim() && !evFiles.length) {
      setError('Please provide text or files as evidence.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      if (evText.trim()) form.append('content', evText.trim());
      evFiles.forEach(f => form.append('files', f));

      await api.post(`/disputes/${disputeId}/evidence`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setEvText('');
      setEvFiles([]);
      fetchDispute();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit evidence.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center text-gray-400">
      Loading dispute...
    </div>
  );

  if (error && !dispute) return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center">
      <p className="text-red-500">{error}</p>
    </div>
  );

  const isOpen    = ['open','under_review'].includes(dispute.status);
  const myRole    = dispute.client_id === user?.id ? 'client' : 'helper';
  const deadlinePassed = new Date(dispute.evidence_deadline) < new Date();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-orange-500" />
              <span className="text-xs font-semibold text-orange-600
                               uppercase tracking-wide">
                Dispute #{disputeId.split('-')[0]}
              </span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              {dispute.job_title}
            </h1>
            <p className="text-sm text-gray-500 mt-1 capitalize">
              Reason: {dispute.reason.replace(/_/g, ' ')}
            </p>
          </div>
          <div className="text-right">
            <DisputeStatusBadge status={dispute.status} />
            {dispute.job_amount && (
              <p className="text-lg font-bold text-gray-800 mt-2">
                                ${parseFloat(dispute.job_amount).toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="mt-4 bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase
                        tracking-wider mb-1">
            Original Description
          </p>
          <p className="text-sm text-gray-700 leading-relaxed">
            {dispute.description}
          </p>
        </div>

        {/* Parties */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {[
            { label: 'Filed by', name: dispute.opened_by_name,
              avatar: dispute.opened_by_avatar,
              role: dispute.opened_by_role },
            { label: 'Against',  name: dispute.against_user_name,
              avatar: dispute.against_user_avatar,
              role: dispute.opened_by_role === 'client' ? 'helper' : 'client' }
          ].map(({ label, name, avatar, role }) => (
            <div key={label}
                 className="flex items-center gap-3 bg-gray-50
                            rounded-xl p-3">
              <img
                src={avatar || '/default-avatar.png'}
                alt=""
                className="w-9 h-9 rounded-full object-cover
                           border border-gray-200"
              />
              <div>
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-sm font-semibold text-gray-800">
                  {name}
                </p>
                <p className="text-xs text-gray-500 capitalize">{role}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Resolution (if resolved) */}
        {dispute.resolution && (
          <div className="mt-4 bg-green-50 border border-green-200
                          rounded-xl p-4">
            <p className="text-xs font-semibold text-green-700 uppercase
                          tracking-wider mb-1">
              Resolution
            </p>
            <p className="text-sm font-semibold text-green-800 capitalize">
              {dispute.resolution.replace(/_/g, ' ')}
            </p>
            {dispute.resolution_notes && (
              <p className="text-sm text-green-700 mt-1 leading-relaxed">
                {dispute.resolution_notes}
              </p>
            )}
            {dispute.refund_amount && (
              <p className="text-sm font-bold text-green-800 mt-1">
                Refund: ${parseFloat(dispute.refund_amount).toFixed(2)}
              </p>
            )}
            <p className="text-xs text-green-600 mt-2">
              Resolved by {dispute.resolved_by_name} ·{' '}
              {new Date(dispute.resolved_at).toLocaleString()}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Evidence Panel ── */}
        <div className="space-y-4">
          <h2 className="font-semibold text-gray-800">
            Evidence ({evidence.length})
          </h2>

          {/* Evidence items */}
          {evidence.length === 0 ? (
            <div className="bg-gray-50 rounded-xl p-6 text-center
                            text-gray-400 text-sm">
              No evidence submitted yet.
            </div>
          ) : (
            <div className="space-y-3">
              {evidence.map(item => (
                <div key={item.id}
                     className={`border rounded-xl p-4 ${
                  item.submitted_by === user?.id
                    ? 'border-orange-200 bg-orange-50'
                    : 'border-gray-200 bg-white'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <img
                      src={item.submitted_by_avatar || '/default-avatar.png'}
                      alt=""
                      className="w-6 h-6 rounded-full object-cover"
                    />
                    <p className="text-xs font-semibold text-gray-700">
                      {item.submitted_by_name}
                    </p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full
                                      capitalize ml-auto ${
                      item.submitter_role === 'client'
                        ? 'bg-blue-100 text-blue-600'
                        : item.submitter_role === 'admin'
                        ? 'bg-purple-100 text-purple-600'
                        : 'bg-green-100 text-green-600'
                    }`}>
                      {item.submitter_role}
                    </span>
                  </div>

                  {item.type === 'text' && item.content && (
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {item.content}
                    </p>
                  )}

                  {['image','video'].includes(item.type) && item.file_url && (
                    <a href={item.file_url}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="block mt-2">
                      {item.type === 'image' ? (
                        <img
                          src={item.file_url}
                          alt={item.file_name}
                          className="w-full max-h-48 object-cover rounded-lg
                                     border border-gray-200"
                        />
                      ) : (
                        <div className="bg-gray-900 text-white text-xs
                                        rounded-lg px-3 py-2 flex items-center
                                        gap-2">
                          🎥 {item.file_name}
                        </div>
                      )}
                    </a>
                  )}

                  {item.type === 'document' && item.file_url && (
                    <a href={item.file_url}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="flex items-center gap-2 mt-2 text-xs
                                  text-orange-600 hover:text-orange-700
                                  font-medium transition">
                      📄 {item.file_name}
                    </a>
                  )}

                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Submit evidence form */}
          {isOpen && !deadlinePassed && (
            <form onSubmit={handleSubmitEvidence}
                  className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-gray-700 mb-3">
                Submit Evidence
              </p>

              <textarea
                value={evText}
                onChange={e => setEvText(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Describe what happened, provide context, links, or any relevant information..."
                className="w-full px-3 py-2.5 border border-gray-200
                           rounded-lg text-sm focus:ring-2
                           focus:ring-orange-400 focus:outline-none
                           resize-none mb-3"
              />

              {/* File upload */}
              abel className="flex items-center gap-2 text-sm
                                text-gray-500 cursor-pointer mb-3
                                hover:text-orange-500 transition">
                <Upload size={15} />
                Attach files (images, videos, documents — max 5)
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.doc,.docx"
                  className="hidden"
                  onChange={e => setEvFiles(Array.from(e.target.files))}
                />
              </label>

              {evFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {evFiles.map((f, i) => (
                    <span key={i}
                          className="text-xs bg-orange-50 text-orange-600
                                     px-2 py-0.5 rounded-full border
                                     border-orange-200">
                      {f.name}
                    </span>
                  ))}
                </div>
              )}

              {error && (
                <p className="text-xs text-red-500 mb-3">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-orange-500 text-white text-sm
                           font-semibold rounded-lg hover:bg-orange-600
                           disabled:opacity-50 transition"
              >
                {submitting ? 'Submitting...' : 'Submit Evidence'}
              </button>
            </form>
          )}

          {deadlinePassed && isOpen && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl
                            p-4 text-center text-sm text-gray-500">
              Evidence window closed. Awaiting admin review.
            </div>
          )}
        </div>

        {/* ── Message Thread ── */}
        <div className="flex flex-col">
          <h2 className="font-semibold text-gray-800 mb-4">
            Messages
          </h2>

          {/* Messages scroll area */}
          <div className="flex-1 bg-white border border-gray-200
                          rounded-xl overflow-hidden flex flex-col"
               style={{ minHeight: '400px' }}>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">
                  No messages yet. Send a message to communicate with
                  the other party.
                </p>
              ) : messages.map(msg => {
                const isMe = msg.sender_id === user?.id;
                return (
                  <div key={msg.id}
                       className={`flex items-end gap-2 ${
                    isMe ? 'flex-row-reverse' : ''
                  }`}>
                    <img
                      src={msg.sender_avatar || '/default-avatar.png'}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover
                                 border border-gray-200 shrink-0"
                    />
                    <div className={`max-w-xs ${isMe ? 'items-end' : ''
                                    } flex flex-col`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <p className="text-xs text-gray-400">
                          {msg.sender_name}
                        </p>
                        {msg.sender_role === 'admin' && (
                          <span className="text-xs px-1.5 py-0.5
                                           bg-purple-100 text-purple-600
                                           rounded-full font-medium">
                            Support
                          </span>
                        )}
                      </div>
                      <div className={`px-4 py-2.5 rounded-2xl text-sm
                                       leading-relaxed ${
                        isMe
                          ? 'bg-orange-500 text-white rounded-br-sm'
                          : msg.sender_role === 'admin'
                          ? 'bg-purple-100 text-purple-900 rounded-bl-sm'
                          : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                      }`}>
                        {msg.message}
                      </div>
                      <p className="text-xs text-gray-400 mt-1 px-1">
                        {new Date(msg.created_at).toLocaleTimeString(
                          'en-US', { hour: '2-digit', minute: '2-digit' }
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            {isOpen && (
              <form
                onSubmit={handleSendMessage}
                className="border-t border-gray-100 p-3 flex gap-2"
              >
                <input
                  type="text"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  maxLength={1000}
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-2 bg-gray-50 border
                             border-gray-200 rounded-xl text-sm
                             focus:outline-none focus:ring-2
                             focus:ring-orange-400"
                />
                <button
                  type="submit"
                  disabled={sending || !message.trim()}
                  className="p-2.5 bg-orange-500 text-white rounded-xl
                             hover:bg-orange-600 disabled:opacity-50
                             transition"
                >
                  <Send size={16} />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DisputeStatusBadge({ status }) {
  const map = {
    open:         'bg-yellow-100 text-yellow-700',
    under_review: 'bg-blue-100   text-blue-700',
    resolved:     'bg-green-100  text-green-700',
    closed:       'bg-gray-100   text-gray-500'
  };
  return (
    <span className={`inline-flex px-3 py-1 rounded-full text-xs
                      font-semibold capitalize ${
      map[status] || 'bg-gray-100 text-gray-500'
    }`}>
      {status.replace('_', ' ')}
    </span>
  );
}
