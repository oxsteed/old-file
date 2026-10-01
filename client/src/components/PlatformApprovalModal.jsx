// client/src/components/PlatformApprovalModal.jsx
//
// Opens when a gated action returns 403 { error: 'platform_approval_required' }
// OR when the user clicks "Request OxSteed approval" from a dashboard banner.
//
// The form is dynamic: it renders fields from policy.application_schema, so
// super-admin can edit the questions per mode without touching this file.
//
// Usage:
//   <PlatformApprovalModal
//     mode="consultant"
//     open={open}
//     onClose={() => setOpen(false)}
//     onApproved={() => /* gated action was retried & succeeded */}
//   />

import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { X, Shield, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { getMyApproval, requestApproval } from '../api/modePlatformApprovals';

function FieldInput({ field, value, onChange, error }) {
  const common = {
    id: `pa-${field.name}`,
    value: value ?? '',
    onChange: (e) => onChange(field.name, e.target.value),
    required: !!field.required,
    placeholder: field.placeholder || '',
    className: `w-full py-2.5 px-3 bg-gray-800/50 border rounded-lg text-white text-sm placeholder-gray-500 transition-all focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 ${error ? 'border-red-500 bg-red-900/20' : 'border-gray-700'}`,
  };
  if (field.type === 'textarea') {
    return <textarea {...common} rows={field.rows || 4} />;
  }
  if (field.type === 'number') {
    return <input {...common} type="number" min={field.min} max={field.max} />;
  }
  if (field.type === 'url') {
    return <input {...common} type="url" />;
  }
  return <input {...common} type="text" />;
}

function Status({ status, t }) {
  if (status === 'approved') {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
        <CheckCircle2 size={20} className="text-green-400 mt-0.5 flex-shrink-0" />
        <div>
          <div className="text-sm font-semibold text-green-300">{t('platformApproval.statusApproved', { defaultValue: "You're approved" })}</div>
          <div className="text-xs mt-0.5 text-green-200/80">{t('platformApproval.statusApprovedHint', { defaultValue: 'You can take paying clients now.' })}</div>
        </div>
      </div>
    );
  }
  if (status === 'requested') {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)' }}>
        <Clock size={20} className="text-blue-400 mt-0.5 flex-shrink-0" />
        <div>
          <div className="text-sm font-semibold text-blue-300">{t('platformApproval.statusRequested', { defaultValue: 'Application under review' })}</div>
          <div className="text-xs mt-0.5 text-blue-200/80">{t('platformApproval.statusRequestedHint', { defaultValue: "We'll email you when it's decided, usually 1-2 business days." })}</div>
        </div>
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
        <AlertCircle size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
        <div>
          <div className="text-sm font-semibold text-red-300">{t('platformApproval.statusRejected', { defaultValue: 'Previous application was not approved' })}</div>
          <div className="text-xs mt-0.5 text-red-200/80">{t('platformApproval.statusRejectedHint', { defaultValue: 'You can update your answers below and try again.' })}</div>
        </div>
      </div>
    );
  }
  return null;
}

