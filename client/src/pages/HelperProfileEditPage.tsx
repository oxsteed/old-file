import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import CoverImageUpload from '../components/profile/CoverImageUpload';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import './HelperProfileEditPage.css';

/**
 * Helper Profile Edit Page
 * Shows profile editing interface with cover image upload at the top
 */
export default function HelperProfileEditPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [helperProfile, setHelperProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadHelperProfile();
  }, []);

  const loadHelperProfile = async () => {
    try {
      const response = await fetch('/api/helper-profile');
      if (response.ok) {
        const data = await response.json();
        setHelperProfile(data.data);
      } else {
        setError('Failed to load profile');
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
    <div className="helper-profile-edit-page">
      <div className="page-header">
        <h1>{t('helperDashboard.editProfile')}</h1>
      </div>

      <div className="page-content">
        {/* COVER IMAGE UPLOAD - AT THE TOP */}
        <section className="edit-section">
          <CoverImageUpload
            currentCoverUrl={helperProfile?.coverImageUrl}
            onUploadSuccess={(url) => {
              setHelperProfile(prev => ({
                ...prev,
                coverImageUrl: url
              }));
            }}
            onError={(error) => {
              setError(error);
            }}
          />
        </section>

        {/* Rest of profile editing sections */}
        <Tabs defaultValue="basic" className="profile-tabs">
          <TabsList>
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="availability">Availability</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            {/* Basic info form */}
            <div className="tab-content">
              {/* Your existing basic info form here */}
              <p>Basic information form goes here</p>
            </div>
          </TabsContent>

          <TabsContent value="services">
            {/* Services form */}
            <div className="tab-content">
              {/* Your existing services form here */}
              <p>Services form goes here</p>
            </div>
          </TabsContent>

          <TabsContent value="availability">
            {/* Availability form */}
            <div className="tab-content">
              {/* Your existing availability form here */}
              <p>Availability form goes here</p>
            </div>
          </TabsContent>

          <TabsContent value="billing">
            {/* Billing form */}
            <div className="tab-content">
              {/* Your existing billing form here */}
              <p>Billing form goes here</p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
