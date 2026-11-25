import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Store } from 'lucide-react';
import './FranchiseApplicationDetail.css';

// Group 12 Slice 3c (614, D-314): a location's service availability
// checklist — which services the location offers, each marked available
// or unavailable with a reason, and the location launch. The checklist
// draws on the linked business's service catalogue where one exists, and
// accepts a free-text service otherwise. A location cannot launch with
// zero available services (the server enforces it too); the launch
// button stays disabled until at least one service is available. Used by
// the operator pages (FranchiseOpenLocations) and the HQ locations panel.
export default function FranchiseLocationServices({
  location,
  catalogue = [],
  canEdit = false,
  onServiceSave = null,
  onLaunch = null,
  disabled = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [serviceSelect, setServiceSelect] = useState('');
  const [customName, setCustomName] = useState('');
  const [available, setAvailable] = useState('true');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const services = location.services || [];
  const availableCount = services.filter((service) => service.available).length;
  const canLaunch = location.status === 'planned' && availableCount > 0;

  async function saveService() {
    if (!onServiceSave) return;
    const body = serviceSelect === '__custom'
      ? { service_name: customName.trim(), available: available === 'true', reason: reason.trim() || undefined }
      : { service_id: Number(serviceSelect), available: available === 'true', reason: reason.trim() || undefined };
    setSaving(true);
    try {
      await onServiceSave(location.id, body);
      setServiceSelect('');
      setCustomName('');
      setAvailable('true');
      setReason('');
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = disabled || saving
    || serviceSelect === ''
    || (serviceSelect === '__custom' && !customName.trim());

  return (
    <div>
      <div className="fr-detail-list-label">{copy('servicesTitle')}</div>
      {services.length === 0 ? (
        <p className="fr-detail-empty">{copy('servicesEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {services.map((service) => (
            <li key={service.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{service.service_name}</div>
                {service.reason && (
                  <div className="fr-doc-file-meta">{service.reason}</div>
                )}
              </div>
              <span className={`fr-status-badge ${service.available ? 'fr-status-accepted' : 'fr-status-rejected'}`}>
                {service.available ? copy('servicesAvailable') : copy('servicesUnavailable')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && onServiceSave && (
        <div className="fr-followup-compose">
          <label className="fr-detail-list-label" htmlFor={`fr-service-select-${location.id}`}>{copy('servicesCatalogueLabel')}</label>
          <select
            id={`fr-service-select-${location.id}`}
            className="fr-followup-input"
            value={serviceSelect}
            disabled={disabled || saving}
            onChange={(event) => setServiceSelect(event.target.value)}
          >
            <option value="">{copy('servicesChoose')}</option>
            {catalogue.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
            <option value="__custom">{copy('servicesCustomOption')}</option>
          </select>
          {serviceSelect === '__custom' && (
            <input
              className="fr-followup-input"
              placeholder={copy('servicesCustomName')}
              value={customName}
              disabled={disabled || saving}
              onChange={(event) => setCustomName(event.target.value)}
            />
          )}
          <label className="fr-detail-list-label" htmlFor={`fr-service-available-${location.id}`}>{copy('servicesAvailableLabel')}</label>
          <select
            id={`fr-service-available-${location.id}`}
            className="fr-followup-input"
            value={available}
            disabled={disabled || saving}
            onChange={(event) => setAvailable(event.target.value)}
          >
            <option value="true">{copy('servicesAvailable')}</option>
            <option value="false">{copy('servicesUnavailable')}</option>
          </select>
          <input
            className="fr-followup-input"
            placeholder={copy('servicesReason')}
            value={reason}
            disabled={disabled || saving}
            onChange={(event) => setReason(event.target.value)}
          />
          <button type="button" className="fr-btn-primary" disabled={saveDisabled} onClick={saveService} data-track="ui.c401f5d1e4.1">
            {copy('servicesSave')}
          </button>
        </div>
      )}

      {onLaunch && location.status === 'planned' && (
        <div className="fr-followup-compose">
          {availableCount === 0 && (
            <p className="fr-detail-empty">{copy('servicesLaunchNeedsServices')}</p>
          )}
          <button type="button" className="fr-btn-primary" disabled={disabled || !canLaunch} onClick={() => onLaunch(location.id)} data-track="ui.c401f5d1e4.2">
            <Store size={14} /> {copy('servicesLaunch')}
          </button>
        </div>
      )}
    </div>
  );
}
