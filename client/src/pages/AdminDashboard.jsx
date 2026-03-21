import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import './AdminDashboard.css';

const AdminDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [moderationItems, setModerationItems] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userFilters, setUserFilters] = useState({ role: '', tier: '', status: '', search: '' });

  useEffect(() => {
    fetchDashboardData();
  }, [activeTab]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'overview') {
        const { data } = await api.get('/api/admin/dashboard');
        setStats(data);
      } else if (activeTab === 'users') {
        const params = new URLSearchParams();
        Object.entries(userFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
        const { data } = await api.get(`/api/admin/users?${params}`);
        setUsers(data.users);
      } else if (activeTab === 'moderation') {
        const { data } = await api.get('/api/admin/moderation');
        setModerationItems(data.items);
      } else if (activeTab === 'markets') {
        const { data } = await api.get('/api/admin/markets');
        setMarkets(data.markets);
      } else if (activeTab === 'activity') {
        const { data } = await api.get('/api/admin/activity-log');
        setActivityLog(data.logs);
      }
    } catch (err) {
      console.error('Failed to fetch admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivateUser = async (userId) => {
    const reason = prompt('Reason for deactivation:');
    if (!reason) return;
    try {
      await api.put(`/api/admin/users/${userId}/deactivate`, { reason });
      fetchDashboardData();
    } catch (err) {
      alert('Failed to deactivate user.');
    }
  };

  const handleReactivateUser = async (userId) => {
    try {
      await api.put(`/api/admin/users/${userId}/reactivate`);
      fetchDashboardData();
    } catch (err) {
      alert('Failed to reactivate user.');
    }
  };

  const handleResolveMod = async (itemId, action) => {
    const resolution = prompt('Resolution notes:');
    if (!resolution) return;
    try {
      await api.put(`/api/admin/moderation/${itemId}/resolve`, { resolution, action });
      fetchDashboardData();
    } catch (err) {
      alert('Failed to resolve item.');
    }
  };

  const handleDismissMod = async (itemId) => {
    try {
      await api.put(`/api/admin/moderation/${itemId}/dismiss`, { reason: 'No action needed' });
      fetchDashboardData();
    } catch (err) {
      alert('Failed to dismiss item.');
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'moderation', label: 'Moderation' },
    { id: 'markets', label: 'Markets' },
    { id: 'activity', label: 'Activity Log' },
  ];

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <span className="admin-badge">{user?.admin_role}</span>
      </div>

      <nav className="admin-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === 'moderation' && moderationItems.length > 0 && (
              <span className="badge-count">{moderationItems.length}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="admin-content">
        {loading ? (
          <div className="admin-loading">Loading...</div>
        ) : (
          <>
            {activeTab === 'overview' && stats && (
              <div className="stats-grid">
                <div className="stat-card">
                  <h3>Users</h3>
                  <div className="stat-value">{stats.users.total_users}</div>
                  <div className="stat-details">
                    <span>{stats.users.total_helpers} helpers</span>
                    <span>{stats.users.total_customers} customers</span>
                    <span>+{stats.users.new_users_30d} (30d)</span>
                  </div>
                </div>
                <div className="stat-card">
                  <h3>Subscriptions</h3>
                  <div className="stat-value">{stats.users.active_subscribers}</div>
                  <div className="stat-details">
                    <span>{stats.users.basic_tier} Basic</span>
                    <span>{stats.users.pro_tier} Pro</span>
                  </div>
                </div>
                <div className="stat-card">
                  <h3>Jobs</h3>
                  <div className="stat-value">{stats.jobs.total_jobs}</div>
                  <div className="stat-details">
                    <span>{stats.jobs.active_jobs} active</span>
                    <span>{stats.jobs.completed_jobs} completed</span>
                    <span>Avg ${Number(stats.jobs.avg_job_value).toFixed(0)}</span>
                  </div>
                </div>
                <div className="stat-card">
                  <h3>Revenue (30d)</h3>
                  <div className="stat-value">${Number(stats.revenue.total_revenue).toFixed(2)}</div>
                  <div className="stat-details">
                    <span>Subs: ${Number(stats.revenue.subscription_revenue).toFixed(0)}</span>
                    <span>Fees: ${Number(stats.revenue.job_fee_revenue).toFixed(0)}</span>
                  </div>
                </div>
                <div className="stat-card alert">
                  <h3>Moderation Queue</h3>
                  <div className="stat-value">{stats.moderation.pending}</div>
                  <span>pending items</span>
                </div>
                <div className="stat-card alert">
                  <h3>Open Disputes</h3>
                  <div className="stat-value">{stats.disputes.open_disputes}</div>
                  <span>need attention</span>
                </div>
              </div>
            )}

            {activeTab === 'users' && (
              <div className="users-section">
                <div className="user-filters">
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={userFilters.search}
                    onChange={e => setUserFilters(f => ({ ...f, search: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && fetchDashboardData()}
                  />
                  <select value={userFilters.role} onChange={e => setUserFilters(f => ({ ...f, role: e.target.value }))}>
                    <option value="">All Roles</option>
                    <option value="customer">Customer</option>
                    <option value="helper">Helper</option>
                    <option value="both">Both</option>
                  </select>
                  <select value={userFilters.tier} onChange={e => setUserFilters(f => ({ ...f, tier: e.target.value }))}>
                    <option value="">All Tiers</option>
                    <option value="tier1">Tier 1</option>
                    <option value="tier2basic">Basic</option>
                    <option value="tier2pro">Pro</option>
                  </select>
                  <button onClick={fetchDashboardData}>Search</button>
                </div>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Name</th><th>Email</th><th>Role</th><th>Tier</th>
                      <th>Score</th><th>Jobs</th><th>Status</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td>{u.first_name} {u.last_name}</td>
                        <td>{u.email}</td>
                        <td>{u.role}</td>
                        <td>{u.tier}</td>
                        <td>{u.community_score}</td>
                        <td>{u.jobs_completed}</td>
                        <td>{u.deactivated_at ? 'Deactivated' : 'Active'}</td>
                        <td>
                          {u.deactivated_at ? (
                            <button className="btn-sm" onClick={() => handleReactivateUser(u.id)}>Reactivate</button>
                          ) : (
                            <button className="btn-sm btn-danger" onClick={() => handleDeactivateUser(u.id)}>Deactivate</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'moderation' && (
              <div className="moderation-section">
                {moderationItems.length === 0 ? (
                  <p className="empty-state">No pending moderation items.</p>
                ) : (
                  moderationItems.map(item => (
                    <div key={item.id} className={`mod-card priority-${item.priority}`}>
                      <div className="mod-header">
                        <span className="mod-type">{item.type}</span>
                        <span className="mod-priority">{item.priority}</span>
                        <span className="mod-date">{new Date(item.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="mod-reason">{item.reason}</p>
                      <p className="mod-reporter">Reported by: {item.reporter_name}</p>
                      <div className="mod-actions">
                        <button onClick={() => handleResolveMod(item.id, 'remove_review')}>Remove Content</button>
                        <button onClick={() => handleResolveMod(item.id, 'warn_user')}>Warn User</button>
                        <button className="btn-secondary" onClick={() => handleDismissMod(item.id)}>Dismiss</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'markets' && (
              <div className="markets-section">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Market</th><th>State</th><th>Users</th><th>Jobs</th>
                      <th>Active</th><th>Launched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {markets.map(m => (
                      <tr key={m.id}>
                        <td>{m.name}</td>
                        <td>{m.state}</td>
                        <td>{m.user_count}</td>
                        <td>{m.job_count}</td>
                        <td>{m.active ? 'Yes' : 'No'}</td>
                        <td>{m.launched_at ? new Date(m.launched_at).toLocaleDateString() : 'Not launched'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'activity' && (
              <div className="activity-section">
                <table className="admin-table">
                  <thead>
                    <tr><th>Admin</th><th>Action</th><th>Target</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {activityLog.map(log => (
                      <tr key={log.id}>
                        <td>{log.admin_name}</td>
                        <td>{log.action}</td>
                        <td>{log.target_type} #{log.target_id}</td>
                        <td>{new Date(log.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
