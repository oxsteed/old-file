import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import CoverImageUpload from '../components/profile/CoverImageUpload';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  getBusinessProfileForEditor,
  listBusinesses,
  listMembers,
  listBusinessServices,
  listInvoices,
  updateBusiness,
  uploadBusinessPhotos,
} from '../api/businesses';
import './BusinessProfileEditPage.css';

/**
 * Business Profile Edit Page
 * Shows business editing interface with cover image upload at the top
 */
export default function BusinessProfileEditPage() {
  const { t } = useTranslation();
  const [business, setBusiness] = useState(null);
  const [form, setForm] = useState({
    business_name: '',
    description: '',
    business_type: '',
    website: '',
    phone: '',
    address_city: '',
    address_state: '',
  });
  const [members, setMembers] = useState([]);
  const [services, setServices] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    void loadBusiness();
  }, []);

  const loadBusiness = async () => {
    try {
      setLoading(true);
      const businesses = await listBusinesses();
      const selected = businesses.find((item) => item.is_primary) || businesses[0];
      if (!selected) {
        setBusiness(null);
        setError(t('businessProfileEdit.noBusiness', { defaultValue: 'Create a business profile first.' }));
        return;
      }

      const detail = await getBusinessProfileForEditor(selected.id);
      const nextBusiness = detail.business || selected;
      setBusiness(nextBusiness);
      setForm({
        business_name: nextBusiness.business_name || '',
        description: nextBusiness.description || '',
        business_type: nextBusiness.business_type || '',
        website: nextBusiness.website || '',
        phone: nextBusiness.phone || '',
        address_city: nextBusiness.address_city || '',
        address_state: nextBusiness.address_state || '',
      });

      const [teamRows, serviceRows, invoiceRows] = await Promise.allSettled([
        listMembers(selected.id),
        listBusinessServices(selected.id),
        listInvoices(selected.id, { limit: 5 }),
      ]);
      setMembers(teamRows.status === 'fulfilled' ? teamRows.value : []);
      setServices(serviceRows.status === 'fulfilled' ? serviceRows.value : []);
      const invoiceData = invoiceRows.status === 'fulfilled' ? invoiceRows.value : {};
      setInvoices(invoiceData.invoices || []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || t('businessProfileEdit.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const patchForm = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async (event) => {
    event.preventDefault();
    if (!business?.id) return;
    if (!form.business_name.trim()) {
      toast.error(t('businessProfileEdit.nameRequired', { defaultValue: 'Business name is required' }));
      return;
    }
    setSaving(true);
    try {
      const updated = await updateBusiness(business.id, {
        business_name: form.business_name.trim(),
        description: form.description.trim() || null,
        business_type: form.business_type.trim() || null,
        website: form.website.trim() || null,
        phone: form.phone.trim() || null,
        address_city: form.address_city.trim() || null,
        address_state: form.address_state.trim() || null,
      });
      setBusiness((prev) => ({ ...prev, ...updated }));
      toast.success(t('businessProfileEdit.saved', { defaultValue: 'Business profile saved' }));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('businessProfileEdit.saveFailed', { defaultValue: 'Could not save business profile' }));
    } finally {
      setSaving(false);
    }
  };

  const uploadBusinessCover = async (file) => {
    const data = await uploadBusinessPhotos(business.id, null, file);
    return data.cover_photo_url || data.business?.cover_photo_url;
  };

  const deleteBusinessCover = async () => {
    const updated = await updateBusiness(business.id, { clear_cover_photo_url: true });
    setBusiness((prev) => ({ ...prev, ...updated, cover_photo_url: null }));
  };

  if (loading) return <div className="page-loading">{t('common.loading')}</div>;
  if (error) return <div className="page-error">{error}</div>;

  return (
    <div className="business-profile-edit-page">
      <div className="page-header">
        <h1>{t('businessHub.editProfile')}</h1>
      </div>

      <div className="page-content">
        {/* COVER IMAGE UPLOAD - AT THE TOP */}
        <section className="edit-section">
          <CoverImageUpload
            currentCoverUrl={business?.cover_photo_url}
            uploadCover={uploadBusinessCover}
            deleteCover={deleteBusinessCover}
            onUploadSuccess={(url) => {
              setBusiness(prev => ({
                ...prev,
                cover_photo_url: url
              }));
            }}
            onError={(error) => {
              setError(error);
            }}
          />
        </section>

        {/* Rest of business editing sections */}
        <Tabs defaultValue="basic" className="business-tabs">
          <TabsList>
            <TabsTrigger value="basic">{t('businessProfileEdit.tabs.basic')}</TabsTrigger>
            <TabsTrigger value="team">{t('businessProfileEdit.tabs.team')}</TabsTrigger>
            <TabsTrigger value="services">{t('businessProfileEdit.tabs.services')}</TabsTrigger>
            <TabsTrigger value="billing">{t('businessProfileEdit.tabs.billing')}</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <form className="tab-content" onSubmit={handleSave}>
              <div className="form-group">
                <label>{t('businessProfileEdit.businessName')}</label>
                <input
                  type="text"
                  value={form.business_name}
                  onChange={(event) => patchForm('business_name', event.target.value)}
                  placeholder={t('businessProfileEdit.businessNamePlaceholder')}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>{t('businessProfileEdit.description')}</label>
                <textarea
                  value={form.description}
                  onChange={(event) => patchForm('description', event.target.value)}
                  placeholder={t('businessProfileEdit.descriptionPlaceholder')}
                  className="form-textarea"
                  rows={5}
                />
              </div>
              <div className="form-group">
                <label>{t('businessProfileEdit.category')}</label>
                <input
                  type="text"
                  value={form.business_type}
                  onChange={(event) => patchForm('business_type', event.target.value)}
                  placeholder={t('businessProfileEdit.categoryPlaceholder')}
                  className="form-input"
                />
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>{t('businessProfileEdit.website', { defaultValue: 'Website' })}</label>
                  <input
                    type="url"
                    value={form.website}
                    onChange={(event) => patchForm('website', event.target.value)}
                    placeholder="https://"
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>{t('businessProfileEdit.phone', { defaultValue: 'Phone' })}</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(event) => patchForm('phone', event.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>{t('businessProfileEdit.city', { defaultValue: 'City' })}</label>
                  <input
                    type="text"
                    value={form.address_city}
                    onChange={(event) => patchForm('address_city', event.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>{t('businessProfileEdit.state', { defaultValue: 'State' })}</label>
                  <input
                    type="text"
                    value={form.address_state}
                    onChange={(event) => patchForm('address_state', event.target.value)}
                    className="form-input"
                  />
                </div>
              </div>
              <button type="submit" className="save-button" disabled={saving}>
                {saving ? t('common.saving', { defaultValue: 'Saving...' }) : t('common.save', { defaultValue: 'Save' })}
              </button>
            </form>
          </TabsContent>

          <TabsContent value="team">
            <div className="tab-content">
              <div className="summary-list">
                {members.length ? members.map((member) => (
                  <div key={member.id || member.user_id || member.email} className="summary-row">
                    <span>{member.name || member.email || member.role}</span>
                    <strong>{member.role || member.status || 'member'}</strong>
                  </div>
                )) : <p>{t('businessProfileEdit.emptyTeam', { defaultValue: 'No team members yet.' })}</p>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="services">
            <div className="tab-content">
              <div className="summary-list">
                {services.length ? services.map((service) => (
                  <div key={service.id || service.name} className="summary-row">
                    <span>{service.name}</span>
                    <strong>{service.price ? `$${service.price}` : service.price_unit || 'listed'}</strong>
                  </div>
                )) : <p>{t('businessProfileEdit.emptyServices', { defaultValue: 'No services listed yet.' })}</p>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="billing">
            <div className="tab-content">
              <div className="summary-list">
                {invoices.length ? invoices.map((invoice) => (
                  <div key={invoice.id} className="summary-row">
                    <span>{invoice.invoice_number || invoice.client_name || invoice.id}</span>
                    <strong>{invoice.status || 'open'}</strong>
                  </div>
                )) : <p>{t('businessProfileEdit.emptyBilling', { defaultValue: 'No invoices yet.' })}</p>}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
