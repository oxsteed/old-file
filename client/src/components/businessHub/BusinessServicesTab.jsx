import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Edit2, Trash2, Plus, Clock, DollarSign } from 'lucide-react';
import '../../styles/BusinessServicesTab.css';

// Helper: normalise a service row regardless of DB schema version
function normaliseService(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    id: s.id,
    name: s.name || '',
    description: s.description || '',
    category: s.category || '',
    // new schema uses duration_minutes; old schema uses duration (in minutes)
    duration_minutes: s.duration_minutes ?? s.duration ?? 60,
    // new schema uses base_price_cents; old schema uses price (float dollars)
    base_price_cents: s.base_price_cents ?? (s.price != null ? Math.round(parseFloat(s.price) * 100) : 0),
    max_capacity: s.max_capacity ?? 1,
    min_notice_hours: s.min_notice_hours ?? 24,
    cancellation_policy_hours: s.cancellation_policy_hours ?? 24,
    is_active: s.is_active !== false, // default true if missing
    staff_count: s.staff_count ?? 0,
  };
}

export function BusinessServicesTab({ businessId }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    duration_minutes: 60,
    base_price_cents: 0,
    max_capacity: 1,
    min_notice_hours: 24,
    cancellation_policy_hours: 24
  });

  useEffect(() => {
    loadServices();
  }, [businessId]);

  const loadServices = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/api/businesses/${businessId}/services`, { params: { all: 'true' } });
      const raw = Array.isArray(response.data)
        ? response.data
        : (Array.isArray(response.data?.services) ? response.data.services : []);
      setServices(raw.map(normaliseService).filter(Boolean));
    } catch (error) {
      toast.error('Failed to load services');
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveService = async () => {
    if (!formData.name || formData.duration_minutes < 15) {
      toast.error('Please fill in required fields correctly');
      return;
    }

    try {
      if (selectedService) {
        await api.put(
          `/api/businesses/${businessId}/services/${selectedService.id}`,
          formData
        );
        toast.success('Service updated');
      } else {
        await api.post(`/api/businesses/${businessId}/services`, formData);
        toast.success('Service created');
      }
      setShowForm(false);
      setSelectedService(null);
      setFormData({
        name: '',
        description: '',
        category: '',
        duration_minutes: 60,
        base_price_cents: 0,
        max_capacity: 1,
        min_notice_hours: 24,
        cancellation_policy_hours: 24
      });
      loadServices();
    } catch (error) {
      toast.error('Failed to save service');
    }
  };

  const handleDeleteService = async (serviceId) => {
    if (!window.confirm('Deactivate this service?')) return;
    try {
      await api.put(`/api/businesses/${businessId}/services/${serviceId}`, {
        is_active: false
      });
      toast.success('Service deactivated');
      loadServices();
    } catch (error) {
      toast.error('Failed to delete service');
    }
  };

  const handleEditService = (service) => {
    setSelectedService(service);
    setFormData({
      name: service.name,
      description: service.description || '',
      category: service.category || '',
      duration_minutes: service.duration_minutes,
      base_price_cents: service.base_price_cents,
      max_capacity: service.max_capacity,
      min_notice_hours: service.min_notice_hours,
      cancellation_policy_hours: service.cancellation_policy_hours
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setSelectedService(null);
    setFormData({
      name: '',
      description: '',
      category: '',
      duration_minutes: 60,
      base_price_cents: 0,
      max_capacity: 1,
      min_notice_hours: 24,
      cancellation_policy_hours: 24
    });
    setShowForm(true);
  };

  return (
    <div className="bst-services-container">
      <div className="bst-header">
        <h3>Services</h3>
        <button onClick={resetForm} className="bst-btn-new">
          <Plus size={18} /> New Service
        </button>
      </div>
      {showForm ? (
        <div className="bst-form-container">
          <h4>{selectedService ? 'Edit Service' : 'Create Service'}</h4>
          <div className="bst-form-row">
            <div className="bst-form-group">
              <label>Service Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., 1-Hour Consultation"
                required
              />
            </div>
            <div className="bst-form-group">
              <label>Category</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="e.g., Consulting"
              />
            </div>
          </div>
          <div className="bst-form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe what this service includes..."
              rows="3"
            />
          </div>
          <div className="bst-form-row">
            <div className="bst-form-group">
              <label>Duration (minutes) *</label>
              <input
                type="number"
                min="15"
                step="15"
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) || 60 })}
                required
              />
            </div>
            <div className="bst-form-group">
              <label>Base Price (cents)</label>
              <input
                type="number"
                min="0"
                value={formData.base_price_cents}
                onChange={(e) => setFormData({ ...formData, base_price_cents: parseInt(e.target.value) || 0 })}
              />
              <small>${(formData.base_price_cents / 100).toFixed(2)}</small>
            </div>
          </div>
          <div className="bst-form-row">
            <div className="bst-form-group">
              <label>Max Capacity</label>
              <input
                type="number"
                min="1"
                value={formData.max_capacity}
                onChange={(e) => setFormData({ ...formData, max_capacity: parseInt(e.target.value) || 1 })}
              />
            </div>
            <div className="bst-form-group">
              <label>Min Notice (hours)</label>
              <input
                type="number"
                min="0"
                value={formData.min_notice_hours}
                onChange={(e) => setFormData({ ...formData, min_notice_hours: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div className="bst-form-buttons">
            <button onClick={() => setShowForm(false)} className="bst-btn-cancel">Cancel</button>
            <button onClick={handleSaveService} className="bst-btn-save">Save Service</button>
          </div>
        </div>
      ) : (
        <div className="bst-services-grid">
          {loading ? (
            <div className="bst-loading">Loading services...</div>
          ) : services.length === 0 ? (
            <div className="bst-empty">
              <p>No services yet</p>
              <button onClick={resetForm} className="bst-btn-new-large">
                Create First Service
              </button>
            </div>
          ) : (
            services.map((service) => (
              <div
                key={service.id}
                className={`bst-service-card${service.is_active ? '' : ' inactive'}`}
              >
                <div className="bst-service-header">
                  <h4>{service.name}</h4>
                  <div className="bst-service-actions">
                    <button
                      onClick={() => handleEditService(service)}
                      className="bst-btn-action"
                      aria-label="Edit service"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteService(service.id)}
                      className="bst-btn-action delete"
                      aria-label="Delete service"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {service.category ? <span className="bst-category">{service.category}</span> : null}
                {service.description ? (
                  <p className="bst-description">{service.description}</p>
                ) : null}
                <div className="bst-service-details">
                  <div className="bst-detail">
                    <Clock size={14} />
                    <span>{service.duration_minutes} min</span>
                  </div>
                  <div className="bst-detail">
                    <DollarSign size={14} />
                    <span>${(service.base_price_cents / 100).toFixed(2)}</span>
                  </div>
                  <div className="bst-detail">
                    <span className="bst-capacity">Cap: {service.max_capacity}</span>
                  </div>
                </div>
                {service.staff_count > 0 ? (
                  <div className="bst-staff-info">
                    {service.staff_count} staff assigned
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
