import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState({ first_name: '', last_name: '', phone: '', bio: '', zipcode: '' });
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    api.get('/api/auth/me').then(r => { setProfile(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put('/api/auth/profile', profile);
      toast.success('Profile updated');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to update'); }
    setSaving(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (passwords.newPass !== passwords.confirm) return toast.error('Passwords do not match');
    if (passwords.newPass.length < 8) return toast.error('Password must be at least 8 characters');
    try {
      await api.put('/api/auth/change-password', { currentPassword: passwords.current, newPassword: passwords.newPass });
      toast.success('Password changed');
      setPasswords({ current: '', newPass: '', confirm: '' });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to change password'); }
  };

  const deleteAccount = async () => {
    try {
      await api.delete('/api/privacy/delete-account');
      toast.success('Account deleted');
      logout();
      navigate('/');
    } catch (err) { toast.error('Failed to delete account'); }
  };

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-8">Settings</h1>

        {/* Navigation */}
        <div className="flex gap-4 mb-8 flex-wrap">
          <Link to="/settings/2fa" className="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition">Two-Factor Auth</Link>
          <Link to="/settings/notifications" className="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition">Notifications</Link>
        </div>

        {/* Edit Profile */}
        <form onSubmit={saveProfile} className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <h2 className="text-xl font-semibold mb-4">Edit Profile</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">First Name</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white" value={profile.first_name || ''} onChange={e => setProfile({...profile, first_name: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Last Name</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white" value={profile.last_name || ''} onChange={e => setProfile({...profile, last_name: e.target.value})} />
            </div>
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
          <button type="submit" disabled={saving} className="mt-4 px-6 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg font-medium transition disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>

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
          <button onClick={() => { api.get('/api/privacy/export').then(r => { const blob = new Blob([JSON.stringify(r.data, null, 2)]); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'my-data.json'; a.click(); toast.success('Data exported'); }).catch(() => toast.error('Export failed')); }} className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition">Export My Data</button>
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
