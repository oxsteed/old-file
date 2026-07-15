import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { TrendingUp, Eye, Heart, BarChart3, DollarSign, Star, Wrench, Camera, ShieldCheck, Receipt, RefreshCw } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { formatDate, formatMoney } from '../lib/format';
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
      <PageShell>
        <div className="analytics-container analytics-page-shell">
          <div className="analytics-skeleton">Loading analytics...</div>
        </div>
      </PageShell>
    );
  }

  if (!data || data.tools.length === 0) {
    return (
      <PageShell>
        <PageMeta
          title={t('toolRentals.analytics')}
          description="Track tool-rental demand, bookings, completed rentals, and revenue."
        />
        <div className="analytics-container analytics-page-shell">
          <header className="analytics-hero">
            <div>
              <p className="analytics-kicker">Tool rental business</p>
              <h1>{t('toolRentals.analyticsDashboard') || 'Tool Rentals Analytics'}</h1>
              <p>
                See how your tools turn into attention, bookings, completed rentals, and revenue.
                Once you list equipment, this page becomes the command center for pricing and demand.
              </p>
            </div>
          </header>

          <div className="analytics-empty-v2">
            <div className="analytics-empty-main">
              <div className="analytics-empty-icon"><Wrench size={34} /></div>
              <p className="analytics-kicker">No tools listed yet</p>
              <h2>Your analytics dashboard is ready before your first rental.</h2>
              <p>
                List a tool with clear photos, daily pricing, deposit rules, and pickup instructions.
                OxSteed will start tracking views, favorites, booking interest, completed rentals, and revenue here.
              </p>
              <div className="analytics-empty-actions">
                <Link to="/dashboard?tab=skills" className="analytics-btn-primary">List a tool</Link>
                <button onClick={() => navigate('/tool-rentals')} className="analytics-btn-secondary">
                  Browse tool marketplace
                </button>
                <Link to="/features#tool-rentals" className="analytics-btn-secondary">Learn how rentals connect</Link>
              </div>
            </div>
            <div className="analytics-empty-side">
              <h3>What to optimize first</h3>
              <ul>
                <li><Camera size={16} /> Add real photos that show size, condition, and accessories.</li>
                <li><DollarSign size={16} /> Set a daily rate that makes renting easier than buying.</li>
                <li><ShieldCheck size={16} /> Use deposits and terms for expensive or high-risk equipment.</li>
                <li><Receipt size={16} /> Send invoices and keep payment history connected to bookings.</li>
              </ul>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  // Calculate conversion metrics
  const clickThruRate = data.totalViews > 0 ? ((data.totalBookings / data.totalViews) * 100).toFixed(1) : 0;
  const completionRate = data.totalBookings > 0 ? ((data.completedBookings / data.totalBookings) * 100).toFixed(1) : 0;

  return (
    <PageShell>
      <div className="analytics-container analytics-page-shell">
        <PageMeta
          title={t('toolRentals.analytics')}
          description="Track tool-rental demand, bookings, completed rentals, and revenue."
        />

        <div className="analytics-header analytics-header-v2">
          <div>
            <p className="analytics-kicker">Tool rental business</p>
            <h1>{t('toolRentals.analyticsDashboard') || 'Tool Rentals Analytics'}</h1>
            <p>Understand demand, conversion, revenue, and which tools deserve better photos, pricing, or promotion.</p>
          </div>
          <div className="analytics-header-actions">
            <Link to="/dashboard?tab=skills" className="analytics-btn-secondary">Manage listings</Link>
            <button onClick={loadDashboard} className="analytics-refresh-btn">
              <RefreshCw size={16} />
              {t('common.refresh') || 'Refresh'}
            </button>
          </div>
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
                  {formatDate(month.month, { month: 'short', year: '2-digit', day: undefined })}
                </div>
                <div className="analytics-bar-value">{formatMoney(month.revenue, { maximumFractionDigits: 0 })}</div>
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
    </PageShell>
  );
};

export default ToolRentalsAnalytics;
