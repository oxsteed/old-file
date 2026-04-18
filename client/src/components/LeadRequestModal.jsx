import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { createLead } from '../api/leads';

export default function LeadRequestModal({ businessId, services = [], onClose, onSuccess }) {
  const { t } = useTranslation();
  const [selectedServices, setSelectedServices] = useState([]);
  const [description, setDescription] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleToggleService = (serviceId) => {
    setSelectedServices(prev =>
      prev.includes(serviceId)
        ? prev.filter(id => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (selectedServices.length === 0) {
      setError(t('leads.selectServices'));
      return;
    }

    if (!description.trim()) {
      setError(t('leads.description'));
      return;
    }

    setLoading(true);
    try {
      await createLead(businessId, {
        serviceIds: selectedServices,
        description: description.trim(),
        budgetMin: budgetMin ? parseFloat(budgetMin) : null,
        budgetMax: budgetMax ? parseFloat(budgetMax) : null,
      });

      toast.success(t('leads.successCreate'));
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || t('leads.errorCreate'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{t('leads.requestQuote')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Services Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('leads.selectServices')}
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-700 rounded-lg p-3">
              {services.length > 0 ? (
                services.map(service => (
                  <label key={service.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedServices.includes(service.id)}
                      onChange={() => handleToggleService(service.id)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-300">
                      {service.name}
                      {service.price > 0 && (
                        <span className="text-gray-500 ml-1">
                          (${service.price.toFixed(2)})
                        </span>
                      )}
                    </span>
                  </label>
                ))
              ) : (
                <p className="text-sm text-gray-500">{t('leads.noRequests')}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('leads.description')}
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('leads.placeholderDescription')}
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Budget Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('leads.budgetMin')}
              </label>
              <input
                type="number"
                value={budgetMin}
                onChange={e => setBudgetMin(e.target.value)}
                placeholder={t('leads.placeholderBudget')}
                min="0"
                step="0.01"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('leads.budgetMax')}
              </label>
              <input
                type="number"
                value={budgetMax}
                onChange={e => setBudgetMax(e.target.value)}
                placeholder={t('leads.placeholderBudget')}
                min="0"
                step="0.01"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || selectedServices.length === 0}
              className="flex-1 px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {loading ? t('leads.sending') : t('leads.submitRequest')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
