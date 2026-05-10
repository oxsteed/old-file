import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Eye, Heart, BarChart3, DollarSign, Star } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import api from '../api/axios';
import toast from 'react-hot-toast';
import './ToolRentalsAnalytics.css';

interface ToolMetric {
  id: number;
  name: string;
  views: number;
  favorites: number;
  inquiries: number;
  completed_bookings: number;
  total_revenue: number;
  avg_rating: number;
}

interface MonthlyRevenue {
  month: string;
  revenue: number;
  bookings: number;
}

interface DashboardData {
  tools: Array<{ id: number; name: string; daily_rate: number }>;
  totalViews: number;
  totalFavorites: number;
  totalBookings: number;
  completedBookings: number;
  totalRevenue: number;
  monthlyRevenue: MonthlyRevenue[];
  toolMetrics: ToolMetric[];
}

const ToolRentalsAnalytics: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const { data: analyticsData } = await api.get('/tool-rentals/analytics/dashboard');
      setData(analyticsData);
    } catch (err) {
      toast.error(t('toolRentals.analyticsLoadError') || 'Failed to load analytics');
      console.error('Analytics load error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="analytics-container">
        <div className="analytics-skeleton">Loading analytics...</div>
      </div>
    );
  }

  if (!data || data.tools.length === 0) {
    return (
      <div className="analytics-container">
        <PageMeta title={t('toolRentals.analytics')} />
        <div className="analytics-empty">
          <h2>{t('toolRentals.noTools') || 'No Tools Listed'}</h2>
          <p>{t('toolRentals.analyticsEmptyMessage') || 'Create your first tool listing to see analytics.'}</p>
          <button onClick={() => navigate('/tool-rentals')} className="analytics-btn-primary">
            {t('toolRentals.browseTool') || 'Browse Tools'}
          </button>
        </div>
      </div>
    );
  }

  // Calculate conversion metrics
  const clickThruRate = data.totalViews > 0 ? ((data.totalBookings / data.totalViews) * 100).toFixed(1) : 0;
  const completionRate = data.totalBookings > 0 ? ((data.completedBookings / data.totalBookings) * 100).toFixed(1) : 0;

  return (
    <div className="analytics-container">
      <PageMeta title={t('toolRentals.analytics')} />

      <div className="analytics-header">
        <h1>{t('toolRentals.analyticsDashboard') || 'Tool Rentals Analytics'}</h1>
        <button onClick={loadDashboard} className="analytics-refresh-btn">
          {t('common.refresh') || 'Refresh'}
        </button>
      </div>

      {/* Key Metrics */}
      <div className="analytics-metrics-grid">
        <div className="analytics-metric-card">
          <div className="analytics-metric-icon views">
            <Eye className="w-6 h-6" />
          </div>
          <div className="analytics-metric-content">
            <div className="analytics-metric-label">{t('toolRentals.totalViews') || 'Total Views'}</div>
            <div className="analytics-metric-value">{data.totalViews.toLocaleString()}</div>
          </div>
        </div>

        <div className="analytics-metric-card">
          <div className="analytics-metric-icon favorites">
            <Heart className="w-6 h-6" />
          </div>
          <div className="analytics-metric-content">
            <div className="analytics-metric-label">{t('toolRentals.totalFavorites') || 'Total Favorites'}</div>
            <div className="analytics-metric-value">{data.totalFavorites.toLocaleString()}</div>
          </div>
        </div>

        <div className="analytics-metric-card">
          <div className="analytics-metric-icon bookings">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div className="analytics-metric-content">
            <div className="analytics-metric-label">{t('toolRentals.totalBookings') || 'Total Bookings'}</div>
            <div className="analytics-metric-value">{data.totalBookings.toLocaleString()}</div>
            <div className="analytics-metric-subtext">
              {data.completedBookings} {t('toolRentals.completed') || 'completed'}
            </div>
          </div>
        </div>

        <div className="analytics-metric-card">
          <div className="analytics-metric-icon revenue">
            <DollarSign className="w-6 h-6" />
          </div>
          <div className="analytics-metric-content">
            <div className="analytics-metric-label">{t('toolRentals.totalRevenue') || 'Total Revenue'}</div>
            <div className="analytics-metric-value">${data.totalRevenue.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="analytics-performance">
        <h2>{t('toolRentals.performanceMetrics') || 'Performance Metrics'}</h2>
        <div className="analytics-performance-grid">
          <div className="analytics-performance-card">
            <div className="analytics-performance-label">{t('toolRentals.clickThruRate') || 'Click-Through Rate'}</div>
            <div className="analytics-performance-value">{clickThruRate}%</div>
            <div className="analytics-performance-desc">
              {t('toolRentals.clickThruDesc') || 'Bookings ÷ Views'}
            </div>
          </div>
          <div className="analytics-performance-card">
            <div className="analytics-performance-label">{t('toolRentals.completionRate') || 'Completion Rate'}</div>
            <div className="analytics-performance-value">{completionRate}%</div>
            <div className="analytics-performance-desc">
              {t('toolRentals.completionDesc') || 'Completed ÷ Bookings'}
            </div>
          </div>
          <div className="analytics-performance-card">
            <div className="analytics-performance-label">{t('toolRentals.avgRating') || 'Avg Rating'}</div>
            <div className="analytics-performance-value">
              {data.toolMetrics.length > 0
                ? (data.toolMetrics.reduce((sum, t) => sum + t.avg_rating, 0) / data.toolMetrics.length).toFixed(1)
                : 'N/A'}
            </div>
            <div className="analytics-performance-desc">
              <Star className="w-4 h-4 inline" /> {t('toolRentals.fromReviews') || 'from reviews'}
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Revenue Chart */}
      {data.monthlyRevenue.length > 0 && (
        <div className="analytics-chart">
          <h2>{t('toolRentals.revenueOverTime') || 'Revenue Over Time'}</h2>
          <div className="analytics-bar-chart">
            {data.monthlyRevenue.map((month, idx) => (
              <div key={idx} className="analytics-bar-item">
                <div className="analytics-bar-wrapper">
                  <div
                    className="analytics-bar"
                    style={{
                      height: `${(month.revenue / Math.max(...data.monthlyRevenue.map(m => m.revenue), 1)) * 180}px`
                    }}
                  />
                </div>
                <div className="analytics-bar-label">
                  {new Date(month.month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                </div>
                <div className="analytics-bar-value">${month.revenue.toFixed(0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tool Performance Table */}
      <div className="analytics-tools-table">
        <h2>{t('toolRentals.toolPerformance') || 'Tool Performance'}</h2>
        <div className="analytics-table-wrapper">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>{t('toolRentals.toolName') || 'Tool Name'}</th>
                <th>{t('toolRentals.views') || 'Views'}</th>
                <th>{t('toolRentals.favorites') || 'Favorites'}</th>
                <th>{t('toolRentals.inquiries') || 'Inquiries'}</th>
                <th>{t('toolRentals.completed') || 'Completed'}</th>
                <th>{t('toolRentals.revenue') || 'Revenue'}</th>
                <th>{t('toolRentals.rating') || 'Rating'}</th>
              </tr>
            </thead>
            <tbody>
              {data.toolMetrics.map(tool => (
                <tr key={tool.id}>
                  <td className="analytics-table-name">{tool.name}</td>
                  <td>{tool.views.toLocaleString()}</td>
                  <td>{tool.favorites.toLocaleString()}</td>
                  <td>{tool.inquiries.toLocaleString()}</td>
                  <td>{tool.completed_bookings}</td>
                  <td>${tool.total_revenue.toFixed(2)}</td>
                  <td>
                    {tool.avg_rating > 0 ? (
                      <span className="analytics-rating">
                        <Star className="w-4 h-4" />
                        {tool.avg_rating.toFixed(1)}
                      </span>
                    ) : (
                      'N/A'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ToolRentalsAnalytics;
