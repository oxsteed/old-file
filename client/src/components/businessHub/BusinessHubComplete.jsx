import React, { useState, useEffect } from 'react';
import { axiosInstance } from '../../api/axios';
import toast from 'react-hot-toast';
import { BarChart3, Settings, Users, TrendingUp, DollarSign, Package, MessageSquare } from 'lucide-react';
import { BusinessServicesTab } from './BusinessServicesTab';
import { PricingRulesManager } from './PricingRulesManager';
import { BusinessAnalyticsTab } from './BusinessAnalyticsTab';
import { CustomerLoyaltyManager } from './CustomerLoyaltyManager';
import { BusinessIntegrations } from './BusinessIntegrations';
import { AppointmentCalendarView } from './AppointmentCalendarView';
import '../../styles/BusinessHubComplete.css';

const TABS = [
  { id: 'overview', name: 'Overview', icon: BarChart3 },
  { id: 'services', name: 'Services', icon: Package },
  { id: 'appointments', name: 'Appointments', icon: MessageSquare },
  { id: 'pricing', name: 'Pricing Rules', icon: DollarSign },
  { id: 'analytics', name: 'Analytics', icon: TrendingUp },
  { id: 'loyalty', name: 'Loyalty', icon: Users },
  { id: 'integrations', name: 'Integrations', icon: Settings }
];

export function BusinessHubComplete({ businessId }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [businessData, setBusinessData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBusinessData();
  }, [businessId]);

  const loadBusinessData = async () => {
    try {
      setLoading(true);
      const response = await axiosInstance.get(`/api/businesses/${businessId}`);
      setBusinessData(response.data);
    } catch (error) {
      toast.error('Failed to load business data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="bhc-loading">Loading business hub...</div>;
  }

  if (!businessData) {
    return <div className="bhc-error">Failed to load business data</div>;
  }

  return (
    <div className="bhc-container">
      <div className="bhc-header">
        <div className="bhc-header-content">
          <h1>{businessData.business_name || 'Business Hub'}</h1>
          <p className="bhc-subtitle">{businessData.category || 'Service Business'}</p>
        </div>
      </div>

      <div className="bhc-nav-tabs">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`bhc-tab ${activeTab === tab.id ? 'active' : ''}`}
              title={tab.name}
            >
              <Icon size={18} />
              <span className="bhc-tab-name">{tab.name}</span>
            </button>
          );
        })}
      </div>

      <div className="bhc-content">
        {activeTab === 'overview' && (
          <div className="bhc-overview-tab">
            <div className="bhc-overview-grid">
              <div className="bhc-overview-card">
                <h3>Quick Stats</h3>
                <div className="bhc-stat-row">
                  <span>Services:</span>
                  <strong>{businessData.services_count || 0}</strong>
                </div>
                <div className="bhc-stat-row">
                  <span>Rating:</span>
                  <strong>{businessData.rating || 'N/A'}</strong>
                </div>
                <div className="bhc-stat-row">
                  <span>Appointments:</span>
                  <strong>{businessData.appointment_count || 0}</strong>
                </div>
              </div>

              <div className="bhc-overview-card">
                <h3>Business Info</h3>
                <div className="bhc-info-row">
                  <span>Location:</span>
                  <span>{businessData.location_city}, {businessData.location_state}</span>
                </div>
                <div className="bhc-info-row">
                  <span>Phone:</span>
                  <span>{businessData.phone || 'Not set'}</span>
                </div>
                <div className="bhc-info-row">
                  <span>Status:</span>
                  <span className={`bhc-status ${businessData.is_active ? 'active' : 'inactive'}`}>
                    {businessData.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="bhc-overview-card">
                <h3>Recent Activity</h3>
                <p className="bhc-no-data">
                  Last appointment: {businessData.last_appointment_at
                    ? new Date(businessData.last_appointment_at).toLocaleDateString()
                    : 'No appointments yet'}
                </p>
                <p className="bhc-no-data">
                  Member since: {new Date(businessData.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'services' && <BusinessServicesTab businessId={businessId} />}

        {activeTab === 'appointments' && <AppointmentCalendarView businessId={businessId} />}

        {activeTab === 'pricing' && <PricingRulesManager businessId={businessId} />}

        {activeTab === 'analytics' && <BusinessAnalyticsTab businessId={businessId} />}

        {activeTab === 'loyalty' && <CustomerLoyaltyManager businessId={businessId} />}

        {activeTab === 'integrations' && <BusinessIntegrations businessId={businessId} />}
      </div>
    </div>
  );
}
