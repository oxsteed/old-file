// client/src/pages/VortexPage.jsx
//
// The unified Vortex entry page.
//
//   1. If the user has business memberships, shows the workspace list with a
//      one-click "Open workspace" that routes to /business/:id/workspace.
//   2. If the user has a code, shows a code-entry form that previews the
//      business + role, then redeems and lands the user in the workspace.
//   3. If the user owns a business, surfaces an "Open my business" shortcut
//      and a "Manage access codes" link.
//
// Designed to replace the buried "Vortex tokens" tab inside BusinessHubPage
// as the workspace-join entry point. Owners still create new businesses
// via the existing Vortex business-creation flow (BusinessLaunchStatusPage
// linked at the bottom).

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import {
  previewVortexCode,
  redeemVortexCode,
  getMyBusinesses,
  setWorkspaceContext,
} from '../api/vortex';
import { LAUNCH_VISIBILITY } from '../utils/launchScope';

function roleLabel(t, role) {
  if (!role) return '';
  // Falls back to capitalized role code if no translation
  return t(`vortex.roles.${role}`, { defaultValue: role.replace('_', ' ') });
}

function statusBadge(t, status) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
        {t('vortex.status.active', { defaultValue: 'Active' })}
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        {t('vortex.status.pending', { defaultValue: 'Pending approval' })}
      </span>
    );
  }
  return null;
}

