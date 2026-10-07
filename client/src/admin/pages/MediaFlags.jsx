import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function MediaFlagsPage() {
  const [flags, setFlags] = useState([]);
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/admin/media/flags', { params: { status } });
      setFlags(data.flags);
    } catch (err) {
      console.error('Failed to load flags', err);
    } finally {
      setLoading(false);
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
