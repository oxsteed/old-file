import React, { useState, useEffect } from 'react';
import { axiosInstance } from '../../api/axios';
import toast from 'react-hot-toast';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, DollarSign, Calendar, Users } from 'lucide-react';
import '../../styles/BusinessAnalyticsTab.css';

const CHART_COLORS = ['#f97316', '#ea580c', '#d97706', '#b45309'];

export function BusinessAnalyticsTab({ businessId }) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState('30d');
  const [activeMetric, setActiveMetric] = useState('revenue');

  useEffect(() => {
    loadAnalytics();
  }, [businessId, dateRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const response = await axiosInstance.get(
        `/api/businesses/${businessId}/analytics`,
        { params: { range: dateRange } }
      );
      setAnalytics(response.data);
    } catch (error) {
      toast.error('Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="bat-loading">Loading analytics...</div>;
  }

  if (!analytics) {
    return (
      <div className="bat-empty">
        <p>No analytics data available yet</p>
      </div>
    );
  }

  return (
    <div className="bat-container">
      <div className="bat-header">
        <h3>Business Analytics</h3>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="bat-date-selector"
        >
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="90d">Last 90 Days</option>
          <option value="1y">Last Year</option>
        </select>
      </div>

      <div className="bat-stats-grid">
        <div className="bat-stat-card">
          <div className="bat-stat-icon revenue">
            <DollarSign size={24} />
          </div>
          <div className="bat-stat-content">
            <p className="bat-stat-label">Total Revenue</p>
            <p className="bat-stat-value">${(analytics.totalRevenue / 100).toFixed(2)}</p>
            {analytics.revenueChange && (
              <p className={`bat-stat-change ${analytics.revenueChange >= 0 ? 'positive' : 'negative'}`}>
                {analytics.revenueChange >= 0 ? '+' : ''}{analytics.revenueChange}%
              </p>
            )}
          </div>
        </div>

        <div className="bat-stat-card">
          <div className="bat-stat-icon appointments">
            <Calendar size={24} />
          </div>
          <div className="bat-stat-content">
            <p className="bat-stat-label">Appointments</p>
            <p className="bat-stat-value">{analytics.appointmentCount || 0}</p>
            <p className="bat-stat-meta">
              {analytics.completedAppointments || 0} completed
            </p>
          </div>
        </div>

        <div className="bat-stat-card">
          <div className="bat-stat-icon customers">
            <Users size={24} />
          </div>
          <div className="bat-stat-content">
            <p className="bat-stat-label">Customers</p>
            <p className="bat-stat-value">{analytics.customerCount || 0}</p>
            <p className="bat-stat-meta">
              {analytics.newCustomers || 0} new this period
            </p>
          </div>
        </div>

        <div className="bat-stat-card">
          <div className="bat-stat-icon rating">
            <TrendingUp size={24} />
          </div>
          <div className="bat-stat-content">
            <p className="bat-stat-label">Rating</p>
            <p className="bat-stat-value">
              {analytics.averageRating ? analytics.averageRating.toFixed(1) : 'N/A'}
            </p>
            <p className="bat-stat-meta">
              {analytics.reviewCount || 0} reviews
            </p>
          </div>
        </div>
      </div>

      <div className="bat-charts-grid">
        <div className="bat-chart-container">
          <h4>Revenue Trend</h4>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analytics.revenueTrend || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="date" stroke="var(--muted-text)" />
              <YAxis stroke="var(--muted-text)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--app-text)'
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bat-chart-container">
          <h4>Appointments by Status</h4>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={analytics.appointmentsByStatus || []}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value}`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="count"
              >
                {(analytics.appointmentsByStatus || []).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bat-chart-container full-width">
          <h4>Services Performance</h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analytics.serviceMetrics || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="serviceName" stroke="var(--muted-text)" />
              <YAxis stroke="var(--muted-text)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--app-text)'
                }}
              />
              <Legend />
              <Bar dataKey="bookings" fill="#f97316" />
              <Bar dataKey="revenue" fill="#ea580c" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bat-insights-section">
        <h4>Key Insights</h4>
        <div className="bat-insights-grid">
          {analytics.insights && analytics.insights.length > 0 ? (
            analytics.insights.map((insight, idx) => (
              <div key={idx} className={`bat-insight ${insight.type}`}>
                <p className="bat-insight-text">{insight.message}</p>
              </div>
            ))
          ) : (
            <p className="bat-no-insights">No insights available yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
