import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function MediaFlagsPage() {
  const [flags, setFlags] = useState([]);
  const [pendingPosts, setPendingPosts] = useState([]);
  const [approvalReasons, setApprovalReasons] = useState({});
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
    } catch (err) {
      console.error('Failed to load flags', err);
    } finally {
      setLoading(false);
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
