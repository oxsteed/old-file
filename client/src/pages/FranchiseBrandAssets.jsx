import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image } from 'lucide-react';
import './FranchiseApplicationDetail.css';

function formatSize(bytes) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Group 12 Slice 3e (623, D-324): the brand asset store — HQ uploads
// brand assets (logos, templates, guidelines) for a territory or
// franchise-wide; operators browse and download them from the territory
// ops page. Downloads go through the signed URL minted at read time.
export default function FranchiseBrandAssets({
  assets = [],
  canUpload = false,
  canDelete = false,
  onUpload = null,
  onDelete = null,
  disabled = false,
}) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('territory');
  const [formKey, setFormKey] = useState(0);
  const [formError, setFormError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!file || !onUpload) return;
    setFormError('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (name.trim()) form.append('name', name.trim());
      if (description.trim()) form.append('description', description.trim());
      await onUpload({ formData: form, scope });
      setFile(null);
      setName('');
      setDescription('');
      setFormKey((key) => key + 1);
    } catch (err) {
      setFormError(err?.response?.data?.error || copy('brandAssetsUploadFailed'));
    }
  }

  return (
    <section className="fr-detail-card">
      <div className="fr-detail-heading">
        <Image size={16} className="fr-detail-heading-icon" />
        <div>
          <h2 className="fr-detail-title">{copy('brandAssetsTitle')}</h2>
          <p className="fr-detail-subtitle">{copy('brandAssetsSubtitle')}</p>
        </div>
      </div>

      {canUpload && onUpload && (
        <form key={formKey} onSubmit={submit} className="fr-doc-list">
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-brand-asset-file">{copy('brandAssetsFileLabel')}</label>
            <input
              id="fr-brand-asset-file"
              type="file"
              required
              className="fr-followup-input"
              disabled={disabled}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-brand-asset-name">{copy('brandAssetsNameLabel')}</label>
            <input
              id="fr-brand-asset-name"
              type="text"
              className="fr-followup-input"
              value={name}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy('brandAssetsNamePlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-brand-asset-description">{copy('brandAssetsDescriptionLabel')}</label>
            <input
              id="fr-brand-asset-description"
              type="text"
              className="fr-followup-input"
              value={description}
              disabled={disabled}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={copy('brandAssetsDescriptionPlaceholder')}
            />
          </div>
          <div>
            <label className="fr-detail-list-label" htmlFor="fr-brand-asset-scope">{copy('brandAssetsScopeLabel')}</label>
            <select
              id="fr-brand-asset-scope"
              className="fr-followup-input"
              value={scope}
              disabled={disabled}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="territory">{copy('brandAssetsScopeTerritory')}</option>
              <option value="franchise">{copy('brandAssetsScopeFranchise')}</option>
            </select>
          </div>
          {formError && <p className="fr-detail-empty">{formError}</p>}
          <div>
            <button type="submit" className="fr-btn-primary" disabled={disabled || !file}>
              {copy('brandAssetsUpload')}
            </button>
          </div>
        </form>
      )}

      {assets.length === 0 ? (
        <p className="fr-detail-empty">{copy('brandAssetsEmpty')}</p>
      ) : (
        <ul className="fr-doc-files">
          {assets.map((asset) => (
            <li key={asset.id} className="fr-doc-file">
              <div>
                <div className="fr-doc-file-name">{asset.name}</div>
                <div className="fr-doc-file-meta">
                  {asset.file_name}
                  {formatSize(asset.file_size_bytes) ? ` · ${formatSize(asset.file_size_bytes)}` : ''}
                  {` · ${formatDate(asset.created_at)}`}
                </div>
                {asset.description && (
                  <div className="fr-doc-file-meta">{asset.description}</div>
                )}
              </div>
              <span className="fr-status-badge fr-status-pending">
                {asset.scope === 'franchise' ? copy('standardsScopeFranchise') : copy('standardsScopeTerritory')}
              </span>
              {asset.download_url && !asset.download_unavailable ? (
                <a
                  className="fr-btn-primary"
                  href={asset.download_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy('brandAssetsDownload')}
                </a>
              ) : (
                <span className="fr-detail-empty">{copy('brandAssetsDownloadUnavailable')}</span>
              )}
              {canDelete && onDelete && (
                <button
                  type="button"
                  className="fr-btn-primary"
                  disabled={disabled}
                  onClick={() => onDelete(asset)}
                >
                  {copy('brandAssetsDelete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
