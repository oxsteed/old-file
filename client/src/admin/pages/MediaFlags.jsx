import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function MediaFlagsPage() {
  const [flags, setFlags] = useState([]);
  const [pendingPosts, setPendingPosts] = useState([]);
  const [approvalReasons, setApprovalReasons] = useState({});
  const [verificationRequests, setVerificationRequests] = useState([]);
  const [verificationNotes, setVerificationNotes] = useState({});
  const [verificationError, setVerificationError] = useState('');
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data }, pending] = await Promise.all([
        axios.get('/api/admin/media/flags', { params: { status } }),
        axios.get('/api/admin/media/posts/pending'),
      ]);
      setFlags(data.flags);
      setPendingPosts(pending.data.posts || []);
      try {
        const verification = await axios.get('/api/admin/media/verification-requests', { params: { status: 'submitted' } });
        setVerificationRequests(verification.data.requests || []);
        setVerificationError('');
      } catch (verificationErr) {
        setVerificationRequests([]);
        setVerificationError(verificationErr.response?.data?.error || 'Verification requests require the verify_users permission.');
      }
    } catch (err) {
      console.error('Failed to load flags', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerificationReview = async (id, status) => {
    const note = String(verificationNotes[id] || '').trim();
    if ((status === 'needs_changes' || status === 'rejected') && note.length < 3) return;
    try {
      await axios.post(`/api/admin/media/verification-requests/${id}/review`, { status, note });
      setVerificationNotes((current) => ({ ...current, [id]: '' }));
      load();
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleApprove = async (id) => {
    const reason = String(approvalReasons[id] || '').trim();
    if (reason.length < 3) return;
    try {
      await axios.post(`/api/admin/media/posts/${id}/approve`, { reason });
      setApprovalReasons((current) => ({ ...current, [id]: '' }));
      load();
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  useEffect(() => { load(); }, [status]);

  const handleReview = async (id, action) => {
    try {
      await axios.post(`/api/admin/media/flags/${id}/review`, { action });
      load();
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="admin-page">
      <h1>Media Flags</h1>
      <section>
        <h2>Publisher verification requests</h2>
        {verificationError && <p>{verificationError}</p>}
        {!verificationError && !verificationRequests.length ? <p>No pending publisher verification requests.</p> : (
          <table className="admin-table">
            <thead><tr><th>Entity</th><th>Requester</th><th>Details</th><th>Review note</th><th>Actions</th></tr></thead>
            <tbody>
              {verificationRequests.map((request) => (
                <tr key={request.id}>
                  <td>{request.entity_type}: {request.entity_name || request.entity_id}</td>
                  <td>{request.requester_name || request.requester_email}</td>
                  <td>{request.details?.notes || '—'}</td>
                  <td><input value={verificationNotes[request.id] || ''} onChange={(event) => setVerificationNotes((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Add a note for changes or rejection" /></td>
                  <td>
                    <button type="button" onClick={() => handleVerificationReview(request.id, 'approved')}>Approve</button>
                    <button type="button" onClick={() => handleVerificationReview(request.id, 'needs_changes')} disabled={(verificationNotes[request.id] || '').trim().length < 3}>Needs changes</button>
                    <button type="button" onClick={() => handleVerificationReview(request.id, 'rejected')} disabled={(verificationNotes[request.id] || '').trim().length < 3}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h2>Pending Media Approval</h2>
        {!pendingPosts.length ? <p>No pending Media posts.</p> : (
          <table className="admin-table">
            <thead><tr><th>Post</th><th>Actor</th><th>Safety state</th><th>Approval reason</th><th>Action</th></tr></thead>
            <tbody>
              {pendingPosts.map((post) => (
                <tr key={post.id}>
                  <td>{post.body?.slice(0, 80)}...</td>
                  <td>@{post.actor_handle}</td>
                  <td>{post.processing_status} / {post.csam_status}</td>
                  <td>
                    <input
                      value={approvalReasons[post.id] || ''}
                      onChange={(event) => setApprovalReasons((current) => ({ ...current, [post.id]: event.target.value }))}
                      placeholder="Why is this safe to publish?"
                    />
                  </td>
                  <td><button type="button" disabled={(approvalReasons[post.id] || '').trim().length < 3} onClick={() => handleApprove(post.id)}>Approve and publish</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="admin-filters">
        {['open', 'dismissed', 'removed', 'dmca'].map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={status === s ? 'active' : ''}
          >
            {s}
          </button>
        ))}
      </div>
      {loading ? <p>Loading...</p> : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Post</th>
              <th>Actor</th>
              <th>Reason</th>
              <th>Note</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {flags.map(f => (
              <tr key={f.id}>
                <td>{f.post_body?.slice(0, 80)}...</td>
                <td>@{f.actor_handle}</td>
                <td>{f.reason}</td>
                <td>{f.note}</td>
                <td>{new Date(f.created_at).toLocaleString()}</td>
                <td>
                  {f.status === 'open' && (
                    <>
                      <button onClick={() => handleReview(f.id, 'dismiss')}>Dismiss</button>
                      <button onClick={() => handleReview(f.id, 'remove')}>Remove</button>
                      <button onClick={() => handleReview(f.id, 'dmca')}>DMCA</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !flags.length && <p>No flags.</p>}
    </div>
  );
}
