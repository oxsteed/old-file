import React, { useState, useEffect } from 'react';
import { X, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  listBusinessSkills,
  addBusinessSkill,
  updateBusinessSkill,
  removeBusinessSkill,
  searchSkillsForBusiness,
} from '../api/businessSkills';

export default function BusinessSkillsSelector({
  businessId,
  onSkillsChange,
  maxSkills = 20,
  readOnly = false,
}) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searching, setSearching] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState(null);
  const [editingMinExp, setEditingMinExp] = useState('');

  // Load business skills on mount
  useEffect(() => {
    loadSkills();
  }, [businessId]);

  const loadSkills = async () => {
    try {
      setLoading(true);
      const data = await listBusinessSkills(businessId);
      setSkills(data.skills || []);
      onSkillsChange?.(data.skills || []);
    } catch (err) {
      toast.error(t('businessSkills.errorLoadSkills') || 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  };

  // Search for skills to add
  const handleSearch = async (query) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      setSearching(true);
      const data = await searchSkillsForBusiness(businessId, { q: query, limit: 20 });
      setSearchResults(data.skills || []);
    } catch (err) {
      toast.error(t('businessSkills.errorSearchSkills') || 'Failed to search skills');
    } finally {
      setSearching(false);
    }
  };

  const handleAddSkill = async (skill) => {
    if (skills.length >= maxSkills) {
      toast.error(t('businessSkills.maxSkillsReached') || `Maximum ${maxSkills} skills allowed`);
      return;
    }
    try {
      await addBusinessSkill(businessId, { skillId: skill.id });
      toast.success(t('businessSkills.skillAdded') || 'Skill added');
      setSearchQuery('');
      setShowSearch(false);
      await loadSkills();
    } catch (err) {
      if (err.response?.status === 409) {
        toast.error(t('businessSkills.skillAlreadyAdded') || 'This skill is already added');
      } else {
        toast.error(t('businessSkills.errorAddSkill') || 'Failed to add skill');
      }
    }
  };

  const handleRemoveSkill = async (skillId) => {
    if (!window.confirm(t('businessSkills.confirmRemove') || 'Remove this skill?')) return;
    try {
      await removeBusinessSkill(businessId, skillId);
      toast.success(t('businessSkills.skillRemoved') || 'Skill removed');
      await loadSkills();
    } catch (err) {
      toast.error(t('businessSkills.errorRemoveSkill') || 'Failed to remove skill');
    }
  };

  const handleSaveMinExp = async (skillId, minExp) => {
    try {
      await updateBusinessSkill(businessId, skillId, {
        minYearsExperience: minExp ? parseInt(minExp, 10) : null,
      });
      toast.success(t('businessSkills.experienceUpdated') || 'Experience requirement updated');
      setEditingSkillId(null);
      await loadSkills();
    } catch (err) {
      toast.error(t('businessSkills.errorUpdateSkill') || 'Failed to update skill');
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Skills List */}
      <div className="space-y-2">
        {skills.length === 0 ? (
          <p className="text-sm text-gray-400">{t('businessSkills.noSkillsAdded') || 'No skills added yet'}</p>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div
                key={skill.skill_id}
                className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg p-3"
              >
                <div className="flex-1">
                  <div className="font-medium text-white">{skill.skill_name}</div>
                  <div className="text-xs text-gray-500">{skill.category}</div>
                  {editingSkillId === skill.skill_id ? (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="99"
                        value={editingMinExp}
                        onChange={(e) => setEditingMinExp(e.target.value)}
                        placeholder={t('businessSkills.yearsOptional', { defaultValue: 'Years (optional)' })}
                        className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white"
                      />
                      <button
                        onClick={() => handleSaveMinExp(skill.skill_id, editingMinExp)}
                        className="px-2 py-1 bg-brand-500 hover:bg-brand-600 text-white text-xs rounded"
                      >
                        {t('common.save')}
                      </button>
                      <button
                        onClick={() => setEditingSkillId(null)}
                        className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1">
                      {skill.min_years_experience ? (
                        <span className="text-xs text-gray-400">
                          {skill.min_years_experience}+ {t('businessSkills.yearsExperience') || 'years experience'}
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingSkillId(skill.skill_id);
                            setEditingMinExp(skill.min_years_experience || '');
                          }}
                          className="text-xs text-gray-500 hover:text-gray-400"
                        >
                          {t('businessSkills.addExperience') || 'Add experience requirement'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <button
                    onClick={() => handleRemoveSkill(skill.skill_id)}
                    className="ml-2 p-1 text-gray-400 hover:text-red-400 transition-colors"
                    aria-label={t('businessSkills.removeSkillAria', { defaultValue: 'Remove skill' })}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Skill Button */}
      {!readOnly && skills.length < maxSkills && (
        <button
          onClick={() => setShowSearch(!showSearch)}
          className="flex items-center gap-2 w-full px-4 py-3 bg-gray-800 border border-dashed border-gray-600 hover:border-brand-500 rounded-lg text-sm text-gray-400 hover:text-brand-400 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('businessSkills.addSkill') || 'Add skill'}
        </button>
      )}

      {/* Search Box */}
      {showSearch && !readOnly && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder={t('businessSkills.searchPlaceholder') || 'Search skills...'}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              autoFocus
            />
          </div>

          {/* Search Results */}
          {searching && (
            <p className="text-sm text-gray-400">{t('common.loading')}</p>
          )}

          {!searching && searchQuery && searchResults.length === 0 && (
            <p className="text-sm text-gray-500">{t('businessSkills.noResults') || 'No skills found'}</p>
          )}

          {!searching && searchResults.length > 0 && (
            <div className="max-h-60 overflow-y-auto space-y-1">
              {searchResults.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => handleAddSkill(skill)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-left text-sm transition-colors"
                >
                  <div>
                    <div className="text-white">{skill.name}</div>
                    <div className="text-xs text-gray-500">{skill.category}</div>
                  </div>
                  <Plus className="w-4 h-4 text-gray-500" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