export default function VortexPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const workspaceEntryVisible = LAUNCH_VISIBILITY.vortexWorkspaceEntry;

  const [loadingBiz, setLoadingBiz] = useState(true);
  const [bizList, setBizList] = useState({ items: [], owned_count: 0, membership_count: 0, pending_count: 0 });

  const [code, setCode] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState(null);
  const [waitingBusiness, setWaitingBusiness] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyBusinesses();
        if (!cancelled) setBizList(data || { items: [] });
      } catch (err) {
        // Not signed in or transient; the page is still usable for code entry.
      } finally {
        if (!cancelled) setLoadingBiz(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const owned = useMemo(() => bizList.items.filter((b) => b.is_owner), [bizList]);
  const memberships = useMemo(() => bizList.items.filter((b) => !b.is_owner), [bizList]);

  const openWorkspace = async (item) => {
    try {
      await setWorkspaceContext(item.business_id);
    } catch (_) {
      // non-fatal — still route
    }
    navigate(`/business/${item.business_id}/workspace`);
  };

  const handlePreview = async (e) => {
    if (e) e.preventDefault();
    setError(null);
    setPreview(null);
    const trimmed = code.trim();
    if (!trimmed) {
      setError(t('vortex.codeRequired', { defaultValue: 'Please enter a code.' }));
      return;
    }
    setPreviewing(true);
    try {
      const data = await previewVortexCode(trimmed);
      setPreview(data);
    } catch (err) {
      const msg = err?.response?.data?.error?.message
        || err?.response?.data?.message
        || t('vortex.previewFailed', { defaultValue: 'That code is not valid.' });
      setError(msg);
    } finally {
      setPreviewing(false);
    }
  };

  const handleRedeem = async () => {
    if (!preview) return;
    setRedeeming(true);
    try {
      const result = await redeemVortexCode(code.trim());
      if (result.status === 'pending') {
        // Pending approval: stay on the page and show the waiting panel.
        toast.success(t('vortex.pendingApproval'));
        setWaitingBusiness({ name: result.business_name });
        setCode('');
        setPreview(null);
        return;
      }
      toast.success(t('vortex.joined', {
        defaultValue: 'Welcome to {{name}}.',
        name: result.business_name,
      }));
      // Refresh the list and route to workspace.
      try { setBizList(await getMyBusinesses()); } catch (_) {}
      await setWorkspaceContext(result.business_id).catch(() => {});
      navigate(`/business/${result.business_id}/workspace`);
    } catch (err) {
      const msg = err?.response?.data?.error?.message
        || err?.response?.data?.message
        || t('vortex.redeemFailed', { defaultValue: 'Failed to redeem this code.' });
      toast.error(msg);
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <PageShell>
      <PageMeta
        title={t('vortex.pageTitle', { defaultValue: 'Vortex - Business workspaces' })}
        description={t('vortex.pageDescription', {
          defaultValue: 'Switch between business workspaces or join a team with an access code.',
        })}
      />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
              V
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[color:var(--app-text)]">
                {t('vortex.title', { defaultValue: 'Vortex' })}
              </h1>
              <p className="text-sm text-[color:var(--muted-text)]">
                {t('vortex.subtitle', {
                  defaultValue: 'Your business workspaces in one place. Switch in, or join a new team with a code.',
                })}
              </p>
            </div>
          </div>
        </header>

        {/* Workspaces grid (hidden while workspace entry is launch-gated) */}
        {workspaceEntryVisible && (loadingBiz ? (
          <div className="rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--card-bg)] p-6 text-center text-sm text-[color:var(--muted-text)]">
            {t('vortex.loadingWorkspaces', { defaultValue: 'Loading your workspaces...' })}
          </div>
        ) : bizList.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--border-color)] bg-[color:var(--card-bg)] p-6 mb-8 text-center">
            <h2 className="text-lg font-semibold mb-1 text-[color:var(--app-text)]">
              {t('vortex.noWorkspacesTitle', { defaultValue: 'No business workspaces yet' })}
            </h2>
            <p className="text-sm text-[color:var(--muted-text)] mb-3">
              {t('vortex.noWorkspacesBody', {
                defaultValue: 'Have a code from a business owner? Enter it below. Or launch your own business.',
              })}
            </p>
          </div>
        ) : (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3 text-[color:var(--app-text)]">
              {t('vortex.yourWorkspaces', { defaultValue: 'Your workspaces' })}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {bizList.items.map((b) => (
                <button
                  key={`${b.business_id}-${b.role}`}
                  type="button"
                  onClick={() => openWorkspace(b)}
                  className="group text-left rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--card-bg)] p-4 hover:border-orange-400 hover:shadow-md transition-all"
                  disabled={b.status === 'pending'}
                  aria-disabled={b.status === 'pending'}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-[color:var(--app-text)] truncate">
                        {b.business_name}
                      </div>
                      <div className="mt-1 text-xs text-[color:var(--muted-text)] flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-[color:var(--app-bg)] border border-[color:var(--border-color)] capitalize">
                          {roleLabel(t, b.role)}
                        </span>
                        {statusBadge(t, b.status)}
                        {b.last_selected_at ? (
                          <span>
                            {t('vortex.lastOpened', {
                              defaultValue: 'Last opened {{when}}',
                              when: new Date(b.last_selected_at).toLocaleDateString(),
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span aria-hidden className="text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-[color:var(--muted-text)]">
              {t('vortex.workspaceFootnote', {
                defaultValue: 'Owners see all their businesses. Team members see businesses they\'ve joined.',
              })}
            </p>
          </section>
        ))}

        {!workspaceEntryVisible && (
          <p className="mb-3 text-sm text-[color:var(--muted-text)]">
            {t('vortex.workspacesHiddenNote')}
          </p>
        )}

        {/* Code entry */}
        <section className="rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--card-bg)] p-6 mb-8">
          <h2 className="text-lg font-semibold mb-1 text-[color:var(--app-text)]">
            {t('vortex.joinTitle', { defaultValue: 'Join a business with a code' })}
          </h2>
          <p className="text-sm text-[color:var(--muted-text)] mb-4">
            {t('vortex.joinBody', {
              defaultValue: 'Enter the access code your business owner or manager shared with you.',
            })}
          </p>

          {waitingBusiness ? (
            <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20 p-4">
              <h3 className="text-base font-semibold text-[color:var(--app-text)]">
                {t('vortex.pendingWaitingTitle')}
              </h3>
              <p className="mt-1 text-sm text-[color:var(--muted-text)]">
                {t('vortex.pendingWaitingBody')}
              </p>
            </div>
          ) : null}

          <form onSubmit={handlePreview} className="flex flex-col sm:flex-row gap-2 mb-2">
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setPreview(null); setError(null); }}
              placeholder={t('vortex.codePlaceholder', { defaultValue: 'VRTX-XXXXX-XXXXX' })}
              className="flex-1 px-4 py-3 rounded-xl border border-[color:var(--border-color)] bg-[color:var(--app-bg)] text-[color:var(--app-text)] font-mono tracking-wider uppercase placeholder:normal-case placeholder:tracking-normal placeholder:text-[color:var(--muted-text)] focus:outline-none focus:ring-2 focus:ring-orange-500"
              aria-label={t('vortex.codeAriaLabel', { defaultValue: 'Access code' })}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={previewing || !code.trim()}
              className="px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {previewing
                ? t('vortex.checking', { defaultValue: 'Checking...' })
                : t('vortex.checkCode', { defaultValue: 'Check code' })}
            </button>
          </form>

          {error ? (
            <div className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">{error}</div>
          ) : null}

          {preview ? (
            <div className="mt-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 p-4">
              <div className="text-sm text-[color:var(--muted-text)] mb-1">
                {t('vortex.previewLabel', { defaultValue: 'You\'re about to join' })}
              </div>
              <div className="text-lg font-semibold text-[color:var(--app-text)]">{preview.business_name}</div>
              <div className="text-sm text-[color:var(--muted-text)] mt-1">
                {t('vortex.previewRole', {
                  defaultValue: 'Role: {{role}}',
                  role: roleLabel(t, preview.role),
                })}
                {preview.label ? ` - ${preview.label}` : ''}
              </div>
              {preview.requires_approval ? (
                <div className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                  {t('vortex.previewRequiresApproval', {
                    defaultValue: 'This business requires owner approval before you can access the workspace.',
                  })}
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleRedeem}
                disabled={redeeming}
                className="mt-3 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50 transition-colors"
              >
                {redeeming
                  ? t('vortex.joining', { defaultValue: 'Joining...' })
                  : t('vortex.confirmJoin', { defaultValue: 'Confirm and join' })}
              </button>
            </div>
          ) : null}
        </section>

        {/* Owner launchpad shortcut (hidden while workspace entry is launch-gated) */}
        {workspaceEntryVisible && (
        <section className="rounded-2xl border border-[color:var(--border-color)] bg-[color:var(--card-bg)] p-6">
          <h2 className="text-lg font-semibold mb-1 text-[color:var(--app-text)]">
            {t('vortex.launchTitle', { defaultValue: 'Launching your own business?' })}
          </h2>
          <p className="text-sm text-[color:var(--muted-text)] mb-3">
            {t('vortex.launchBody', {
              defaultValue: 'Start the OxSteed business setup and we\'ll guide you through it.',
            })}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate('/business-hub')}
              className="px-4 py-2 rounded-lg border border-[color:var(--border-color)] hover:bg-[color:var(--app-bg)] text-sm font-medium text-[color:var(--app-text)] transition-colors"
            >
              {t('vortex.launchCta', { defaultValue: 'Open business setup' })}
            </button>
            {owned.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => navigate('/business-hub?tab=team')}
                  className="px-4 py-2 rounded-lg border border-[color:var(--border-color)] hover:bg-[color:var(--app-bg)] text-sm font-medium text-[color:var(--app-text)] transition-colors"
                >
                  {t('vortex.manageAccessCodes')}
                </button>
                <button
                  type="button"
                  onClick={() => openWorkspace(owned[0])}
                  className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors"
                >
                  {t('vortex.openOwnerWorkspace', {
                    defaultValue: 'Open {{name}}',
                    name: owned[0].business_name,
                  })}
                </button>
              </>
            ) : null}
          </div>
        </section>
        )}
      </div>
    </PageShell>
  );
}
