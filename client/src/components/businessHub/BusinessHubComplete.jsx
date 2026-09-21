import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { getBusiness } from '../../api/businesses';
import toast from 'react-hot-toast';
import { BarChart3, Settings, Users, TrendingUp, DollarSign, Package, MessageSquare, ShoppingCart } from 'lucide-react';
import { BusinessServicesTab } from './BusinessServicesTab';
import { PricingRulesManager } from './PricingRulesManager';
import { BusinessAnalyticsTab } from './BusinessAnalyticsTab';
import { CustomerLoyaltyManager } from './CustomerLoyaltyManager';
import { BusinessIntegrations } from './BusinessIntegrations';
import { AppointmentCalendarView } from './AppointmentCalendarView';
import { BusinessProcurementTab } from './BusinessProcurementTab';
import '../../styles/BusinessHubComplete.css';

export function BusinessHubComplete({ businessId }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [activeTab, setActiveTab] = useState(
    initialTab,
  );
  const [businessData, setBusinessData] = useState(null);
  const [loading, setLoading] = useState(false);

  const tabs = [
    { id: 'overview',     name: t('businessHubComplete.tabs.overview'),    icon: BarChart3 },
    { id: 'services',     name: t('businessHubComplete.tabs.services'),    icon: Package },
    { id: 'appointments', name: t('businessHubComplete.tabs.appointments'),icon: MessageSquare },
    { id: 'pricing',      name: t('businessHubComplete.tabs.pricingRules'),icon: DollarSign },
    { id: 'analytics',    name: t('businessHubComplete.tabs.analytics'),   icon: TrendingUp },
    { id: 'loyalty',      name: t('businessHubComplete.tabs.loyalty'),     icon: Users },
    { id: 'integrations', name: t('businessHubComplete.tabs.integrations'),icon: Settings },
    { id: 'procurement',  name: t('businessHubComplete.tabs.procurement'), icon: ShoppingCart },
  ];

  useEffect(() => {
    setActiveTab(tabs.some(t => t.id === initialTab) ? initialTab : 'overview');
  }, [initialTab, tabs]);

  useEffect(() => {
    loadBusinessData();
  }, [businessId]);

  const loadBusinessData = async () => {
    try {
      setLoading(true);
      const data = await getBusiness(businessId);
      setBusinessData(data.business || data);
    } catch (error) {
      toast.error(t('businessHubComplete.loadError'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="bhc-loading">{t('businessHubComplete.loading')}</div>;
  }

  if (!businessData) {
    return <div className="bhc-error">{t('businessHubComplete.notFound')}</div>;
  }

  const businessName = businessData.business_name || t('businessHubComplete.headerFallbackName');
  const businessCategory = businessData.category || t('businessHubComplete.headerFallbackCategory');

  return (
    <div className="bhc-container">
      <div className="bhc-header">
        <div className="bhc-header-content">
          <h1>{businessName}</h1>
          <p className="bhc-subtitle">{businessCategory}</p>
        </div>
      </div>

      <div className="bhc-nav-tabs">
        {tabs.map(tab => {
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
                <h3>{t('businessHubComplete.overview.title')}</h3>
                <div className="bhc-stat-row">
                  <span>{t('businessHubComplete.overview.servicesLabel')}</span>
                  <strong>{businessData.services_count || 0}</strong>
                </div>
                <div className="bhc-stat-row">
                  <span>{t('businessHubComplete.overview.ratingLabel')}</span>
                  <strong>{businessData.rating || t('businessHubComplete.overview.na')}</strong>
                </div>
                <div className="bhc-stat-row">
                  <span>{t('businessHubComplete.overview.appointmentsLabel')}</span>
                  <strong>{businessData.appointment_count || 0}</strong>
                </div>
              </div>

              <div className="bhc-overview-card">
                <h3>{t('businessHubComplete.overview.businessInfo')}</h3>
                <div className="bhc-info-row">
                  <span>{t('businessHubComplete.overview.locationLabel')}</span>
                  <span>{businessData.location_city}, {businessData.location_state}</span>
                </div>
                <div className="bhc-info-row">
                  <span>{t('businessHubComplete.overview.phoneLabel')}</span>
                  <span>{businessData.phone || t('businessHubComplete.overview.notSet')}</span>
                </div>
                <div className="bhc-info-row">
                  <span>{t('businessHubComplete.overview.statusLabel')}</span>
                  <span className={`bhc-status ${businessData.is_active ? 'active' : 'inactive'}`}>
                    {businessData.is_active
                      ? t('businessHubComplete.overview.statusActive')
                      : t('businessHubComplete.overview.statusInactive')}
                  </span>
                </div>
              </div>

              <div className="bhc-overview-card">
                <h3>{t('businessHubComplete.overview.recentActivity')}</h3>
                <p className="bhc-no-data">
                  {businessData.last_appointment_at
                    ? t('businessHubComplete.overview.lastAppointment', {
                      date: new Date(businessData.last_appointment_at).toLocaleDateString(),
                    })
                    : t('businessHubComplete.overview.noAppointments')}
                </p>
                <p className="bhc-no-data">
                  {t('businessHubComplete.overview.memberSince', {
                    date: new Date(businessData.created_at).toLocaleDateString(),
                  })}
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

        {activeTab === 'procurement' && <BusinessProcurementTab businessId={businessId} />}
      </div>
    </div>
  );
}
