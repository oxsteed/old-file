import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import TrialBanner from '../components/TrialBanner';
import useSubscription from '../hooks/useSubscription';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState({ first_name: '', last_name: '', phone: '', bio: '', zipcode: '' });
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

    // ── Subscription state ──────────────────────────────────
  const { subscription, plans, loading: subLoading, openPortal, cancelSubscription, createCheckout } = useSubscription();

  // ── Businesses state ────────────────────────────────────
  const [businesses, setBusinesses] = useState([]);
  const [bizLoading, setBizLoading] = useState(true);
  const [showAddBiz, setShowAddBiz] = useState(false);
  const [editingBiz, setEditingBiz] = useState(null);
  const [bizForm, setBizForm] = useState({
    business_name: '', business_type: 'llc', ein: '',
    address_street: '', address_city: '', address_state: '', address_zip: '',
  });
  const [bizSaving, setBizSaving] = useState(false);

  // ── Load profile ────────────────────────────────────────
  useEffect(() => {
    api.get('/auth/me')
      .then(r => {
        const u = r.data?.user || r.data || {};
        setProfile({
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          phone: u.phone || '',
          bio: u.bio || '',
          zipcode: u.zip_code || u.zipcode || '',
          display_name_preference: u.display_name_preference || 'first_name',
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── Load businesses ─────────────────────────────────────
  useEffect(() => {
    api.get('/businesses')
      .then(r => { setBusinesses(r.data?.businesses || []); setBizLoading(false); })
      .catch(() => setBizLoading(false));
  }, []);

  // ── Profile handlers ────────────────────────────────────
  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { first_name, last_name, bio, ...updatableFields } = profile;
      await api.put('/auth/profile', updatableFields);
      toast.success('Profile updated');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to update'); }
    setSaving(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (passwords.newPass !== passwords.confirm) return toast.error('Passwords do not match');
    if (passwords.newPass.length < 8) return toast.error('Password must be at least 8 characters');
    try {
      await api.put('/auth/change-password', { currentPassword: passwords.current, newPassword: passwords.newPass });
      toast.success('Password changed');
      setPasswords({ current: '', newPass: '', confirm: '' });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to change password'); }
  };

  const deleteAccount = async () => {
    try {
      await api.delete('/privacy/delete-account');
      toast.success('Account deleted');
      logout();
      navigate('/');
    } catch (err) { toast.error('Failed to delete account'); }
  };

  // ── Business handlers ───────────────────────────────────
  const resetBizForm = () => {
    setBizForm({ business_name: '', business_type: 'llc', ein: '', address_street: '', address_city: '', address_state: '', address_zip: '' });
    setEditingBiz(null);
    setShowAddBiz(false);
  };

  const openAddBiz = () => {
    resetBizForm();
    setShowAddBiz(true);
  };

  const openEditBiz = (biz) => {
    setBizForm({
      business_name: biz.business_name || '',
      business_type: biz.business_type || 'llc',
      ein: '', // don't prefill sensitive data
      address_street: biz.address_street || '',
      address_city: biz.address_city || '',
      address_state: biz.address_state || '',
      address_zip: biz.address_zip || '',
    });
    setEditingBiz(biz);
    setShowAddBiz(true);
  };

  const saveBusiness = async (e) => {
    e.preventDefault();
    if (!bizForm.business_name.trim()) return toast.error('Business name is required');
    setBizSaving(true);
    try {
      if (editingBiz) {
        const { data } = await api.put(`/businesses/${editingBiz.id}`, bizForm);
        setBusinesses(prev => prev.map(b => b.id === editingBiz.id ? data.business : b));
        toast.success('Business updated');
      } else {
        const { data } = await api.post('/businesses', bizForm);
        setBusinesses(prev => [...prev, data.business]);
        toast.success('Business added');
      }
      resetBizForm();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save business'); }
    setBizSaving(false);
  };

  const deleteBusiness = async (id) => {
    if (!confirm('Remove this business?')) return;
    try {
      await api.delete(`/businesses/${id}`);
      setBusinesses(prev => prev.filter(b => b.id !== id));
      toast.success('Business removed');
    } catch (err) { toast.error('Failed to remove business'); }
  };

  const setPrimaryBiz = async (id) => {
    try {
      await api.put(`/businesses/${id}/primary`);
      setBusinesses(prev => prev.map(b => ({ ...b, is_primary: b.id === id })));
      toast.success('Primary business updated');
    } catch (err) { toast.error('Failed to update primary business'); }
  };

  const BIZ_TYPES = [
    { value: 'sole_prop', label: 'Sole Proprietorship' },
    { value: 'llc', label: 'LLC' },
    { value: 'corp', label: 'Corporation' },
    { value: 'partnership', label: 'Partnership' },
  ];

  // ── Loading state ───────────────────────────────────────
  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-4">Settings</h1>

        {/* Trial Banner */}
        <div className="mb-6">
          <TrialBanner />
        </div>

        {/* Navigation */}
        <div className="flex gap-4 mb-8 flex-wrap">
          <Link to="/settings/2fa" className="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition">Two-Factor Auth</Link>
          <Link to="/settings/notifications" className="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition">Notifications</Link>
        </div>

        {/* Edit Profile */}
        <form onSubmit={saveProfile} className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-xl font-semibold mb-4">Edit Profile</h2>

          {/* Name — read-only, contact support to change */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">First Name</label>
              <input
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2 text-gray-400 cursor-not-allowed"
                value={profile.first_name || ''}
                readOnly
                disabled
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Last Name</label>
              <input
                className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2 text-gray-400 cursor-not-allowed"
                value={profile.last_name || ''}
                readOnly
                disabled
              />
            </div>
          </div>
          <div className="flex items-start gap-2 bg-orange-950/40 border border-orange-800/50 rounded-lg px-4 py-3 mb-4">
            <svg className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <p className="text-sm text-orange-300">
              Name changes require identity verification and must be processed by our team — for example, after a marriage or legal name change.{' '}
              <a href="mailto:support@oxsteed.com" className="underline hover:text-orange-200">Email support@oxsteed.com</a>
              {' '}or use the <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('oxsteed:open-support'))} className="underline hover:text-orange-200">support chat</button> at the bottom of this page.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Phone</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white" value={profile.phone || ''} onChange={e => setProfile({...profile, phone: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Zip Code</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white" value={profile.zipcode || ''} onChange={e => setProfile({...profile, zipcode: e.target.value})} />
            </div>
          </div>
          <div className="mt-4">
            <label className="block text-sm text-gray-400 mb-1">Bio</label>
            <textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white h-24" value={profile.bio || ''} onChange={e => setProfile({...profile, bio: e.target.value})} />
          </div>

          {/* Name display preference */}
          <div className="mt-4">
            <label className="block text-sm text-gray-400 mb-1">Display Name</label>
            <p className="text-xs text-gray-500 mb-2">Choose how your name appears to others on the platform.</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'first_name',    label: 'First name only',  example: user?.first_name || 'Alex' },
                { value: 'full_name',     label: 'Full name',        example: `${user?.first_name || 'Alex'} ${user?.last_name || 'Smith'}` },
                { value: 'business_name', label: 'Business name',    example: 'Acme Services' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setProfile(p => ({ ...p, display_name_preference: opt.value }))}
                  className={`flex flex-col items-start p-3 rounded-lg border text-left transition ${profile.display_name_preference === opt.value ? 'border-orange-500 bg-orange-500/10' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}
                >
                  <span className="text-xs font-semibold text-white mb-1">{opt.label}</span>
                  <span className="text-[11px] text-gray-400">{opt.example}</span>
                </button>
              ))}
            </div>
            {profile.display_name_preference === 'business_name' && (
              <p className="text-xs text-orange-400 mt-2">⚠ If you have no business added, this falls back to your first name. Add a business below.</p>
            )}
          </div>

          <button type="submit" disabled={saving} className="mt-4 px-6 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg font-medium transition disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>

                {/* Subscription & Billing */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-xl font-semibold mb-4">Subscription & Billing</h2>
          {subLoading ? (
            <p className="text-gray-500 text-sm">Loading subscription...</p>
          ) : subscription ? (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="px-3 py-1 rounded-full text-sm font-semibold bg-green-500/15 text-green-400">
                  {subscription.status === 'active' ? 'Active' : subscription.status}
                </span>
                <span className="text-gray-400 text-sm">
                  {subscription.plan_name || 'Pro Plan'}
                </span>
              </div>
              {subscription.current_period_end && (
                <p className="text-gray-500 text-sm mb-4">
                  Next billing date: {new Date(subscription.current_period_end).toLocaleDateString()}
                </p>
              )}
              {subscription.cancel_at_period_end && (
                <p className="text-yellow-500 text-sm mb-4">
                  Your subscription will cancel at the end of the current billing period.
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={openPortal}
                  className="px-5 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg font-medium transition text-sm"
                >
                  Manage Billing
                </button>
                {!subscription.cancel_at_period_end && (
                  <button
                    onClick={() => { if (confirm('Cancel your subscription? You will retain access until the end of your billing period.')) cancelSubscription(); }}
                    className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition text-sm text-red-400"
                  >
                    Cancel Plan
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-gray-400 text-sm mb-4">You are on the Free plan. Upgrade to unlock more features.</p>
              <div className="flex gap-3 flex-wrap">
                {plans.filter(p => p.slug !== 'free').map(plan => (
                  <button
                    key={plan.id}
                    onClick={() => createCheckout(plan.slug)}
                    className="px-5 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg font-medium transition text-sm"
                  >
                    Upgrade to {plan.name} — ${(plan.price / 100).toFixed(2)}/mo
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════ */}
        {/* My Businesses                                     */}
        {/* ══════════════════════════════════════════════════ */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">My Businesses</h2>
              <p className="text-sm text-gray-500 mt-0.5">Manage your LLCs and business entities. Jobs and payouts can be tied to a specific business.</p>
            </div>
            <button
              onClick={openAddBiz}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg font-medium transition text-sm whitespace-nowrap"
            >
              + Add Business
            </button>
          </div>

          {/* Business list */}
          {bizLoading ? (
            <p className="text-gray-500 text-sm">Loading businesses...</p>
          ) : businesses.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-gray-700 rounded-xl">
              <p className="text-gray-500 text-sm mb-1">No businesses added yet</p>
              <p className="text-gray-600 text-xs">Add your LLC or business entity to use on jobs and invoices.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {businesses.map(biz => (
                <div key={biz.id} className="flex items-center justify-between p-4 bg-gray-800/50 border border-gray-700/50 rounded-xl">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Icon */}
                    <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F97316" strokeWidth="1.5" strokeLinecap="round">
                        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
                      </svg>
                    </div>
                    {/* Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white text-sm truncate">{biz.business_name}</span>
                        {biz.is_primary && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-400">Primary</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {BIZ_TYPES.find(t => t.value === biz.business_type)?.label || biz.business_type || 'Business'}
                        {biz.address_city && ` · ${biz.address_city}, ${biz.address_state}`}
                      </p>
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    {!biz.is_primary && (
                      <button
                        onClick={() => setPrimaryBiz(biz.id)}
                        title="Set as primary"
                        className="p-2 text-gray-500 hover:text-orange-400 hover:bg-gray-700 rounded-lg transition text-xs"
                      >
                        ★
                      </button>
                    )}
                    <button
                      onClick={() => openEditBiz(biz)}
                      className="p-2 text-gray-500 hover:text-white hover:bg-gray-700 rounded-lg transition text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteBusiness(biz.id)}
                      className="p-2 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded-lg transition text-xs"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add/Edit form */}
          {showAddBiz && (
            <form onSubmit={saveBusiness} className="mt-4 p-4 bg-gray-800/30 border border-gray-700 rounded-xl space-y-4">
              <h3 className="font-semibold text-sm text-white">{editingBiz ? 'Edit Business' : 'Add a Business'}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Business Name *</label>
                  <input
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm"
                    value={bizForm.business_name}
                    onChange={e => setBizForm({ ...bizForm, business_name: e.target.value })}
                    placeholder="Jack's Plumbing LLC"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Business Type</label>
                  <select
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm"
                    value={bizForm.business_type}
                    onChange={e => setBizForm({ ...bizForm, business_type: e.target.value })}
                  >
                    {BIZ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">EIN <span className="text-gray-600">(optional)</span></label>
                  <input
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm"
                    value={bizForm.ein}
                    onChange={e => setBizForm({ ...bizForm, ein: e.target.value })}
                    placeholder="XX-XXXXXXX"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Business Address</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm" placeholder="Street" value={bizForm.address_street} onChange={e => setBizForm({ ...bizForm, address_street: e.target.value })} />
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm" placeholder="City" value={bizForm.address_city} onChange={e => setBizForm({ ...bizForm, address_city: e.target.value })} />
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm" placeholder="State" value={bizForm.address_state} onChange={e => setBizForm({ ...bizForm, address_state: e.target.value })} />
                  <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm" placeholder="Zip" value={bizForm.address_zip} onChange={e => setBizForm({ ...bizForm, address_zip: e.target.value })} />
                </div>
              </div>

              <div className="flex gap-3">
                <button type="submit" disabled={bizSaving} className="px-5 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg font-medium transition text-sm disabled:opacity-50">
                  {bizSaving ? 'Saving...' : editingBiz ? 'Update Business' : 'Add Business'}
                </button>
                <button type="button" onClick={resetBizForm} className="px-5 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition text-sm">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Change Password */}
        <form onSubmit={changePassword} className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-xl font-semibold mb-4">Change Password</h2>
          <div className="space-y-4">
            <input type="password" placeholder="Current Password" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white" value={passwords.current} onChange={e => setPasswords({...passwords, current: e.target.value})} />
            <input type="password" placeholder="New Password" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white" value={passwords.newPass} onChange={e => setPasswords({...passwords, newPass: e.target.value})} />
            <input type="password" placeholder="Confirm New Password" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white" value={passwords.confirm} onChange={e => setPasswords({...passwords, confirm: e.target.value})} />
          </div>
          <button type="submit" className="mt-4 px-6 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg font-medium transition">Update Password</button>
        </form>

        {/* Data Export */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-xl font-semibold mb-4">Your Data</h2>
          <p className="text-gray-400 mb-4">Download a copy of all your data as required by GDPR/CCPA.</p>
          <button onClick={() => { api.get('/privacy/export').then(r => { const blob = new Blob([JSON.stringify(r.data, null, 2)]); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'my-data.json'; a.click(); toast.success('Data exported'); }).catch(() => toast.error('Export failed')); }} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition">Export My Data</button>
        </div>

        {/* Delete Account */}
        <div className="bg-red-950/30 rounded-xl p-6 border border-red-900">
          <h2 className="text-xl font-semibold mb-2 text-red-400">Danger Zone</h2>
          <p className="text-gray-400 mb-4">Permanently delete your account and all associated data. This cannot be undone.</p>
          {!showDelete ? (
            <button onClick={() => setShowDelete(true)} className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition">Delete My Account</button>
          ) : (
            <div className="flex gap-4">
              <button onClick={deleteAccount} className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition">Yes, Delete Permanently</button>
              <button onClick={() => setShowDelete(false)} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition">Cancel</button>
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
