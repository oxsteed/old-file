import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useDestructiveConfirm from '../hooks/useDestructiveConfirm';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';
import {
  Users, Plus, Edit2, Trash2, RefreshCw, Shield, ChevronRight, Zap,
} from 'lucide-react';
import SupportSubNav from '../components/SupportSubNav';

// Member Card
function MemberCard({ member, onEdit, onRemove }) {
  const { t } = useTranslation();
  const getRoleColor = (role) => {
    if (role === 'director') return 'bg-red-900/30 text-red-300';
    if (role === 'manager') return 'bg-orange-900/30 text-orange-300';
    if (role === 'supervisor') return 'bg-yellow-900/30 text-yellow-300';
    return 'bg-blue-900/30 text-blue-300';
  };

  return (
    <div className="bg-gray-700 rounded-lg p-4 flex items-start justify-between">
      <div className="flex items-start gap-3 flex-1">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-600
                        flex items-center justify-center text-white font-bold text-sm">
          {member.name?.[0]}
        </div>
        <div className="flex-1">
          <p className="text-white font-medium">{member.name}</p>
          <p className="text-gray-400 text-xs mb-2">{member.email}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-1 rounded text-xs font-semibold ${getRoleColor(member.role)}`}>
              {t(`adminSupportTeam.role${member.role.charAt(0).toUpperCase()}${member.role.slice(1)}`, { defaultValue: member.role })}
            </span>
            {member.skills && member.skills.length > 0 && (
              <div className="flex gap-1">
                {member.skills.slice(0, 3).map((skill, idx) => (
                  <span key={idx} className="px-2 py-1 bg-gray-600 text-gray-200 text-xs rounded">
                    {skill}
                  </span>
                ))}
                {member.skills.length > 3 && (
                  <span className="px-2 py-1 bg-gray-600 text-gray-400 text-xs rounded">
                    +{member.skills.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onEdit(member)}
          aria-label={t('adminSupportTeam.editMemberAria', { name: member.name || t('adminSupportTeam.teamMemberFallback') })}
          className="p-2 hover:bg-gray-600 rounded transition"
        >
          <Edit2 size={16} className="text-gray-400 hover:text-white" />
        </button>
        <button
          onClick={() => onRemove(member.id)}
          aria-label={t('adminSupportTeam.removeMemberAria', { name: member.name || t('adminSupportTeam.teamMemberFallback') })}
          className="p-2 hover:bg-red-900/30 rounded transition"
        >
          <Trash2 size={16} className="text-red-400" />
        </button>
      </div>
    </div>
  );
}

// Department Section
function DepartmentSection({ department, onEditMember, onRemoveMember }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition"
        >
          <ChevronRight size={20} className={`text-orange-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <div>
            <h3 className="text-white font-bold text-lg">{department.name}</h3>
            <p className="text-gray-400 text-sm">{t('adminSupportTeam.membersCount', { count: department.members?.length || 0 })}</p>
          </div>
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 ml-8">
          {department.members && department.members.length > 0 ? (
            department.members.map(member => (
              <MemberCard
                key={member.id}
                member={member}
                onEdit={onEditMember}
                onRemove={onRemoveMember}
              />
            ))
          ) : (
            <p className="text-gray-400 text-sm italic">{t('adminSupportTeam.noMembers')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Member Form Modal
function MemberFormModal({ member, roles, skills, departmentName, onClose, onSave }) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(member || {
    name: '',
    email: '',
    role: 'agent',
    skills: [],
  });

  const [selectedSkills, setSelectedSkills] = useState(formData.skills || []);

  const handleSkillToggle = (skill) => {
    setSelectedSkills(prev =>
      prev.includes(skill)
        ? prev.filter(s => s !== skill)
        : [...prev, skill]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ ...formData, skills: selectedSkills });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="border-b border-gray-700 p-6 flex items-center justify-between sticky top-0 bg-gray-800">
          <h2 className="text-white font-bold text-xl">
            {member ? t('adminSupportTeam.modalEditTitle') : t('adminSupportTeam.modalAddTitle')}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminSupportTeam.labelName')}</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                         focus:outline-none focus:border-orange-500"
              placeholder={t('adminSupportTeam.namePlaceholder')}
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminSupportTeam.labelEmail')}</label>
            <input
              type="email"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                         focus:outline-none focus:border-orange-500"
              placeholder="email@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminSupportTeam.labelRole')}</label>
            <select
              value={formData.role}
              onChange={e => setFormData({ ...formData, role: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                         focus:outline-none focus:border-orange-500"
              required
            >
              {roles.map(role => (
                <option key={role} value={role}>
                  {t(`adminSupportTeam.role${role.charAt(0).toUpperCase()}${role.slice(1)}`, { defaultValue: role.charAt(0).toUpperCase() + role.slice(1) })}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">{t('adminSupportTeam.labelDepartment')}</label>
            <p className="px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-sm text-gray-300">
              {departmentName || t('adminSupportTeam.assignedAuto')}
              {!member && (
                <span className="block text-xs text-gray-500 mt-0.5">
                  {t('adminSupportTeam.newMemberNote')}
                </span>
              )}
            </p>
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-3">{t('adminSupportTeam.labelSkills')}</label>
            <div className="grid grid-cols-2 gap-2">
              {skills.map(skill => (
                <label key={skill} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSkills.includes(skill)}
                    onChange={() => handleSkillToggle(skill)}
                    className="w-4 h-4 accent-orange-500"
                  />
                  <span className="text-gray-300 text-sm">{skill}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium"
            >
              {member ? t('adminSupportTeam.updateMember') : t('adminSupportTeam.addMemberButton')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Main Team Hierarchy
export default function SupportTeamHierarchy() {
  const { t } = useTranslation();
  const { confirmDestructive, dialog: confirmDialog } = useDestructiveConfirm();
  const { businessId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [editingDepartmentName, setEditingDepartmentName] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/team/hierarchy', {
        params: { business_id: businessId },
      });
      setData(res.data);
    } catch (err) {
      console.error('Failed to load team hierarchy:', err);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveMember = async (formData) => {
    try {
      if (editingMember) {
        await adminApi.put(`/support/team/members/${editingMember.id}`, formData);
      } else {
        await adminApi.post('/support/team/members', {
          ...formData,
          business_id: businessId,
        });
      }
      setShowForm(false);
      setEditingMember(null);
      loadData();
      toast.success(editingMember ? t('adminSupportTeam.toastUpdated', { defaultValue: 'Team member updated.' }) : t('adminSupportTeam.toastAdded', { defaultValue: 'Team member added.' }));
    } catch (err) {
      console.error('Failed to save member:', err);
      toast.error(err?.response?.data?.error || t('adminSupportTeam.toastSaveFailed', { defaultValue: 'Failed to save the team member.' }));
    }
  };

  const handleRemoveMember = async (memberId) => {
    // E12: destructive action goes through the shared confirm dialog.
    const ok = await confirmDestructive({ description: t('adminSupportTeam.confirmRemove') });
    if (!ok) return;
    try {
      await adminApi.delete(`/support/team/members/${memberId}`);
      toast.success(t('adminSupportTeam.toastRemoved', { defaultValue: 'Team member removed.' }));
      loadData();
    } catch (err) {
      console.error('Failed to remove member:', err);
      toast.error(err?.response?.data?.error || t('adminSupportTeam.toastRemoveFailed', { defaultValue: 'Failed to remove the team member.' }));
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const teamData = data || {};
  const departments = teamData.departments || [];
  const stats = teamData.stats || {};
  const roles = teamData.available_roles || ['agent', 'supervisor', 'manager', 'director'];
  const skills = teamData.available_skills || [];

  return (
    <>
      {confirmDialog}
    <div className="p-6 max-w-7xl mx-auto">
      <SupportSubNav />
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">{t('adminSupportTeam.title')}</h1>
          <p className="text-gray-400 text-sm">{t('adminSupportTeam.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg
                       hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setEditingMember(null);
              setEditingDepartmentName('');
              setShowForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700
                       text-white rounded-lg transition font-medium"
          >
            <Plus size={18} />
            {t('adminSupportTeam.addMember')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">{t('adminSupportTeam.statTotal')}</p>
          <p className="text-white text-3xl font-bold">{stats.total_members || 0}</p>
          <p className="text-gray-500 text-xs mt-2">{t('adminSupportTeam.statTotalDetail')}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Shield size={14} />
            {t('adminSupportTeam.statManagers')}
          </p>
          <p className="text-white text-3xl font-bold">{stats.managers || 0}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Zap size={14} />
            {t('adminSupportTeam.statSupervisors')}
          </p>
          <p className="text-white text-3xl font-bold">{stats.supervisors || 0}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <Users size={14} />
            {t('adminSupportTeam.statAgents')}
          </p>
          <p className="text-white text-3xl font-bold">{stats.agents || 0}</p>
        </div>
      </div>

      {/* Department Hierarchy */}
      <div>
        <h2 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
          <Users size={20} className="text-orange-400" />
          {t('adminSupportTeam.sectionTitle')}
        </h2>

        {departments.length === 0 ? (
          <div className="text-center py-12 bg-gray-800 border border-gray-700 rounded-xl">
            <Users size={40} className="mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">{t('adminSupportTeam.emptyDepartments')}</p>
          </div>
        ) : (
          <div>
            {departments.map(department => (
              <DepartmentSection
                key={department.id}
                department={department}
                onEditMember={(member) => {
                  setEditingMember(member);
                  setEditingDepartmentName(department.name || '');
                  setShowForm(true);
                }}
                onRemoveMember={handleRemoveMember}
              />
            ))}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <MemberFormModal
          member={editingMember}
          roles={roles}
          skills={skills}
          departmentName={editingDepartmentName || departments[0]?.name || ''}
          onClose={() => {
            setShowForm(false);
            setEditingMember(null);
            setEditingDepartmentName('');
          }}
          onSave={handleSaveMember}
        />
      )}
    </div>
    </>
  );
}