export default function PlatformApprovalModal({
  mode,
  open,
  onClose,
  onApproved,
  // Optional: caller can pass the policy directly (e.g., from the 403 body)
  // to skip the initial GET. Falls back to fetching if absent.
  initialPolicy,
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [policy, setPolicy] = useState(initialPolicy || null);
  const [approval, setApproval] = useState(null);
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open || !mode) return;
    let cancelled = false;
    setLoading(true);
    getMyApproval(mode)
      .then((res) => {
        if (cancelled) return;
        setPolicy(res.policy || initialPolicy || null);
        setApproval(res.approval || null);
        // Pre-fill form from existing application_data so a resubmit after
        // rejection doesn't lose answers.
        const prev = res.approval?.application_data || {};
        setFormData(prev && typeof prev === 'object' ? prev : {});
      })
      .catch(() => { /* keep going with the policy from props */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, mode, initialPolicy]);

  const fields = useMemo(
    () => Array.isArray(policy?.application_schema?.fields) ? policy.application_schema.fields : [],
    [policy],
  );

  const status = approval?.status || 'not_requested';
  const canEditForm = status === 'not_requested' || status === 'rejected' || status === 'revoked';

  const handleChange = (name, value) => {
    setFormData((p) => ({ ...p, [name]: value }));
    setErrors((p) => ({ ...p, [name]: '' }));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await requestApproval(mode, formData);
      if (res.resolution === 'validation_failed') {
        setErrors(res.fields || res.errors || {});
        toast.error(t('platformApproval.validationFailed', { defaultValue: 'Some fields need attention.' }));
        return;
      }
      if (res.resolution === 'auto_approved') {
        setApproval(res.approval);
        toast.success(t('platformApproval.approvedToast', { defaultValue: "You're approved." }));
        onApproved?.();
        // Don't auto-close — let the user see the success state.
      } else if (res.resolution === 'pending') {
        setApproval(res.approval);
        toast.success(t('platformApproval.submittedToast', { defaultValue: 'Application submitted.' }));
      } else if (res.resolution === 'not_required') {
        toast.success(t('platformApproval.noLongerRequired', { defaultValue: 'Approval is no longer required for this mode.' }));
        onApproved?.();
      }
    } catch (err) {
      const msg = err?.response?.data?.error || t('platformApproval.submitFailed', { defaultValue: 'Could not submit. Please try again.' });
      toast.error(typeof msg === 'string' ? msg : t('platformApproval.submitFailed', { defaultValue: 'Could not submit. Please try again.' }));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', padding: '1rem',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl border overflow-hidden flex flex-col"
        style={{ borderColor: 'var(--color-border, #1f2937)', background: 'var(--color-surface, #0f172a)', maxHeight: '90vh' }}
      >
        <header className="px-5 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(249,115,22,0.12)' }}>
            <Shield size={18} className="text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text, #f3f4f6)' }}>
              {t('platformApproval.title', { defaultValue: 'OxSteed approval required' })}
            </h2>
            <p className="text-xs" style={{ color: 'var(--color-text-muted, #94a3b8)' }}>
              {t(`platformApproval.subtitle.${mode}`, {
                defaultValue: t('platformApproval.subtitle.default', {
                  defaultValue: 'A quick application before you can take action here.',
                }),
              })}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })} className="p-1 rounded-md hover:bg-white/5">
            <X size={18} className="text-gray-400" />
          </button>
        </header>

        <div className="px-5 py-4 overflow-y-auto" style={{ flex: 1 }}>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <Status status={status} t={t} />

              {approval?.rejection_reason && status === 'rejected' && (
                <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.06)', color: 'var(--color-text-muted, #94a3b8)' }}>
                  <div className="font-semibold mb-1" style={{ color: '#fca5a5' }}>{t('platformApproval.reviewerNotes', { defaultValue: "Reviewer's note:" })}</div>
                  {approval.rejection_reason}
                </div>
              )}

              {fields.length === 0 && canEditForm && (
                <p className="text-xs mt-4" style={{ color: 'var(--color-text-muted)' }}>
                  {t('platformApproval.noFieldsHint', { defaultValue: 'No additional details required. Submit to send a request.' })}
                </p>
              )}

              {canEditForm && fields.length > 0 && (
                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                  {fields.map((f) => (
                    <div key={f.name} className="flex flex-col gap-1">
                      <label htmlFor={`pa-${f.name}`} className="text-[11px] font-semibold tracking-wide uppercase text-gray-400">
                        {f.label}{f.required && <span className="text-red-400 ms-0.5">*</span>}
                      </label>
                      <FieldInput field={f} value={formData[f.name]} onChange={handleChange} error={errors[f.name]} />
                      {f.hint && <span className="text-[11px] text-gray-500">{f.hint}</span>}
                      {errors[f.name] && (
                        <span className="text-[11px] text-red-400">
                          {errors[f.name] === 'required' && t('platformApproval.fieldErrorRequired', { defaultValue: 'This field is required.' })}
                          {errors[f.name].startsWith('min_length:') && t('platformApproval.fieldErrorMinLength', { defaultValue: `Too short. Aim for at least ${errors[f.name].split(':')[1]} characters.` })}
                          {errors[f.name].startsWith('max_length:') && t('platformApproval.fieldErrorMaxLength', { defaultValue: 'Too long.' })}
                          {errors[f.name] === 'not_a_number' && t('platformApproval.fieldErrorNumber', { defaultValue: 'Must be a number.' })}
                          {errors[f.name] === 'invalid_url' && t('platformApproval.fieldErrorUrl', { defaultValue: 'Must be a valid URL.' })}
                          {!['required', 'not_a_number', 'invalid_url'].includes(errors[f.name]) && !errors[f.name].includes(':') && errors[f.name]}
                        </span>
                      )}
                    </div>
                  ))}
                </form>
              )}
            </>
          )}
        </div>

        <footer className="px-5 py-3 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-2 rounded-md text-gray-300 hover:bg-white/5"
          >
            {status === 'approved' ? t('common.done', { defaultValue: 'Done' }) : t('common.close', { defaultValue: 'Close' })}
          </button>
          {canEditForm && !loading && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="text-sm px-4 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-60"
            >
              {submitting
                ? t('platformApproval.submitting', { defaultValue: 'Submitting...' })
                : status === 'rejected'
                  ? t('platformApproval.resubmit', { defaultValue: 'Resubmit' })
                  : t('platformApproval.submit', { defaultValue: 'Submit application' })}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
