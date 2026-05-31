import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, DollarSign, Calendar, Users } from 'lucide-react';
import '../../styles/BusinessAnalyticsTab.css';

const CHART_COLORS = ['#f97316', '#ea580c', '#d97706', '#b45309'];

export function BusinessAnalyticsTab({ businessId }) {
  const { t } = useTranslation();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState('30d');

  useEffect(() => {
    loadAnalytics();
  }, [businessId, dateRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const response = await api.get(
        `/businesses/${businessId}/analytics`,
        { params: { range: dateRange } }
      );
      setAnalytics(response.data);
    } catch (error) {
      toast.error(t('businessAnalytics.toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="bat-loading">{t('businessAnalytics.loading')}</div>;
  }

  if (!analytics) {
    return (
      <div className="bat-empty">
        <p>{t('businessAnalytics.noData')}</p>
      </div>
    );
  }

  const stats = [
    {
      icon: <DollarSign size={24} />,
      iconClass: 'revenue',
      title: t('businessAnalytics.totalRevenue'),
      value: `$${(analytics.totalRevenue / 100).toFixed(2)}`,
      hasChange: analytics.revenueChange !== undefined && analytics.revenueChange !== null,
      change: analytics.revenueChange,
      meta: null,
    },
    {
      icon: <Calendar size={24} />,
      iconClass: 'appointments',
      title: t('businessAnalytics.appointments'),
      value: analytics.appointmentCount || 0,
      hasChange: false,
      meta: t('businessAnalytics.completedAppointments', { count: analytics.completedAppointments || 0 }),
    },
    {
      icon: <Users size={24} />,
      iconClass: 'customers',
      title: t('businessAnalytics.customers'),
      value: analytics.customerCount || 0,
      hasChange: false,
      meta: t('businessAnalytics.newCustomers', { count: analytics.newCustomers || 0 }),
    },
    {
      icon: <TrendingUp size={24} />,
      iconClass: 'rating',
      title: t('businessAnalytics.rating'),
      value: analytics.averageRating ? analytics.averageRating.toFixed(1) : t('common.na'),
      hasChange: false,
      meta: t('businessAnalytics.reviews', { count: analytics.reviewCount || 0 }),
    },
  ];

  return (
    <div className="bat-container">
      <div className="bat-header">
        <h3>{t('businessAnalytics.title')}</h3>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="bat-date-selector"
        >
          <option value="7d">{t('businessAnalytics.dateRange.7d')}</option>
          <option value="30d">{t('businessAnalytics.dateRange.30d')}</option>
          <option value="90d">{t('businessAnalytics.dateRange.90d')}</option>
          <option value="1y">{t('businessAnalytics.dateRange.1y')}</option>
        </select>
      </div>

      <div className="bat-stats-grid">
        {stats.map((stat) => (
          <div key={stat.title} className="bat-stat-card">
            <div className={`bat-stat-icon ${stat.iconClass}`}>
              {stat.icon}
            </div>
            <div className="bat-stat-content">
              <p className="bat-stat-label">{stat.title}</p>
              <p className="bat-stat-value">{stat.value}</p>
              {stat.hasChange ? (
                <p className={`bat-stat-change ${stat.change >= 0 ? 'positive' : 'negative'}`}>
                  {stat.change >= 0 ? '+' : ''}{stat.change}%
                </p>
              ) : (
                <p className="bat-stat-meta">{stat.meta}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="bat-charts-grid">
        <div className="bat-chart-container">
          <h4>{t('businessAnalytics.revenueTrend')}</h4>
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
          <h4>{t('businessAnalytics.appointmentsByStatus')}</h4>
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
          <h4>{t('businessAnalytics.servicesPerformance')}</h4>
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
        <h4>{t('businessAnalytics.keyInsights')}</h4>
        <div className="bat-insights-grid">
          {analytics.insights && analytics.insights.length > 0 ? (
            analytics.insights.map((insight, idx) => (
              <div key={idx} className={`bat-insight ${insight.type}`}>
                <p className="bat-insight-text">{insight.message}</p>
              </div>
            ))
          ) : (
            <p className="bat-no-insights">{t('businessAnalytics.noInsights')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
