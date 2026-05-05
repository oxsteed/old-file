import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import CoverImageUpload from '../components/profile/CoverImageUpload';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import './BusinessProfileEditPage.css';

/**
 * Business Profile Edit Page
 * Shows business editing interface with cover image upload at the top
 */
export default function BusinessProfileEditPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadBusiness();
  }, []);

  const loadBusiness = async () => {
    try {
      const response = await fetch('/api/businesses/me');
      if (response.ok) {
        const data = await response.json();
        setBusiness(data.data);
      } else {
        setError('Failed to load business');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="page-loading">Loading...</div>;
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
            currentCoverUrl={business?.coverImageUrl}
            onUploadSuccess={(url) => {
              setBusiness(prev => ({
                ...prev,
                coverImageUrl: url
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
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="team">Team Members</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            {/* Basic business info form */}
            <div className="tab-content">
              <div className="form-group">
                <label>Business Name</label>
                <input
                  type="text"
                  defaultValue={business?.businessName}
                  placeholder="Your business name"
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  defaultValue={business?.description}
                  placeholder="Describe your business"
                  className="form-textarea"
                  rows={5}
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <input
                  type="text"
                  defaultValue={business?.category}
                  placeholder="Business category"
                  className="form-input"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="team">
            {/* Team members management */}
            <div className="tab-content">
              <p>Team members form goes here</p>
            </div>
          </TabsContent>

          <TabsContent value="services">
            {/* Services listing */}
            <div className="tab-content">
              <p>Services form goes here</p>
            </div>
          </TabsContent>

          <TabsContent value="billing">
            {/* Billing settings */}
            <div className="tab-content">
              <p>Billing form goes here</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
