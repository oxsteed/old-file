import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import TrialBanner from '../components/TrialBanner';
import useSubscription from '../hooks/useSubscription';
import NotificationPreferences from '../components/NotificationPreferences';
import ReferralPanel from '../components/ReferralPanel';

const HELPER_ROLES = ['helper', 'helper_pro', 'broker'];

export default function SettingsPage() {
  const { user, logout, switchRole } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');
  const [switchingRole, setSwitchingRole] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const isHelper = HELPER_ROLES.includes(user?.role);
  const targetRole = isHelper ? 'customer' : 'helper';

  const [profile, setProfile] = useState({ first_name: '', last_name: '', phone: '', bio: '', zipcode: '', display_name_preference: 'first_name' });
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const { subscription, plans, loading: subLoading, openPortal, cancelSubscription, createCheckout } = useSubscription();

  const [businesses, setBusinesses] = useState([]);
  const [bizLoading, setBizLoading] = useState(true);
  const [showAddBiz, setShowAddBiz] = useState(false);
  const [editingBiz, setEditingBiz] = useState(null);
  const [bizForm, setBizForm] = useState({
    business_name: '', business_type: 'llc', ein: '',
    address_street: '', address_city: '', address_state: '', address_zip: '',
  });
  const [bizSaving, setBizSaving] = useState(false);

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

  useEffect(() => {
    api.get('/businesses')
      .then(r => { setBusinesses(r.data?.businesses || []); setBizLoading(false); })
      .catch(() => setBizLoading(false));
  }, []);

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

  const handleSwitchRole = async () => {
    setSwitchingRole(true);
    try {
      await switchRole(targetRole);
      setShowSwitchConfirm(false);
      toast.success(targetRole === 'helper' ? 'Switched to Helper mode!' : 'Switched to Customer mode.');
      navigate(targetRole === 'helper' ? '/dashboard' : '/dashboard', { replace: true });
      window.location.reload();
    } catch (err) { toast.error(err?.response?.data?.error || 'Failed to switch role'); }
    setSwitchingRole(false);
  };

  const saveBusiness = async (e) => {
    e.preventDefault();
    setBizSaving(true);
    try {
      if (editingBiz) {
        const { data } = await api.put(\\`/businesses/\\${editingBiz.id}\\`, bizForm);
        setBusinesses(prev => prev.map(b => b.id === editingBiz.id ? data.business : b));
        toast.success('Business updated');
      } else {
        const { data } = await api.post('/businesses', bizForm);
        setBusinesses(prev => [...prev, data.business]);
        toast.success('Business added');
      }
      setShowAddBiz(false);
      setEditingBiz(null);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save'); }
    setBizSaving(false);
  };

  const BIZ_TYPES = [
    { value: 'sole_prop', label: 'Sole Proprietorship' },
    { value: 'llc', label: 'LLC' },
    { value: 'corp', label: 'Corporation' },
    { value: 'partnership', label: 'Partnership' },
  ];

  if (loading) return <div className=\\\"min-h-screen bg-gray-950 flex items-center justify-center\\\"><p className=\\\"text-gray-400\\\">Loading...</p></div>;

  const tabs = [
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'security', label: 'Security', icon: '🔒' },
    { id: 'billing', label: 'Billing', icon: '💳' },
    { id: 'businesses', label: 'Businesses', icon: '💼' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'referrals', label: 'Referrals', icon: '🎁' },
    { id: 'advanced', label: 'Advanced', icon: '⚙️' },
  ];

  return (
    <div className=\\\"min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-orange-500/30\\\">
      <Navbar />
      <div className=\\\"max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row gap-12\\\">
        
        {/* Sidebar Navigation */}
        <div className=\\\"w-full md:w-64 shrink-0 space-y-1\\\">
          <h1 className=\\\"text-2xl font-bold text-white mb-8 tracking-tight\\\">Settings</h1>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={\\`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 \\${
                activeTab === tab.id 
                  ? 'bg-orange-600/10 text-orange-500 border border-orange-500/20 shadow-[0_0_20px_rgba(249,115,22,0.1)]'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent'
              }\\`}
            >
              <span className=\\\"text-lg opacity-80\\\">{tab.icon}</span>
              <span className=\\\"font-medium\\\">{tab.label}</span>
            </button>
          ))}
          <div className=\\\"pt-8 mt-8 border-t border-slate-800/50\\\">
             <Link to=\\\"/settings/2fa\\\" className=\\\"flex items-center gap-3 px-4 py-2 text-sm text-slate-500 hover:text-orange-400 transition\\\">2FA Dashboard →</Link>
          </div>
        </div>

        {/* Main Content Area */}
        <div className=\\\"flex-1 min-w-0\\\">
          <div className=\\\"bg-slate-900/40 backdrop-blur-sm border border-slate-800/60 rounded-3xl p-8 shadow-2xl relative overflow-hidden\\\">
            {/* Futuristic Decor */}
            <div className=\\\"absolute top-0 right-0 w-64 h-64 bg-orange-600/5 blur-[120px] rounded-full -mr-32 -mt-32\\\"></div>
            
            <div className=\\\"relative\\\">
              {activeTab === 'profile' && (
                <div className=\\\"animate-in fade-in slide-in-from-bottom-2 duration-500\\\">
                  <div className=\\\"mb-8\\\">
                    <h2 className=\\\"text-2xl font-semibold text-white\\\">Profile Settings</h2>
                    <p className=\\\"text-slate-400 mt-1\\\">Manage your public presence and contact information.</p>
                  </div>
                  
                  <form onSubmit={saveProfile} className=\\\"space-y-8\\\">
                    <div className=\\\"grid grid-cols-1 md:grid-cols-2 gap-6\\\">
                      <div className=\\\"space-y-2\\\">
                        <label className=\\\"text-xs font-bold uppercase tracking-wider text-slate-500\\\">First Name</label>
                        <div className=\\\"px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl text-slate-500 cursor-not-allowed\\\">{profile.first_name}</div>
                      </div>
                      <div className=\\\"space-y-2\\\">
                        <label className=\\\"text-xs font-bold uppercase tracking-wider text-slate-500\\\">Last Name</label>
                        <div className=\\\"px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl text-slate-500 cursor-not-allowed\\\">{profile.last_name}</div>
                      </div>
                    </div>

                    <div className=\\\"p-4 bg-orange-500/5 border border-orange-500/10 rounded-2xl flex gap-4\\\">
                      <div className=\\\"text-orange-500 text-xl\\\">ℹ️</div>
                      <p className=\\\"text-sm text-slate-400 leading-relaxed\\\">
                        Identity verification is required for name changes. Contact <a href=\\\"mailto:support@oxsteed.com\\\" className=\\\"text-orange-500 hover:underline\\\">Support</a> to update your legal name.
                      </p>
                    </div>

                    <div className=\\\"grid grid-cols-1 md:grid-cols-2 gap-6\\\">
                      <div className=\\\"space-y-2\\\">
                        <label className=\\\"text-xs font-bold uppercase tracking-wider text-slate-500\\\">Phone Number</label>
                        <input className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all outline-none\\\" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
                      </div>
                      <div className=\\\"space-y-2\\\">
                        <label className=\\\"text-xs font-bold uppercase tracking-wider text-slate-500\\\">Zip Code</label>
                        <input className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all outline-none\\\" value={profile.zipcode} onChange={e => setProfile({...profile, zipcode: e.target.value})} />
                      </div>
                    </div>

                    <div className=\\\"space-y-2\\\">
                      <label className=\\\"text-xs font-bold uppercase tracking-wider text-slate-500\\\">Bio</label>
                      <textarea className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-all outline-none min-h-[120px]\\\" value={profile.bio} onChange={e => setProfile({...profile, bio: e.target.value})} />
                    </div>

                    <button type=\\\"submit\\\" disabled={saving} className=\\\"px-8 py-3 bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 text-white font-bold rounded-2xl shadow-lg shadow-orange-500/20 transition-all active:scale-[0.98] disabled:opacity-50\\\">
                      {saving ? 'Updating...' : 'Save Changes'}
                    </button>
                  </form>
                </div>
              )}

              {activeTab === 'security' && (
                <div className=\\\"animate-in fade-in slide-in-from-bottom-2 duration-500\\\">
                  <div className=\\\"mb-8\\\">
                    <h2 className=\\\"text-2xl font-semibold text-white\\\">Security</h2>
                    <p className=\\\"text-slate-400 mt-1\\\">Keep your account safe with modern security standards.</p>
                  </div>
                  
                  <form onSubmit={changePassword} className=\\\"space-y-6\\\">
                    <div className=\\\"space-y-4\\\">
                      <input type=\\\"password\\\" placeholder=\\\"Current Password\\\" className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl focus:border-orange-500/50 outline-none transition-all\\\" value={passwords.current} onChange={e => setPasswords({...passwords, current: e.target.value})} />
                      <input type=\\\"password\\\" placeholder=\\\"New Password\\\" className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl focus:border-orange-500/50 outline-none transition-all\\\" value={passwords.newPass} onChange={e => setPasswords({...passwords, newPass: e.target.value})} />
                      <input type=\\\"password\\\" placeholder=\\\"Confirm New Password\\\" className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-2xl focus:border-orange-500/50 outline-none transition-all\\\" value={passwords.confirm} onChange={e => setPasswords({...passwords, confirm: e.target.value})} />
                    </div>
                    <button type=\\\"submit\\\" className=\\\"px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl transition-all\\\">Update Password</button>
                  </form>
                </div>
              )}

              {activeTab === 'billing' && (
                <div className=\\\"animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-8\\\">
                  <div className=\\\"mb-8\\\">
                    <h2 className=\\\"text-2xl font-semibold text-white\\\">Billing & Subscription</h2>
                    <p className=\\\"text-slate-400 mt-1\\\">Manage your plans, invoices, and payment methods.</p>
                  </div>

                  {subLoading ? (
                    <div className=\\\"animate-pulse flex gap-4\\\"><div className=\\\"h-12 w-12 bg-slate-800 rounded-full\\\"></div><div className=\\\"flex-1 space-y-4\\\"><div className=\\\"h-4 bg-slate-800 rounded w-3/4\\\"></div><div className=\\\"h-4 bg-slate-800 rounded w-1/2\\\"></div></div></div>
                  ) : subscription ? (
                    <div className=\\\"p-8 bg-gradient-to-br from-slate-950 to-slate-900 border border-slate-800 rounded-3xl shadow-xl\\\">
                      <div className=\\\"flex items-start justify-between mb-6\\\">
                        <div>
                          <span className=\\\"px-3 py-1 bg-green-500/10 text-green-400 text-xs font-bold rounded-full uppercase tracking-tighter\\\">Active Plan</span>
                          <h3 className=\\\"text-2xl font-bold text-white mt-2\\\">{subscription.plan_name || 'OxSteed Pro'}</h3>
                          <p className=\\\"text-slate-500 text-sm mt-1\\\">
                            {subscription.current_period_end ? \\`Renews on \\${new Date(subscription.current_period_end).toLocaleDateString()}\\` : 'Plan active'}
                          </p>
                        </div>
                        <div className=\\\"text-right\\\">
                          <button onClick={openPortal} className=\\\"px-4 py-2 bg-orange-600/10 text-orange-500 border border-orange-500/20 rounded-xl font-bold text-sm hover:bg-orange-600 hover:text-white transition-all\\\">Manage Portal</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className=\\\"p-8 border border-dashed border-slate-800 rounded-3xl text-center\\\">
                      <p className=\\\"text-slate-400 mb-6\\\">You are currently using OxSteed Free.</p>
                      <div className=\\\"flex flex-wrap gap-4 justify-center\\\">
                         {plans.filter(p => p.slug !== 'free').map(plan => (
                            <button key={plan.id} onClick={() => createCheckout(plan.slug)} className=\\\"px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-2xl shadow-lg shadow-orange-600/10 transition-all\\\">Upgrade to {plan.name} — \\\\${(plan.price / 100).toFixed(2)}</button>
                         ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'businesses' && (
                <div className=\\\"animate-in fade-in slide-in-from-bottom-2 duration-500\\\">
                  <div className=\\\"flex items-center justify-between mb-8\\\">
                    <div>
                      <h2 className=\\\"text-2xl font-semibold text-white\\\">My Businesses</h2>
                      <p className=\\\"text-slate-400 mt-1\\\">Manage legal entities tied to your jobs.</p>
                    </div>
                    <button onClick={() => { setEditingBiz(null); setBizForm({ business_name: '', business_type: 'llc', ein: '', address_street: '', address_city: '', address_state: '', address_zip: '' }); setShowAddBiz(true); }} className=\\\"px-4 py-2 bg-orange-600 text-white font-bold rounded-xl shadow-lg shadow-orange-600/20 hover:scale-105 transition-all text-sm\\\">+ Add New</button>
                  </div>

                  {bizLoading ? (
                    <div className=\\\"space-y-4\\\">
                      {[1,2].map(i => <div key={i} className=\\\"h-20 bg-slate-800/50 rounded-2xl animate-pulse\\\"></div>)}
                    </div>
                  ) : (
                    <div className=\\\"grid gap-4\\\">
                      {businesses.length === 0 ? (
                         <div className=\\\"py-12 text-center border border-dashed border-slate-800 rounded-3xl text-slate-500\\\">No businesses registered yet.</div>
                      ) : (
                        businesses.map(biz => (
                          <div key={biz.id} className=\\\"p-5 bg-slate-950/40 border border-slate-800 rounded-2xl flex items-center justify-between group hover:border-slate-700 transition-all\\\">
                            <div>
                              <h4 className=\\\"font-bold text-white\\\">{biz.business_name}</h4>
                              <p className=\\\"text-xs text-slate-500\\\">{(biz.business_type || 'Business').toUpperCase()} • {biz.address_city || 'N/A'}, {biz.address_state || 'N/A'}</p>
                            </div>
                            <div className=\\\"flex gap-2 opacity-0 group-hover:opacity-100 transition-all\\\">
                              <button onClick={() => { setEditingBiz(biz); setBizForm(biz); setShowAddBiz(true); }} className=\\\"p-2 hover:bg-slate-800 rounded-lg text-slate-400\\\">✏️</button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'notifications' && <NotificationPreferences />}
              {activeTab === 'referrals' && <ReferralPanel />}

              {activeTab === 'advanced' && (
                <div className=\\\"animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-12\\\">
                   <div className=\\\"mb-8\\\">
                    <h2 className=\\\"text-2xl font-semibold text-white\\\">Advanced Options</h2>
                    <p className=\\\"text-slate-400 mt-1\\\">Dangerous operations and data management.</p>
                  </div>

                  <div className=\\\"p-8 bg-slate-950/50 border border-slate-800 rounded-3xl\\\">
                    <h3 className=\\\"font-bold text-white mb-4\\\">Account Role</h3>
                    <p className=\\\"text-sm text-slate-400 mb-6\\\">You are currently in <span className=\\\"text-orange-500 font-bold uppercase tracking-widest text-xs\\\">{user?.role}</span> mode.</p>
                    <button onClick={() => setShowSwitchConfirm(true)} className=\\\"px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl transition-all\\\">Switch Role</button>
                  </div>

                  <div className=\\\"p-8 bg-red-950/10 border border-red-900/20 rounded-3xl\\\">
                    <h3 className=\\\"font-bold text-red-400 mb-2\\\">Danger Zone</h3>
                    <p className=\\\"text-sm text-slate-500 mb-6\\\">Permanently delete your account and all data. This action cannot be undone.</p>
                    <button onClick={() => setShowDelete(true)} className=\\\"px-6 py-3 bg-red-600/10 text-red-500 border border-red-500/20 hover:bg-red-600 hover:text-white font-bold rounded-2xl transition-all\\\">Delete Account</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />

      {/* Role Switch Modal */}
      {showSwitchConfirm && (
        <div className=\\\"fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300\\\">
          <div className=\\\"bg-slate-900 border border-slate-800 w-full max-w-md rounded-3xl p-8 shadow-2xl\\\">
            <h3 className=\\\"text-2xl font-bold text-white mb-2\\\">Switch to {targetRole}?</h3>
            <p className=\\\"text-slate-400 mb-8\\\">Your current progress will be saved. You can switch back at any time.</p>
            <div className=\\\"flex gap-4\\\">
              <button onClick={handleSwitchRole} disabled={switchingRole} className=\\\"flex-1 px-6 py-3 bg-orange-600 text-white font-bold rounded-2xl hover:bg-orange-500 transition-all disabled:opacity-50\\\">
                {switchingRole ? 'Switching...' : 'Confirm'}
              </button>
              <button onClick={() => setShowSwitchConfirm(false)} className=\\\"flex-1 px-6 py-3 bg-slate-800 text-slate-300 font-bold rounded-2xl hover:bg-slate-700 transition-all\\\">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Business Modal */}
      {showAddBiz && (
        <div className=\\\"fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300 overflow-y-auto\\\">
          <div className=\\\"bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-3xl p-8 shadow-2xl my-auto\\\">
            <h3 className=\\\"text-2xl font-bold text-white mb-6\\\">{editingBiz ? 'Edit Business' : 'Add Business'}</h3>
            <form onSubmit={saveBusiness} className=\\\"space-y-6\\\">
              <div className=\\\"grid grid-cols-1 md:grid-cols-2 gap-4\\\">
                <div className=\\\"space-y-2\\\">
                  <label className=\\\"text-xs font-bold uppercase text-slate-500\\\">Business Name</label>
                  <input required className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl focus:border-orange-500 outline-none\\\" value={bizForm.business_name} onChange={e => setBizForm({...bizForm, business_name: e.target.value})} />
                </div>
                <div className=\\\"space-y-2\\\">
                  <label className=\\\"text-xs font-bold uppercase text-slate-500\\\">Business Type</label>
                  <select className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl focus:border-orange-500 outline-none\\\" value={bizForm.business_type} onChange={e => setBizForm({...bizForm, business_type: e.target.value})}>
                    {BIZ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className=\\\"space-y-2\\\">
                <label className=\\\"text-xs font-bold uppercase text-slate-500\\\">Street Address</label>
                <input required className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl focus:border-orange-500 outline-none\\\" value={bizForm.address_street} onChange={e => setBizForm({...bizForm, address_street: e.target.value})} />
              </div>
              <div className=\\\"grid grid-cols-2 md:grid-cols-3 gap-4\\\">
                <div className=\\\"space-y-2\\\">
                  <label className=\\\"text-xs font-bold uppercase text-slate-500\\\">City</label>
                  <input required className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl focus:border-orange-500 outline-none\\\" value={bizForm.address_city} onChange={e => setBizForm({...bizForm, address_city: e.target.value})} />
                </div>
                <div className=\\\"space-y-2\\\">
                  <label className=\\\"text-xs font-bold uppercase text-slate-500\\\">State</label>
                  <input required className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl focus:border-orange-500 outline-none\\\" value={bizForm.address_state} onChange={e => setBizForm({...bizForm, address_state: e.target.value})} />
                </div>
                <div className=\\\"space-y-2 col-span-2 md:col-span-1\\\">
                  <label className=\\\"text-xs font-bold uppercase text-slate-500\\\">Zip Code</label>
                  <input required className=\\\"w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl focus:border-orange-500 outline-none\\\" value={bizForm.address_zip} onChange={e => setBizForm({...bizForm, address_zip: e.target.value})} />
                </div>
              </div>
              <div className=\\\"flex gap-4 pt-4\\\">
                <button type=\\\"submit\\\" disabled={bizSaving} className=\\\"flex-1 px-6 py-3 bg-orange-600 text-white font-bold rounded-2xl hover:bg-orange-500 transition-all disabled:opacity-50\\\">
                  {bizSaving ? 'Saving...' : 'Save Business'}
                </button>
                <button type=\\\"button\\\" onClick={() => setShowAddBiz(false)} className=\\\"flex-1 px-6 py-3 bg-slate-800 text-slate-300 font-bold rounded-2xl hover:bg-slate-700 transition-all\\\">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDelete && (
        <div className=\\\"fixed inset-0 z-50 flex items-center justify-center p-6 bg-red-950/20 backdrop-blur-xl animate-in zoom-in-95 duration-200\\\">
          <div className=\\\"bg-slate-950 border border-red-900/50 w-full max-w-md rounded-[2.5rem] p-10 shadow-2xl\\\">
            <div className=\\\"w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-3xl mb-6 mx-auto\\\">⚠️</div>
            <h3 className=\\\"text-2xl font-bold text-white text-center mb-2\\\">Permanent Deletion</h3>
            <p className=\\\"text-slate-500 text-center mb-10 text-sm\\\">This will scrub all your data, job history, and payments from our systems. There is no recovery.</p>
            <div className=\\\"flex flex-col gap-3\\\">
              <button onClick={deleteAccount} className=\\\"w-full px-6 py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-500 shadow-xl shadow-red-600/20 transition-all\\\">I understand, delete everything</button>
              <button onClick={() => setShowDelete(false)} className=\\\"w-full px-6 py-4 text-slate-400 font-bold hover:text-white transition-all\\\">Keep my account</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
          }
